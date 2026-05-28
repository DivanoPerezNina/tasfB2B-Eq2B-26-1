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

const BFF = 'http://localhost:8081';

const CONFIG_DEFAULT: SimulationConfig = {
  scenario:       'realtime',
  startDate:      new Date('2026-01-15'),
  dias:           7,
  duracionRealMin: 60,
  criterio:       'EDF',
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
  progresoPct: number;    // 0-100
  contadores: Contadores;
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
  iniciarPlanificacion: (overrides?: Partial<Pick<SimulationConfig, 'startDate' | 'dias' | 'criterio' | 'duracionRealMin'>>) => Promise<void>;
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
  const [contadores, setContadores]         = useState<Contadores>({
    total: 0, pendiente: 0, en_vuelo: 0, en_escala: 0, entregado: 0, rechazado: 0,
  });
  const [aeropuertosState, setAeropuertos]  = useState<AeropuertoEstado[]>([]);
  const [planTramos, setPlanTramos]          = useState<PlanTramoVisual[]>([]);
  const [planResumen, setPlanResumen]        = useState<PlanResumenVisual | null>(null);
  const [planVisualCargado, setPlanVisualCargado] = useState(false);
  const esRef = useRef<EventSource | null>(null);

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
          // Poner startDate dentro del rango del dataset
          const fechaIni = new Date(d.fecha_min.slice(0, 10) + 'T00:00:00');
          setConfig(prev => ({ ...prev, startDate: fechaIni }));
        }
      })
      .catch(() => { /* silencioso — servicio puede no estar levantado */ });
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

  // ─── Iniciar planificación ────────────────────────────────────────────────
  const iniciarPlanificacion = useCallback(async (
    overrides?: Partial<Pick<SimulationConfig, 'startDate' | 'dias' | 'criterio' | 'duracionRealMin'>>
  ) => {
    const efectivo = { ...config, ...overrides };
    setFase('planificando');
    setErrorMsg(null);
    setPlanProgreso(0);
    setPlanMensaje('Iniciando planificación...');
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);

    const fechaISO = efectivo.startDate.toISOString().slice(0, 10);

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
      const es = new EventSource(`${BFF}/api/simulacion/eventos`);
      esRef.current = es;

      es.addEventListener('tick', (e: MessageEvent) => {
        const d = JSON.parse(e.data);
        setTiempoSimUTC(d.tiempo_sim_utc);
        setProgresoPct(parseFloat(d.progreso_pct ?? '0'));
        if (d.contadores) setContadores(d.contadores);
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
        // SSE se reconecta automáticamente; solo cerramos si ya completó
      };

    } catch (e: any) {
      setFase('error');
      setErrorMsg(e.message ?? 'Error al iniciar simulación');
    }
  }, [jobId]);

  // ─── Pausar ───────────────────────────────────────────────────────────────
  const pausarSimulacion = useCallback(async () => {
    await fetch(`${BFF}/api/simulacion/pausar`, { method: 'POST' });
    setFase('pausado');
  }, []);

  // ─── Reanudar ─────────────────────────────────────────────────────────────
  const reanudarSimulacion = useCallback(async () => {
    await fetch(`${BFF}/api/simulacion/reanudar`, { method: 'POST' });
    setFase('ejecutando');
  }, []);

  // ─── Detener ──────────────────────────────────────────────────────────────
  const detenerSimulacion = useCallback(async () => {
    await fetch(`${BFF}/api/simulacion/detener`, { method: 'POST' });
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setFase('idle');
    setJobId(null);
    setProgresoPct(0);
    setTiempoSimUTC(0);
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);
  }, []);

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
    setContadores({ total: 0, pendiente: 0, en_vuelo: 0, en_escala: 0, entregado: 0, rechazado: 0 });
    setAeropuertos([]);
    setPlanTramos([]);
    setPlanResumen(null);
    setPlanVisualCargado(false);
    setErrorMsg(null);
  }, []);

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
        percentage: parseFloat(liveAp.ocupacion) * 100,
      };
    },
    [aeropuertosState],
  );

  // ─── Compatibilidad legacy ────────────────────────────────────────────────
  const startSimulation = useCallback(() => {
    if (fase === 'listo')   iniciarSimulacion();
    else if (fase === 'pausado') reanudarSimulacion();
    else if (fase === 'idle')    iniciarPlanificacion();
  }, [fase, iniciarSimulacion, reanudarSimulacion, iniciarPlanificacion]);

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
      updateConfig,
      iniciarPlanificacion,
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
