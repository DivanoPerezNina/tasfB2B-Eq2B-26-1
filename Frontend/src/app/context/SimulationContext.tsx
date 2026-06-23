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
} from '../types';
import { airports } from '../data/airports';

// ─── Constantes ───────────────────────────────────────────────────────────────

const BFF = ((import.meta as any).env?.VITE_BFF_URL ?? '') as string;

const CONFIG_DEFAULT: SimulationConfig = {
  scenario:       'period',
  startDate:      new Date('2026-01-15'),
  dias:           5,
  duracionRealMin: 60,
  criterio:       'EDF',
  warmUp:         true,       // default: sembrar el estado de la red en la fecha elegida
                              // (aviones en vuelo + almacenes ocupados). "Desde cero" lo apaga.
  speed:          1,          // derivado; no se usa directamente
  thresholds: {
    warehouse: { green: 60, yellow: 80, red: 95 },
    flight:    { green: 60, yellow: 80, red: 95 },
  },
  algorithmParams: {},
};

// ─── Tipos del contexto ───────────────────────────────────────────────────────

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
  aeropuertosState: AeropuertoEstado[];
  /** Tramos reales del plan generado por el planificador. Se usan solo para la visualización del mapa. */
  planTramos: PlanTramoVisual[];
  planResumen: PlanResumenVisual | null;
  planVisualCargado: boolean;

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
  iniciarPeriodoProgramado: (opts: { startDate: Date; dias: number; criterio?: CriterioOrden; warmUp?: boolean; scMin?: number; saSeg?: number }) => Promise<void>;
  iniciarColapsoProgramado: (opts: { startDate: Date; criterio?: CriterioOrden; warmUp?: boolean; k?: number; saSeg?: number; maxDias?: number; umbralColapso?: number; umbralRechazosPct?: number; bloquesRojoConsecutivos?: number }) => Promise<void>;
  iniciarSimulacion: () => Promise<void>;
  pausarSimulacion: () => Promise<void>;
  reanudarSimulacion: () => Promise<void>;
  detenerSimulacion: () => Promise<void>;
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
  const [aeropuertosState, setAeropuertos]  = useState<AeropuertoEstado[]>([]);
  const [planTramos, setPlanTramos]          = useState<PlanTramoVisual[]>([]);
  const [planResumen, setPlanResumen]        = useState<PlanResumenVisual | null>(null);
  const [planVisualCargado, setPlanVisualCargado] = useState(false);
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


  // ─── Cargar tramos reales del plan para la visualización del mapa ─────────
  const cargarPlanVisual = useCallback(async (jid: string) => {
    setPlanVisualCargado(false);
    setPlanTramos([]);
    setPlanResumen(null);

    try {
      const res = await fetch(`${BFF}/api/planificacion/resultado/${jid}`);
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
            desde: String(tramo.desde ?? '').toUpperCase(),
            hasta: String(tramo.hasta ?? '').toUpperCase(),
            salidaUTC,
            llegadaUTC,
            maletas: Number(envio.maletas ?? 1),
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

    // Enviar fecha+hora local como YYYY-MM-DDTHH:MM
    // El planificador trabaja en epoch-minutos UTC y usa GMT=0 al recibir este campo
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = efectivo.startDate;
    const fechaISO = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    try {
      // Usa el endpoint unificado del BFF que recibe todos los parámetros a la vez
      const res = await fetch(`${BFF}/api/periodo/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          const sr = await fetch(`${BFF}/api/periodo/status/${jid}`);
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
      const arr = JSON.parse(e.data);
      const tramos: PlanTramoVisual[] = (Array.isArray(arr) ? arr : []).map((v: any) => ({
        envioIndice: Number(v.envioIndice ?? 0), tramoIndex: Number(v.tramoIndex ?? 0),
        desde: String(v.desde ?? '').toUpperCase(),
        hasta: String(v.hasta ?? '').toUpperCase(),
        salidaUTC: Number(v.salidaUTC), llegadaUTC: Number(v.llegadaUTC),
        maletas: Number(v.maletas ?? 1),
      })).filter(t => Number.isFinite(t.salidaUTC) && Number.isFinite(t.llegadaUTC) && t.llegadaUTC > t.salidaUTC);
      setPlanTramos(tramos);
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

    if (scenario === 'collapse') {
      es.addEventListener('colapso', (e: MessageEvent) => {
        const d = JSON.parse(e.data);
        if (d.contadores) setContadores(d.contadores);
        setFase('completado');
        setProgresoPct(100);
        setPlanResumen(prev => prev ?? ({
          totalEnvios: d.total_envios,
          exitosos: d.exitosos,
          rechazados: d.rechazados ?? d.contadores?.rechazado,
          ventanaIniUTC: d.t0_utc,
          ventanaFinUTC: d.fin_utc,
        }));
        console.log('[Sim:collapse] colapso detectado:', {
          tipo: d.tipo ?? d.type,
          motivo: d.motivo ?? d.reason,
          aeropuerto: d.aeropuerto ?? d.airport,
          ocupacion: d.ocupacion ?? d.occupancy,
          ta_seg: d.ta_seg,
          sa_seg: d.sa_seg,
        });
        es.close();
        if (esRef.current === es) esRef.current = null;
      });
    }

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

  const iniciarColapsoProgramado = useCallback(async (
    opts: { startDate: Date; criterio?: CriterioOrden; warmUp?: boolean; k?: number; saSeg?: number; maxDias?: number; umbralColapso?: number; umbralRechazosPct?: number; bloquesRojoConsecutivos?: number }
  ) => {
    const efectivo = { ...config, ...opts };
    setErrorMsg(null);
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);
    setProgresoPct(0);
    setValidTick(null);
    setCollapseFailure(null);

    const d = efectivo.startDate;
    const t0utc = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60000);

    try {
      const res = await fetch(`${BFF}/api/simulacion/colapso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    opts: { startDate: Date; dias: number; criterio?: CriterioOrden; warmUp?: boolean; scMin?: number; saSeg?: number }
  ) => {
    const efectivo = { ...config, ...opts };
    setErrorMsg(null);
    setPlanTramos([]); setPlanResumen(null); setPlanVisualCargado(false);
    setProgresoPct(0);

    // Fecha elegida → minuto epoch UTC (GMT=0, igual que el planificador).
    const d = efectivo.startDate;
    const t0utc = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60000);
    // Valores calibrados (por defecto Periodo): 30 bloques → ~60 min (Sa=120s, Sc=dias·48).
    // Tiempo Real los sobreescribe con Sc=60, Sa=60s (K=60: 1 min-dato/seg-real).
    const sc    = opts.scMin ?? (efectivo.dias * 48);
    const saSeg = opts.saSeg ?? 120;

    try {
      const res = await fetch(`${BFF}/api/simulacion/periodo-programado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          t0_utc:  t0utc,
          dias:    efectivo.dias,
          sc,
          sa_seg:  saSeg,
          warmup:  efectivo.warmUp ?? false,
          criterio: efectivo.criterio ?? 'EDF',
          umbrales: {
            verde_hasta: config.thresholds.warehouse.green  / 100,
            ambar_hasta: config.thresholds.warehouse.yellow / 100,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.mensaje ?? data.error ?? `HTTP ${res.status}`);

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
      const res = await fetch(`${BFF}/api/simulacion/pausar`, { method: 'POST' });
      if (res.ok) {
        setFase('pausado');
      } else {
        console.warn('[Sim] pausar rechazado por el backend:', res.status);
      }
    } catch (e) {
      console.warn('[Sim] error al pausar:', e);
    }
  }, [fase]);

  const setValidTick = useCallback((tick: { tiempo_sim_utc: number; contadores: Contadores; tick?: number; progreso_pct?: string } | null) => {
    lastValidTickRef.current = tick;
    setLastValidTick(tick);
  }, []);

  const clearCollapseState = useCallback(() => {
    setValidTick(null);
    setCollapseFailure(null);
  }, [setValidTick]);

  // ─── Reanudar ─────────────────────────────────────────────────────────────
  const reanudarSimulacion = useCallback(async () => {
    if (fase !== 'pausado') return;
    try {
      const res = await fetch(`${BFF}/api/simulacion/reanudar`, { method: 'POST' });
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
      await fetch(`${BFF}/api/simulacion/detener`, { method: 'POST' });
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
      config,
      datasetInfo,
      stats,
      baggages,
      getAirportStats,
      lastValidTick,
      collapseFailure,
      updateConfig,
      iniciarPlanificacion,
      iniciarPeriodoProgramado,
      iniciarColapsoProgramado,
      iniciarSimulacion,
      pausarSimulacion,
      reanudarSimulacion,
      detenerSimulacion,
      resetear,
      startSimulation,
      pauseSimulation,
      resetSimulation,
    }}>
      {children}
    </SimulationContext.Provider>
  );
};
