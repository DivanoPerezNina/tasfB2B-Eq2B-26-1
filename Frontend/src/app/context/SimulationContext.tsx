import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import {
  SimulationConfig,
  SimulationScenario,
  CriterioOrden,
  FaseSimulacion,
  Contadores,
  AeropuertoEstado,
  DatasetInfo,
  PlanResumenVisual,
  PlanTramoVisual,
  SimulationStats,
  Baggage,
  VisualCancellation,
  CancellationAudit,
  ReassignmentLeg,
  StablePlanSnapshot,
} from '../types';
import { airports } from '../data/airports';
import { authHeader } from '../lib/auth';

// ─── Constantes ───────────────────────────────────────────────────────────────

const BFF = ((import.meta as any).env?.VITE_BFF_URL ?? '') as string;

const CONFIG_DEFAULT: SimulationConfig = {
  scenario:       'period',
  startDate:      new Date('2026-01-15'),
  dias:           5,
  duracionRealMin: 60,
  criterio:       'EDF',
  warmUp:         false,      // Sim5D: tiempo=0 en fecha/hora elegida; se consume data futura
                              // (aviones en vuelo + almacenes ocupados). "Desde cero" lo apaga.
  speed:          1,          // derivado; no se usa directamente
  thresholds: {
    warehouse: { green: 60, yellow: 80, red: 95 },
    flight:    { green: 60, yellow: 80, red: 95 },
  },
  algorithmParams: {},
};

// ─── Tipos del contexto ───────────────────────────────────────────────────────

export interface CollapseResult {
  tipo: string;
  motivo: string;
  aeropuerto?: string;
  ocupacion?: number;
  ta_seg?: number;
  sa_seg?: number;
  tiempo_sim_utc: number;
  fecha_colapso_utc: string;
  fecha_colapso_peru: string;
  dia_simulado: number;
  envio_incumplido?: number;
  programado_demo?: boolean;
  contadores: Contadores;
}

interface SimulationContextType {
  // ── Estado de la máquina ──
  fase: FaseSimulacion;
  errorMsg: string | null;

  // ── Planificación ──
  jobId: string | null;
  planProgreso: number;   // 0-100
  planMensaje: string;

  // ── Simulación en vivo ──
  isRunning: boolean;     // fase === 'ejecutando'
  simulationTime: Date;   // derivado de tiempoSimUTC
  tiempoSimUTC: number;   // minutos epoch
  progresoPct: number;    // 0-100 (ventana visible en tiempo real)
  warmupPct: number;      // 0-100 (progreso del pre-roll de warm-up)
  contadores: Contadores;
  lastValidTick: { tiempo_sim_utc: number; contadores: Contadores; tick?: number; progreso_pct?: string } | null;
  collapseFailure: {
    technicalMessage: string;
    badge: string;
    type: 'limite_tecnico' | 'tecnico_memoria' | 'unknown';
  } | null;
  /** Resultado terminal cuando se detecta el primer incumplimiento logístico. */
  collapseResult: CollapseResult | null;
  aeropuertosState: AeropuertoEstado[];
  /** Tramos reales del plan generado por el planificador. Se usan solo para la visualización del mapa. */
  planTramos: PlanTramoVisual[];
  planResumen: PlanResumenVisual | null;
  planVisualCargado: boolean;
  visualCancellations: VisualCancellation[];
  /** Evidencia antes/después de cada cancelación interactiva. */
  cancellationAudits: CancellationAudit[];
  /** Último plan válido recibido por SSE. Se conserva aunque la simulación termine o se detenga. */
  lastStablePlan: StablePlanSnapshot | null;

  // ── Configuración ──
  config: SimulationConfig;
  datasetInfo: DatasetInfo | null;

  // ── Stats derivados (compatibilidad UnifiedDashboard) ──
  stats: SimulationStats;
  baggages: Baggage[];
  getAirportStats: (airportId: string) => { occupancy: number; capacity: number; percentage: number } | null;

  // ── Acciones ──
  updateConfig: (patch: Partial<SimulationConfig>) => void;
  iniciarPlanificacion: (overrides?: Partial<Pick<SimulationConfig, 'startDate' | 'dias' | 'criterio' | 'duracionRealMin' | 'warmUp'>>) => Promise<void>;
  iniciarPeriodoProgramado: (opts: { startDate: Date; dias: number; criterio?: CriterioOrden; warmUp?: boolean; scMin?: number; saSeg?: number; usarCancelaciones?: boolean }) => Promise<void>;
  iniciarColapsoProgramado: (opts: { startDate: Date; criterio?: CriterioOrden; warmUp?: boolean; k?: number; saSeg?: number; maxDias?: number; umbralColapso?: number; umbralRechazosPct?: number; bloquesRojoConsecutivos?: number }) => Promise<void>;
  iniciarSimulacion: () => Promise<void>;
  pausarSimulacion: () => Promise<void>;
  reanudarSimulacion: () => Promise<void>;
  detenerSimulacion: () => Promise<void>;
  /** Suscripción solo-lectura al SSE si hay una simulación en curso (vista operario).
   *  Devuelve true si quedó conectado (el broker reenvía snapshot al conectar). */
  conectarEspectador: () => Promise<boolean>;
  cancelarVuelo: (origen: string, destino: string, salidaUTC: number, vueloId?: number, llegadaUTC?: number) => Promise<boolean>;
  registrarCancelacionVisual: (cancelacion: VisualCancellation) => void;
  resetear: () => void;

  // ── Compatibilidad legacy ──
  startSimulation:  () => void;
  pauseSimulation:  () => void;
  resetSimulation:  () => void;
}

// ─── Contexto ─────────────────────────────────────────────────────────────────

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export const useSimulation = () => {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider');
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ── Config ──
  const [config, setConfig] = useState<SimulationConfig>(CONFIG_DEFAULT);

  // ── Máquina de estados ──
  const [fase, setFase] = useState<FaseSimulacion>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Planificación ──
  const [jobId, setJobId] = useState<string | null>(null);
  const [planProgreso, setPlanProgreso] = useState(0);
  const [planMensaje, setPlanMensaje] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Simulación en vivo ──
  const [tiempoSimUTC, setTiempoSimUTC]     = useState(0);
  const [progresoPct, setProgresoPct]       = useState(0);
  const [warmupPct, setWarmupPct]           = useState(0);
  const [contadores, setContadores]         = useState<Contadores>({
    total: 0, pendiente: 0, en_vuelo: 0, en_escala: 0, entregado: 0, rechazado: 0,
  });
  const [lastValidTick, setLastValidTick] = useState<{ tiempo_sim_utc: number; contadores: Contadores; tick?: number; progreso_pct?: string } | null>(null);
  const lastValidTickRef = useRef<{ tiempo_sim_utc: number; contadores: Contadores; tick?: number; progreso_pct?: string } | null>(null);
  const [collapseFailure, setCollapseFailure] = useState<{
    technicalMessage: string;
    badge: string;
    type: 'limite_tecnico' | 'tecnico_memoria' | 'unknown';
  } | null>(null);
  const [collapseResult, setCollapseResult] = useState<CollapseResult | null>(null);
  const [aeropuertosState, setAeropuertos]  = useState<AeropuertoEstado[]>([]);
  const [planTramos, setPlanTramos]          = useState<PlanTramoVisual[]>([]);
  const [planResumen, setPlanResumen]        = useState<PlanResumenVisual | null>(null);
  const [planVisualCargado, setPlanVisualCargado] = useState(false);
  const [visualCancellations, setVisualCancellations] = useState<VisualCancellation[]>([]);
  const [cancellationAudits, setCancellationAudits] = useState<CancellationAudit[]>([]);
  const [lastStablePlan, setLastStablePlan] = useState<StablePlanSnapshot | null>(null);
  const planTramosRef = useRef<PlanTramoVisual[]>([]);
  const cancellationAuditsRef = useRef<CancellationAudit[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const sseErroresRef = useRef(0);  // errores SSE consecutivos para detectar caída del BFF

  // ── Dataset info ──
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);

  // ── Cargar info del dataset al montar ──────────────────────────────────────
  useEffect(() => {
    fetch(`${BFF}/api/dataset`)
      .then(r => r.json())
      .then(json => {
        const d = json.data ?? json;
        if (d.fecha_min) {
          setDatasetInfo({
            fecha_min:    d.fecha_min.slice(0, 10),
            fecha_max:    d.fecha_max.slice(0, 10),
            total_envios: d.total_envios,
          });
          const fechaIni = new Date(d.fecha_min.slice(0, 10) + 'T00:00:00');
          setConfig(prev => ({ ...prev, startDate: fechaIni }));
        } else {
          // dataset_meta no existe todavía (carga-masiva no se ejecutó):
          // usar rango fijo del dataset conocido para permitir testing local
          setDatasetInfo({
            fecha_min:    '2026-01-01',
            fecha_max:    '2027-12-31',
            total_envios: '?',
          });
          setConfig(prev => ({ ...prev, startDate: new Date('2026-07-20T08:15:00') }));
        }
      })
      .catch(() => {
        // BFF no disponible — igual ponemos el rango por defecto
        setDatasetInfo({
          fecha_min:    '2026-01-01',
          fecha_max:    '2027-12-31',
          total_envios: '?',
        });
      });
  }, []);

  // ── Limpiar recursos al desmontar ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (esRef.current)   esRef.current.close();
    };
  }, []);

  useEffect(() => {
    planTramosRef.current = planTramos;
  }, [planTramos]);

  useEffect(() => {
    cancellationAuditsRef.current = cancellationAudits;
  }, [cancellationAudits]);


  // ─── Cargar tramos reales del plan para la visualización del mapa ─────────
  const cargarPlanVisual = useCallback(async (jid: string) => {
    setPlanVisualCargado(false);
    setPlanTramos([]);
    setPlanResumen(null);

    try {
      const res = await fetch(`${BFF}/api/planificacion/resultado/${jid}`, { headers: authHeader() });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const plan = json.data ?? json;
      const envios = Array.isArray(plan.envios) ? plan.envios : [];

      const tramos: PlanTramoVisual[] = [];
      for (const envio of envios) {
        if (!Array.isArray(envio.tramos)) continue;
        for (let i = 0; i < envio.tramos.length; i++) {
          const tramo = envio.tramos[i];
          const salidaUTC = Number(tramo.salidaUTC);
          const llegadaUTC = Number(tramo.llegadaUTC);
          if (!Number.isFinite(salidaUTC) || !Number.isFinite(llegadaUTC) || llegadaUTC <= salidaUTC) {
            continue;
          }
          tramos.push({
            envioIndice: Number(envio.indice ?? 0),
            tramoIndex: i,
            vueloId: Number.isFinite(Number(tramo.vueloId)) ? Number(tramo.vueloId) : undefined,
            desde: String(tramo.desde ?? '').toUpperCase(),
            hasta: String(tramo.hasta ?? '').toUpperCase(),
            salidaUTC,
            llegadaUTC,
            maletas: Number(envio.maletas ?? 1),
            origenEnvio: envio.origen != null ? String(envio.origen).toUpperCase() : undefined,
            destinoEnvio: envio.destino != null ? String(envio.destino).toUpperCase() : undefined,
            registroUTC: envio.registroUTC != null ? Number(envio.registroUTC) : undefined,
            deadlineUTC: envio.deadlineUTC != null ? Number(envio.deadlineUTC) : undefined,
          });
        }
      }

      setPlanTramos(tramos);
      setPlanResumen(plan.resumen ?? null);
      setPlanVisualCargado(true);
      console.log(`[Plan visual] ${tramos.length} tramos reales cargados para el mapa`);
    } catch (e: any) {
      console.warn('[Plan visual] No se pudo cargar el detalle de tramos:', e.message);
      setPlanVisualCargado(false);
      setPlanTramos([]);
      setPlanResumen(null);
    }
  }, []);

  const classifyCollapseFailureType = (message: string) => {
    const normalized = String(message).toLowerCase();
    if (/outofmemory|java heap|heap space/.test(normalized)) {
      return 'tecnico_memoria';
    }
    if (/memoria|planificador|desde-datos|http 500|no se puede|fallo|timeout|tiempo de espera/.test(normalized)) {
      return 'limite_tecnico';
    }
    return 'unknown';
  };

  // ─── Iniciar planificación ────────────────────────────────────────────────
  const iniciarPlanificacion = useCallback(async (
    overrides?: Partial<Pick<SimulationConfig, 'startDate' | 'dias' | 'criterio' | 'duracionRealMin' | 'warmUp'>>
  ) => {
    const efectivo = { ...config, ...overrides };
    setFase('planificando');
    setErrorMsg(null);
    setPlanProgreso(0);
    setPlanMensaje('Iniciando planificación...');
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);
    setVisualCancellations([]);
    setCancellationAudits([]);

    // Enviar fecha+hora local como YYYY-MM-DDTHH:MM
    // El planificador trabaja en epoch-minutos UTC y usa GMT=0 al recibir este campo
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = efectivo.startDate;
    const fechaISO = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    try {
      // Usa el endpoint unificado del BFF que recibe todos los parámetros a la vez
      const res = await fetch(`${BFF}/api/periodo/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          fechaInicio:      fechaISO,
          dias:             efectivo.dias,
          criterio:         efectivo.criterio ?? 'EDF',
          semilla:          42,
          duracion_real_min: efectivo.duracionRealMin,
          warmUp:           efectivo.warmUp ?? false,
          umbrales: {
            verde_hasta: config.thresholds.warehouse.green  / 100,
            ambar_hasta: config.thresholds.warehouse.yellow / 100,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // BFF error envelope: { success, data, message, error }
        throw new Error(data.message ?? (typeof data.error === 'string' ? data.error : `HTTP ${res.status}`));
      }

      // BFF ok() envelope: { success: true, data: { job_id, ... }, message }
      const payload = data.data ?? data;
      const jid = payload.job_id;   // BFF periodo devuelve job_id (snake_case)
      setJobId(jid);
      console.log(`[Plan] iniciada job=${jid} | ${efectivo.dias} días desde ${fechaISO} | ${efectivo.duracionRealMin} min`);

      // Polling cada 2 segundos
      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`${BFF}/api/periodo/status/${jid}`, { headers: authHeader() });
          const sd = await sr.json();
          setPlanProgreso(sd.progreso ?? 0);
          setPlanMensaje(sd.mensaje ?? '');
          console.log(`[Plan] ${sd.estado} ${sd.progreso ?? 0}% — ${sd.mensaje ?? ''}`);

          if (sd.estado === 'COMPLETADO') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            await cargarPlanVisual(jid);
            setFase('listo');
            console.log('[Plan] ✓ Planificación completada — listo para ejecutar');
          } else if (sd.estado === 'ERROR') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setFase('error');
            setErrorMsg(sd.error ?? 'Error en planificación');
          }
        } catch (e) {
          // red caída — seguir intentando
        }
      }, 2000);

    } catch (e: any) {
      setFase('error');
      setErrorMsg(e.message ?? 'Error al iniciar planificación');
    }
  }, [config, cargarPlanVisual]);

  // ─── Iniciar simulación ───────────────────────────────────────────────────
  const iniciarSimulacion = useCallback(async () => {
    if (!jobId) return;

    try {
      // BFF almacenó duracion_real_min y umbrales al llamar /periodo/iniciar
      const res = await fetch(`${BFF}/api/periodo/ejecutar/${jobId}`, {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.mensaje ?? data.error ?? `HTTP ${res.status}`);
      }

      setFase('ejecutando');
      console.log(`[Sim] iniciada simulacion_id=${data.simulacion_id ?? jobId} | total_envios=${data.total_envios ?? '?'}`);

      // Suscribir SSE
      if (esRef.current) esRef.current.close();
      sseErroresRef.current = 0;
      setWarmupPct(0);
      const es = new EventSource(`${BFF}/api/simulacion/eventos`);
      esRef.current = es;

      // Cualquier mensaje válido reinicia el contador de errores
      es.addEventListener('open', () => { sseErroresRef.current = 0; });

      // ── Warm-up turbo: el Ejecutor reproduce el tramo previo a máxima velocidad ──
      es.addEventListener('warmup-progress', (e: MessageEvent) => {
        sseErroresRef.current = 0;
        const d = JSON.parse(e.data);
        setFase('calentando');
        setWarmupPct(parseFloat(d.progreso_pct ?? '0'));
        setTiempoSimUTC(d.tiempo_sim_utc);
      });

      es.addEventListener('warmup-completado', (e: MessageEvent) => {
        sseErroresRef.current = 0;
        const d = JSON.parse(e.data);
        setWarmupPct(100);
        if (d.contadores) setContadores(d.contadores);
        setTiempoSimUTC(d.tiempo_sim_utc);
        setFase('ejecutando');
        console.log('[Sim] ✓ Warm-up completado — arrancando tiempo real');
      });

      es.addEventListener('tick', (e: MessageEvent) => {
        sseErroresRef.current = 0;
        const d = JSON.parse(e.data);
        setTiempoSimUTC(d.tiempo_sim_utc);
        setProgresoPct(parseFloat(d.progreso_pct ?? '0'));
        if (d.contadores) {
          setContadores(d.contadores);
          setValidTick({ tiempo_sim_utc: d.tiempo_sim_utc, contadores: d.contadores, tick: d.tick, progreso_pct: d.progreso_pct });
        }
        console.log(
          `[Sim] tick=${d.tick} | ${new Date(d.tiempo_sim_utc * 60 * 1000).toISOString().slice(0,16).replace('T',' ')} | ${d.progreso_pct}%`,
          d.contadores,
        );
      });

      es.addEventListener('aeropuertos', (e: MessageEvent) => {
        setAeropuertos(JSON.parse(e.data));
      });

      es.addEventListener('completado', (e: MessageEvent) => {
        const d = JSON.parse(e.data);
        if (d.contadores) setContadores(d.contadores);
        setProgresoPct(100);
        setFase('completado');
        es.close();
        esRef.current = null;
        console.log('[Sim] ✓ Simulación completada', d.contadores);
      });

      es.onerror = () => {
        // EventSource reintenta solo; pero si el BFF/Ejecutor cae de verdad,
        // acumulamos errores y tras varios intentos marcamos error explícito
        // en lugar de quedarnos colgados en 'ejecutando'.
        sseErroresRef.current += 1;
        if (es.readyState === EventSource.CLOSED || sseErroresRef.current >= 5) {
          es.close();
          if (esRef.current === es) esRef.current = null;
          setFase(prev => (prev === 'ejecutando' || prev === 'calentando' ? 'error' : prev));
          setErrorMsg('Se perdió la conexión con la simulación (SSE). Verifica que el Ejecutor y el BFF estén activos.');
        }
      };

    } catch (e: any) {
      setFase('error');
      setErrorMsg(e.message ?? 'Error al iniciar simulación');
    }
  }, [jobId]);

  const attachSimulationEventSourceListeners = (es: EventSource, scenario: SimulationScenario) => {
    es.addEventListener('open', () => { sseErroresRef.current = 0; });

    es.addEventListener('aeropuertos', (e: MessageEvent) => {
      setAeropuertos(JSON.parse(e.data));
    });

    // Lista compartida de vuelos cancelados. El backend la publica como
    // snapshot, por lo que todos los operarios ven las mismas líneas rojas.
    es.addEventListener('cancelaciones', (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        const items: VisualCancellation[] = (Array.isArray(parsed) ? parsed : [])
          .map((item: any) => ({
            id: String(item.id ?? `cancel-${item.origen}-${item.destino}-${item.salidaUTC}`),
            origen: String(item.origen ?? '').toUpperCase(),
            destino: String(item.destino ?? '').toUpperCase(),
            salidaUTC: Number(item.salidaUTC),
            llegadaUTC: Number(item.llegadaUTC),
            createdAtUTC: Number(item.createdAtUTC),
          }))
          .filter((item) => item.origen && item.destino
            && Number.isFinite(item.salidaUTC)
            && Number.isFinite(item.llegadaUTC)
            && Number.isFinite(item.createdAtUTC));
        setVisualCancellations(items);
      } catch (error) {
        console.warn('[Sim] evento cancelaciones ilegible:', error);
      }
    });

    es.addEventListener('tick', (e: MessageEvent) => {
      sseErroresRef.current = 0;
      const d = JSON.parse(e.data);
      setTiempoSimUTC(d.tiempo_sim_utc);
      setProgresoPct(parseFloat(d.progreso_pct ?? '0'));
      if (d.contadores) {
        setContadores(d.contadores);
        setValidTick({ tiempo_sim_utc: d.tiempo_sim_utc, contadores: d.contadores, tick: d.tick, progreso_pct: d.progreso_pct });
      }
      console.log(
        `[Sim:${scenario}] tick=${d.tick} | ${new Date(d.tiempo_sim_utc * 60 * 1000).toISOString().slice(0,16).replace('T',' ')} | ${d.progreso_pct}%`,
        d.contadores,
      );
    });

    es.addEventListener('plan-tramos', (e: MessageEvent) => {
      let arr: unknown;
      try {
        arr = JSON.parse(e.data);
      } catch (err) {
        // Un evento truncado/parcial no debe dejar el mapa sin aviones:
        // conservamos el último plan válido en vez de romper el handler.
        console.warn(`[Sim:${scenario}] plan-tramos ilegible (${(e.data ?? '').length} bytes), se mantiene el anterior`);
        return;
      }
      const tramos: PlanTramoVisual[] = (Array.isArray(arr) ? arr : []).map((v: any) => ({
        envioIndice: Number(v.envioIndice ?? 0), tramoIndex: Number(v.tramoIndex ?? 0),
        vueloId: Number.isFinite(Number(v.vueloId)) ? Number(v.vueloId) : undefined,
        desde: String(v.desde ?? '').toUpperCase(),
        hasta: String(v.hasta ?? '').toUpperCase(),
        salidaUTC: Number(v.salidaUTC), llegadaUTC: Number(v.llegadaUTC),
        maletas: Number(v.maletas ?? 1),
        origenEnvio: v.origenEnvio != null ? String(v.origenEnvio).toUpperCase() : undefined,
        destinoEnvio: v.destinoEnvio != null ? String(v.destinoEnvio).toUpperCase() : undefined,
        registroUTC: v.registroUTC != null ? Number(v.registroUTC) : undefined,
        deadlineUTC: v.deadlineUTC != null ? Number(v.deadlineUTC) : undefined,
      })).filter(t => Number.isFinite(t.salidaUTC) && Number.isFinite(t.llegadaUTC) && t.llegadaUTC > t.salidaUTC);
      planTramosRef.current = tramos;
      setPlanTramos(tramos);
      if (tramos.length > 0) {
        setLastStablePlan({
          generatedAtRealISO: new Date().toISOString(),
          simulationTimeUTC: lastValidTickRef.current?.tiempo_sim_utc ?? tiempoSimUTC,
          scenario,
          fase: 'ejecutando',
          contadores: lastValidTickRef.current?.contadores ?? contadores,
          resumen: planResumen,
          tramos,
        });
      }

      // El nuevo plan puede llegar por SSE casi inmediatamente después del POST.
      // El ref conserva de forma síncrona la foto "antes" y evita perder la auditoría.
      const nextAudits = cancellationAuditsRef.current.map((audit) => {
        if (audit.estado === 'sin_envios' || audit.envios.length === 0) return audit;

        let anyReassigned = false;
        let anyWaiting = false;
        const envios = audit.envios.map((envio) => {
          const rutaNueva = routeForShipment(tramos, envio.envioIndice);
          if (rutaNueva.length === 0) {
            return { ...envio, rutaNueva, estado: 'sin_ruta' as const };
          }
          const stillUsesCancelledFlight = rutaNueva.some((tramo) =>
            tramo.desde === audit.origen
            && tramo.hasta === audit.destino
            && Math.abs(tramo.salidaUTC - audit.salidaUTC) <= 1,
          );
          const changed = routeSignature(rutaNueva) !== routeSignature(envio.rutaAnterior);
          const estado = !stillUsesCancelledFlight && changed ? 'reasignado' : stillUsesCancelledFlight ? 'esperando' : 'sin_cambio';
          if (estado === 'reasignado') anyReassigned = true;
          if (estado === 'esperando') anyWaiting = true;
          return { ...envio, rutaNueva, estado };
        });

        return {
          ...audit,
          envios,
          estado: anyWaiting ? 'esperando_plan' : anyReassigned ? 'replanificado' : 'sin_cambio',
        };
      });
      cancellationAuditsRef.current = nextAudits;
      setCancellationAudits(nextAudits);
      setPlanVisualCargado(true);
      console.log(`[Sim:${scenario}] plan-tramos actualizado: ${tramos.length} tramos`);
    });

    es.addEventListener('completado', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      if (d.contadores) setContadores(d.contadores);
      setProgresoPct(100);
      setFase('completado');
      es.close();
      if (esRef.current === es) esRef.current = null;
      console.log(`[Sim:${scenario}] ✓ completado`, d.contadores);
    });

    es.addEventListener('fallo', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      const rawMsg = String(d.mensaje ?? d.message ?? 'Fallo en la simulación');
      if (scenario === 'collapse') {
        const failureType = classifyCollapseFailureType(rawMsg);
        const validTick = d.contadores ? {
          tiempo_sim_utc: d.tiempo_sim_utc ?? tiempoSimUTC,
          contadores: d.contadores,
          tick: d.tick,
          progreso_pct: d.progreso_pct,
        } : lastValidTickRef.current;

        if (validTick) {
          setContadores(validTick.contadores);
          setTiempoSimUTC(validTick.tiempo_sim_utc);
          setValidTick(validTick);
        }

        setCollapseFailure({
          technicalMessage: rawMsg,
          badge: 'Límite técnico alcanzado',
          type: failureType,
        });
        setPlanProgreso(100);
        setProgresoPct(100);
        setFase('completado');
        setErrorMsg(null);
        es.close();
        if (esRef.current === es) esRef.current = null;
        return;
      }

      setErrorMsg(rawMsg);
      setFase('error');
      es.close();
      if (esRef.current === es) esRef.current = null;
    });

    // El evento también puede llegar durante una corrida 5D: se usa precisamente
    // para tantear ventanas hasta encontrar la que contiene el 05/03/2027.
    es.addEventListener('colapso', (e: MessageEvent) => {
      const raw = JSON.parse(e.data);
      const result: CollapseResult = {
        tipo: String(raw.tipo ?? raw.type ?? 'logistico'),
        motivo: String(raw.motivo ?? raw.reason ?? 'Primer incumplimiento de entrega'),
        aeropuerto: raw.aeropuerto ?? raw.airport,
        ocupacion: Number(raw.ocupacion ?? raw.occupancy ?? 0),
        ta_seg: Number(raw.ta_seg ?? 0),
        sa_seg: Number(raw.sa_seg ?? 0),
        tiempo_sim_utc: Number(raw.tiempo_sim_utc),
        fecha_colapso_utc: String(raw.fecha_colapso_utc ?? ''),
        fecha_colapso_peru: String(raw.fecha_colapso_peru ?? ''),
        dia_simulado: Number(raw.dia_simulado ?? 0),
        envio_incumplido: raw.envio_incumplido != null ? Number(raw.envio_incumplido) : undefined,
        programado_demo: Boolean(raw.programado_demo),
        contadores: raw.contadores ?? { total: 0, pendiente: 0, en_vuelo: 0, en_escala: 0, entregado: 0, rechazado: 1 },
      };

      setCollapseResult(result);
      setCollapseFailure(null);
      setTiempoSimUTC(result.tiempo_sim_utc);
      setContadores(result.contadores);
      setValidTick({
        tiempo_sim_utc: result.tiempo_sim_utc,
        contadores: result.contadores,
        progreso_pct: '100.0',
      });
      setLastStablePlan((previous) => previous ? ({
        ...previous,
        simulationTimeUTC: result.tiempo_sim_utc,
        fase: 'completado',
        contadores: result.contadores,
      }) : previous);
      setFase('completado');
      setProgresoPct(100);
      setPlanResumen(prev => prev ?? ({
        totalEnvios: result.contadores.total,
        exitosos: result.contadores.entregado,
        rechazados: result.contadores.rechazado,
        ventanaIniUTC: Math.floor(config.startDate.getTime() / 60000),
        ventanaFinUTC: result.tiempo_sim_utc,
      }));
      console.log(`[Sim:${scenario}] colapso detectado`, result);
      es.close();
      if (esRef.current === es) esRef.current = null;
    });

    es.onerror = () => {
      sseErroresRef.current += 1;
      if (es.readyState === EventSource.CLOSED || sseErroresRef.current >= 5) {
        es.close();
        if (esRef.current === es) esRef.current = null;
        setFase(prev => (prev === 'ejecutando' || prev === 'calentando' ? 'error' : prev));
        setErrorMsg('Se perdió la conexión con la simulación (SSE).');
      }
    };
  };

  // ── Espectador (operario): suscribirse a una sim que arrancó OTRO navegador ──
  // El admin abre el SSE al iniciar la sim; el operario nunca la inicia, así que
  // pregunta por /estado y, si hay una activa, se suscribe. El broker del
  // ejecutor reenvía el último evento de cada tipo (snapshot) al conectar.
  const conectarEspectador = useCallback(async (): Promise<boolean> => {
    if (esRef.current && esRef.current.readyState !== EventSource.CLOSED) {
      setFase(prev => prev === 'idle' ? 'ejecutando' : prev);
      return true; // ya suscrito
    }
    if (esRef.current && esRef.current.readyState === EventSource.CLOSED) {
      esRef.current.close();
      esRef.current = null;
    }
    try {
      const r = await fetch(`${BFF}/api/simulacion/estado`, { headers: authHeader() });
      if (!r.ok) return false;
      const raw = await r.json();
      const j = raw?.data ?? raw;
      const estado = String(j?.estado ?? '');
      const activa = !!j?.activa || (estado !== '' && estado !== 'detenido' && estado !== 'completado');
      if (!activa) return false;
      sseErroresRef.current = 0;
      const es = new EventSource(`${BFF}/api/simulacion/eventos`);
      esRef.current = es;
      attachSimulationEventSourceListeners(es, j?.tipo === 'colapso' ? 'collapse' : 'period');
      setFase('ejecutando');
      return true;
    } catch {
      return false;
    }
  }, []);

  const iniciarColapsoProgramado = useCallback(async (
    opts: { startDate: Date; criterio?: CriterioOrden; warmUp?: boolean; k?: number; saSeg?: number; maxDias?: number; umbralColapso?: number; umbralRechazosPct?: number; bloquesRojoConsecutivos?: number }
  ) => {
    const efectivo = { ...config, ...opts };
    setErrorMsg(null);
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);
    setVisualCancellations([]);
    setCancellationAudits([]);
    setProgresoPct(0);
    setValidTick(null);
    setCollapseFailure(null);
    setCollapseResult(null);

    const d = efectivo.startDate;
    const t0utc = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60000);

    try {
      const res = await fetch(`${BFF}/api/simulacion/colapso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          t0_utc: t0utc,
          sa_seg: efectivo.saSeg ?? 300,
          k: efectivo.k ?? 21600,
          max_dias: efectivo.maxDias ?? 540,
          warmup: efectivo.warmUp ?? false,
          criterio: efectivo.criterio ?? 'EDF',
          umbral_colapso: efectivo.umbralColapso ?? 0.85,
          umbral_rechazos_pct: efectivo.umbralRechazosPct ?? 0.30,
          bloques_rojo_consecutivos: efectivo.bloquesRojoConsecutivos ?? 3,
          umbrales: {
            verde_hasta: 0.60,
            ambar_hasta: 0.85,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.mensaje ?? data.error ?? `HTTP ${res.status}`);

      setJobId('colapso');
      setFase('ejecutando');
      setWarmupPct(0);
      console.log(`[Colapso] iniciado | t0=${t0utc} k=${efectivo.k ?? 75} sa=${efectivo.saSeg ?? 120}s max_dias=${efectivo.maxDias ?? 540} warmup=${efectivo.warmUp ?? true}`);

      if (esRef.current) esRef.current.close();
      sseErroresRef.current = 0;
      const es = new EventSource(`${BFF}/api/simulacion/eventos`);
      esRef.current = es;
      attachSimulationEventSourceListeners(es, 'collapse');
    } catch (e: any) {
      setFase('error');
      setErrorMsg(e.message ?? 'Error al iniciar el colapso programado');
    }
  }, [config]);

  // ─── Iniciar simulación de PERIODO programada (esquema Sa/Sc) ──────────────
  // Un solo paso: lanza el orquestador del Ejecutor, que cada Sa consulta el
  // bloque [t0, H] a la BD, planifica (desde-datos) y emite el estado por SSE.
  const iniciarPeriodoProgramado = useCallback(async (
    opts: { startDate: Date; dias: number; criterio?: CriterioOrden; warmUp?: boolean; scMin?: number; saSeg?: number; usarCancelaciones?: boolean }
  ) => {
    const efectivo = { ...config, ...opts };
    setFase('planificando');
    setErrorMsg(null);
    setPlanTramos([]); setPlanResumen(null); setPlanVisualCargado(false);
    setVisualCancellations([]);
    setCancellationAudits([]);
    setProgresoPct(0);
    setCollapseFailure(null);
    setCollapseResult(null);

    // Fecha elegida → minuto epoch UTC (GMT=0, igual que el planificador).
    const d = efectivo.startDate;
    const t0utc = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60000);
    const fechaInicioLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    // En Sim3D/5D/7D, tiempo=0 es exactamente la fecha/hora elegida.
    // El primer bloque consume datos futuros desde t0 hacia adelante.
    setTiempoSimUTC(t0utc);
    // Valores calibrados (por defecto Periodo): 30 bloques → duración real objetivo configurable.
    // Tiempo Real los sobreescribe con Sc=60, Sa=60s (K=60: 1 min-dato/seg-real).
    const sc    = opts.scMin ?? (efectivo.dias * 48);
    const saSeg = opts.saSeg ?? 120;

    try {
      const requestBody = {
        t0_utc:  t0utc,
        fecha_inicio_local: fechaInicioLocal,
        dias:    efectivo.dias,
        sc,
        sa_seg:  saSeg,
        warmup:  efectivo.warmUp ?? false,
        criterio: efectivo.criterio ?? 'EDF',
        // El archivo de cancelaciones solo aplica a Periodo/Colapso, no a día a día.
        usar_cancelaciones: opts.usarCancelaciones ?? true,
        umbrales: {
          verde_hasta: config.thresholds.warehouse.green  / 100,
          ambar_hasta: config.thresholds.warehouse.yellow / 100,
        },
      };

      const lanzar = () => fetch(`${BFF}/api/simulacion/periodo-programado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(requestBody),
      });

      let res = await lanzar();
      // Respaldo del cliente: si una VM todavía responde 409 por una corrida
      // anterior, Sim5D la detiene y reintenta una sola vez.
      if (res.status === 409 && efectivo.dias === 5) {
        await fetch(`${BFF}/api/simulacion/detener`, { method: 'POST', headers: authHeader() }).catch(() => null);
        await new Promise(resolve => setTimeout(resolve, 350));
        res = await lanzar();
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.mensaje ?? data.message ?? data.error ?? `HTTP ${res.status}`);

      setJobId('periodo');
      setFase('ejecutando');
      console.log(`[Periodo] iniciado | t0=${t0utc} dias=${efectivo.dias} sc=${sc} sa=${saSeg}s bloques=${data.bloques} warmup=${efectivo.warmUp}`);

      if (esRef.current) esRef.current.close();
      sseErroresRef.current = 0;
      const es = new EventSource(`${BFF}/api/simulacion/eventos`);
      esRef.current = es;
      attachSimulationEventSourceListeners(es, 'period');

    } catch (e: any) {
      setFase('error');
      setErrorMsg(e.message ?? 'Error al iniciar el periodo programado');
    }
  }, [config]);

  // ─── Pausar ───────────────────────────────────────────────────────────────
  // Solo tiene sentido en 'ejecutando'. Durante 'calentando' el backend responde
  // 409 (el warm-up no es pausable); en ese caso no tocamos la UI.
  const pausarSimulacion = useCallback(async () => {
    if (fase !== 'ejecutando') return;
    try {
      const res = await fetch(`${BFF}/api/simulacion/pausar`, { method: 'POST', headers: authHeader() });
      if (res.ok) {
        setFase('pausado');
      } else {
        console.warn('[Sim] pausar rechazado por el backend:', res.status);
      }
    } catch (e) {
      console.warn('[Sim] error al pausar:', e);
    }
  }, [fase]);

  const registrarCancelacionVisual = useCallback((cancelacion: VisualCancellation) => {
    setVisualCancellations((prev) => [
      cancelacion,
      ...prev.filter((item) => item.id !== cancelacion.id),
    ].slice(0, 50));
  }, []);

  const routeForShipment = useCallback((tramos: PlanTramoVisual[], envioIndice: number): ReassignmentLeg[] =>
    tramos
      .filter((tramo) => tramo.envioIndice === envioIndice)
      .sort((a, b) => a.tramoIndex - b.tramoIndex)
      .map((tramo) => ({
        desde: tramo.desde,
        hasta: tramo.hasta,
        salidaUTC: tramo.salidaUTC,
        llegadaUTC: tramo.llegadaUTC,
      })), []);

  const routeSignature = useCallback((ruta: ReassignmentLeg[]) =>
    ruta.map((tramo) => `${tramo.desde}-${tramo.hasta}-${tramo.salidaUTC}-${tramo.llegadaUTC}`).join('|'), []);

  // ─── Cancelar ocurrencia de vuelo (Flujo B: desde el buscador) ─────────────
  // Registra la cancelación (vuelo, día) en el orquestador, que re-planifica el
  // bloque actual de inmediato. El plan re-ruteado llega por SSE (plan-tramos).
  const cancelarVuelo = useCallback(async (
    origen: string,
    destino: string,
    salidaUTC: number,
    vueloId?: number,
    llegadaUTC?: number,
  ): Promise<boolean> => {
    const normalizedOrigin = origen.toUpperCase();
    const normalizedDestination = destino.toUpperCase();
    const currentPlan = planTramosRef.current.length > 0 ? planTramosRef.current : planTramos;
    const affectedIndices = Array.from(new Set(
      currentPlan
        .filter((tramo) => {
          const tieneIdExacto = Number.isFinite(vueloId) && Number.isFinite(tramo.vueloId);
          if (tieneIdExacto) {
            return Number(tramo.vueloId) === Number(vueloId)
              && Math.abs(tramo.salidaUTC - salidaUTC) <= 1;
          }
          return tramo.desde === normalizedOrigin
            && tramo.hasta === normalizedDestination
            && Math.abs(tramo.salidaUTC - salidaUTC) <= 1;
        })
        .map((tramo) => tramo.envioIndice),
    ));
    const auditId = `${normalizedOrigin}-${normalizedDestination}-${salidaUTC}`;
    const audit: CancellationAudit = {
      id: auditId,
      origen: normalizedOrigin,
      destino: normalizedDestination,
      salidaUTC,
      solicitadoUTC: lastValidTickRef.current?.tiempo_sim_utc ?? tiempoSimUTC,
      estado: affectedIndices.length > 0 ? 'esperando_plan' : 'sin_envios',
      envios: affectedIndices.map((envioIndice) => {
        const rutaAnterior = routeForShipment(currentPlan, envioIndice);
        const maletas = currentPlan.find((tramo) => tramo.envioIndice === envioIndice)?.maletas ?? 0;
        return { envioIndice, maletas, rutaAnterior, rutaNueva: [], estado: 'esperando' as const };
      }),
    };

    // Registrar la foto "antes" antes de llamar al backend. Así, aunque el
    // evento SSE del nuevo plan llegue inmediatamente, la comparación no se pierde.
    const nextAudits = [audit, ...cancellationAuditsRef.current.filter((item) => item.id !== auditId)].slice(0, 50);
    cancellationAuditsRef.current = nextAudits;
    setCancellationAudits(nextAudits);

    try {
      const res = await fetch(`${BFF}/api/simulacion/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          vueloId: Number.isFinite(vueloId) ? vueloId : undefined,
          origen: normalizedOrigin,
          destino: normalizedDestination,
          salidaUTC,
          llegadaUTC: Number.isFinite(llegadaUTC) ? llegadaUTC : undefined,
          createdAtUTC: lastValidTickRef.current?.tiempo_sim_utc ?? tiempoSimUTC,
        }),
      });
      if (!res.ok) {
        const rollbackAudits = cancellationAuditsRef.current.filter((item) => item.id !== auditId);
        cancellationAuditsRef.current = rollbackAudits;
        setCancellationAudits(rollbackAudits);
        console.warn('[Sim] cancelar vuelo rechazado por el backend:', res.status);
        return false;
      }
      // Respuesta visual inmediata en el cliente que canceló; el evento SSE
      // "cancelaciones" sincroniza después la lista con las demás cuentas.
      if (Number.isFinite(llegadaUTC) && Number(llegadaUTC) > salidaUTC) {
        const visual: VisualCancellation = {
          id: `cancel-${normalizedOrigin}-${normalizedDestination}-${salidaUTC}`,
          origen: normalizedOrigin,
          destino: normalizedDestination,
          salidaUTC,
          llegadaUTC: Number(llegadaUTC),
          createdAtUTC: lastValidTickRef.current?.tiempo_sim_utc ?? tiempoSimUTC,
        };
        setVisualCancellations((prev) => [visual, ...prev.filter((item) => item.id !== visual.id)].slice(0, 50));
      }
      return true;
    } catch (e) {
      const rollbackAudits = cancellationAuditsRef.current.filter((item) => item.id !== auditId);
      cancellationAuditsRef.current = rollbackAudits;
      setCancellationAudits(rollbackAudits);
      console.warn('[Sim] error al cancelar vuelo:', e);
      return false;
    }
  }, [planTramos, routeForShipment, tiempoSimUTC]);

  const setValidTick = useCallback((tick: { tiempo_sim_utc: number; contadores: Contadores; tick?: number; progreso_pct?: string } | null) => {
    lastValidTickRef.current = tick;
    setLastValidTick(tick);
  }, []);

  const clearCollapseState = useCallback(() => {
    setValidTick(null);
    setCollapseFailure(null);
    setCollapseResult(null);
  }, [setValidTick]);

  // ─── Reanudar ─────────────────────────────────────────────────────────────
  const reanudarSimulacion = useCallback(async () => {
    if (fase !== 'pausado') return;
    try {
      const res = await fetch(`${BFF}/api/simulacion/reanudar`, { method: 'POST', headers: authHeader() });
      if (res.ok) {
        setFase('ejecutando');
      } else {
        console.warn('[Sim] reanudar rechazado por el backend:', res.status);
      }
    } catch (e) {
      console.warn('[Sim] error al reanudar:', e);
    }
  }, [fase]);

  // ─── Detener ──────────────────────────────────────────────────────────────
  // Detener SIEMPRE limpia la UI local, aunque el backend falle: el usuario
  // quiere abortar. Cerramos el SSE primero para no recibir más eventos.
  const detenerSimulacion = useCallback(async () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    try {
      await fetch(`${BFF}/api/simulacion/detener`, { method: 'POST', headers: authHeader() });
    } catch (e) {
      console.warn('[Sim] error al detener (se limpia la UI igual):', e);
    }
    setFase('idle');
    setJobId(null);
    setProgresoPct(0);
    setWarmupPct(0);
    setTiempoSimUTC(0);
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);
    setVisualCancellations([]);
    setCancellationAudits([]);
    clearCollapseState();
  }, [clearCollapseState]);

  // ─── Resetear ─────────────────────────────────────────────────────────────
  const resetear = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (esRef.current)   { esRef.current.close(); esRef.current = null; }
    setFase('idle');
    setJobId(null);
    setPlanProgreso(0);
    setPlanMensaje('');
    setTiempoSimUTC(0);
    setProgresoPct(0);
    setWarmupPct(0);
    setContadores({ total: 0, pendiente: 0, en_vuelo: 0, en_escala: 0, entregado: 0, rechazado: 0 });
    setAeropuertos([]);
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);
    setVisualCancellations([]);
    setCancellationAudits([]);
    setErrorMsg(null);
    clearCollapseState();
  }, [clearCollapseState]);

  // ─── updateConfig ─────────────────────────────────────────────────────────
  const updateConfig = useCallback((patch: Partial<SimulationConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  }, []);

  // ─── Derivados ────────────────────────────────────────────────────────────
  const isRunning     = fase === 'ejecutando';
  const simulationTime = tiempoSimUTC > 0
    ? new Date(tiempoSimUTC * 60 * 1000)
    : config.startDate;

  // Stats derivados de contadores (usados por UnifiedDashboard y otros)
  const stats: SimulationStats = {
    totalBaggage:       contadores.total,
    delivered:          contadores.entregado,
    inTransit:          contadores.en_vuelo + contadores.en_escala,
    delayed:            0,
    notBoarded:         contadores.rechazado,
    onTimeDeliveryRate: contadores.total > 0
      ? (contadores.entregado / contadores.total) * 100
      : 0,
  };

  const baggages: Baggage[] = []; // sin detalle por envío en este contexto

  const getAirportStats = useCallback(
    (airportId: string) => {
      const frontAirport = airports.find(a => a.id === airportId);
      if (!frontAirport) return null;
      const liveAp = aeropuertosState.find(a => a.iata === frontAirport.code);
      if (!liveAp) return null;
      return {
        occupancy:  liveAp.maletas_almacen,
        capacity:   liveAp.capacidad_almacen,
        percentage: liveAp.ocupacion * 100,
      };
    },
    [aeropuertosState],
  );

  // ─── Compatibilidad legacy ────────────────────────────────────────────────
  const startSimulation = useCallback(() => {
    if (fase === 'listo')   iniciarSimulacion();
    else if (fase === 'pausado') reanudarSimulacion();
    else if (fase === 'idle') {
      if (config.scenario === 'collapse') {
        iniciarColapsoProgramado({
          startDate: config.startDate,
          criterio: config.criterio,
          warmUp: false,
          k: config.velocidadColapsoK ?? 3600,
          saSeg: 300,
          maxDias: 540,
          umbralColapso: 0.85,
          umbralRechazosPct: 0.30,
          bloquesRojoConsecutivos: 3,
        });
      } else {
        iniciarPlanificacion();
      }
    }
  }, [fase, iniciarSimulacion, reanudarSimulacion, iniciarPlanificacion, iniciarColapsoProgramado, config]);

  const pauseSimulation = useCallback(() => {
    pausarSimulacion();
  }, [pausarSimulacion]);

  const resetSimulation = useCallback(() => {
    resetear();
  }, [resetear]);

  return (
    <SimulationContext.Provider value={{
      fase,
      errorMsg,
      jobId,
      planProgreso,
      planMensaje,
      isRunning,
      simulationTime,
      tiempoSimUTC,
      progresoPct,
      warmupPct,
      contadores,
      aeropuertosState,
      planTramos,
      planResumen,
      planVisualCargado,
      visualCancellations,
      cancellationAudits,
      lastStablePlan,
      config,
      datasetInfo,
      stats,
      baggages,
      getAirportStats,
      lastValidTick,
      collapseFailure,
      collapseResult,
      updateConfig,
      iniciarPlanificacion,
      iniciarPeriodoProgramado,
      iniciarColapsoProgramado,
      iniciarSimulacion,
      pausarSimulacion,
      reanudarSimulacion,
      detenerSimulacion,
      conectarEspectador,
      cancelarVuelo,
      registrarCancelacionVisual,
      resetear,
      startSimulation,
      pauseSimulation,
      resetSimulation,
    }}>
      {children}
    </SimulationContext.Provider>
  );
};
