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
} from '../types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const BFF = 'http://localhost:8081';

const CONFIG_DEFAULT: SimulationConfig = {
  scenario:       'period',
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

  // ── Configuración ──
  config: SimulationConfig;
  datasetInfo: DatasetInfo | null;

  // ── Acciones ──
  updateConfig: (patch: Partial<SimulationConfig>) => void;
  iniciarPlanificacion: () => Promise<void>;
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

  // ─── Iniciar planificación ────────────────────────────────────────────────
  const iniciarPlanificacion = useCallback(async () => {
    setFase('planificando');
    setErrorMsg(null);
    setPlanProgreso(0);
    setPlanMensaje('Iniciando planificación...');

    const fechaISO = config.startDate.toISOString().slice(0, 10);

    try {
      const res = await fetch(`${BFF}/api/planificacion/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fechaInicio: fechaISO,
          dias:        config.dias,
          criterio:    config.criterio,
          semilla:     42,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.mensaje ?? data.error ?? `HTTP ${res.status}`);
      }

      const jid = data.jobId;
      setJobId(jid);

      // Polling cada 2 segundos
      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`${BFF}/api/planificacion/status/${jid}`);
          const sd = await sr.json();
          setPlanProgreso(sd.progreso ?? 0);
          setPlanMensaje(sd.mensaje ?? '');

          if (sd.estado === 'COMPLETADO') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setFase('listo');
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
  }, [config]);

  // ─── Iniciar simulación ───────────────────────────────────────────────────
  const iniciarSimulacion = useCallback(async () => {
    if (!jobId) return;

    try {
      const res = await fetch(`${BFF}/api/simulacion/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id:           jobId,
          duracion_real_min: config.duracionRealMin,
          umbrales: {
            verde_hasta: config.thresholds.warehouse.green / 100,
            ambar_hasta: config.thresholds.warehouse.yellow / 100,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.mensaje ?? data.error ?? `HTTP ${res.status}`);
      }

      setFase('ejecutando');

      // Suscribir SSE
      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${BFF}/api/simulacion/eventos`);
      esRef.current = es;

      es.addEventListener('tick', (e: MessageEvent) => {
        const d = JSON.parse(e.data);
        setTiempoSimUTC(d.tiempo_sim_utc);
        setProgresoPct(parseFloat(d.progreso_pct ?? '0'));
        if (d.contadores) setContadores(d.contadores);
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
      });

      es.onerror = () => {
        // SSE se reconecta automáticamente; solo cerramos si ya completó
      };

    } catch (e: any) {
      setFase('error');
      setErrorMsg(e.message ?? 'Error al iniciar simulación');
    }
  }, [jobId, config]);

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
      config,
      datasetInfo,
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
