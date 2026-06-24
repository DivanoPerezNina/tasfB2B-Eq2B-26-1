export type Continent = 'America' | 'Asia' | 'Europe';

export type BaggageType = 'Negocio' | 'Normal';

export type BaggageStatus = 'en_almacen' | 'en_transito' | 'entregada' | 'retrasada' | 'no_embarcada';

export type AirportTier = 1 | 2 | 3; // 1: Hub principal, 2: Aeropuerto regional, 3: Aeropuerto pequeño

export interface Airport {
  id: string;
  code: string;
  name: string;
  city: string;
  continent: Continent;
  coordinates: { x: number; y: number }; // legacy SVG coords
  lat: number;
  lng: number;
  warehouseCapacity: number;
  currentOccupancy: number;
  tier: AirportTier;
}

export interface Flight {
  id: string;
  fromAirportId: string;
  toAirportId: string;
  capacity: number;
  currentLoad: number;
  duration: number; // en días
  sameContinentRoute: boolean;
}

export interface Baggage {
  id: string;
  type: BaggageType;
  airline: string;
  originAirportId: string;
  destinationAirportId: string;
  currentAirportId: string;
  status: BaggageStatus;
  registrationTime: Date;
  estimatedDeliveryTime: Date;
  actualDeliveryTime?: Date;
  plannedRoute: string[];
  actualRoute: string[];
  isDelayed: boolean;
  affectedByCancellation: boolean;
}

export interface FlightCancellation {
  id: string;
  flightId: string;
  cancellationTime: Date;
  affectedBaggageIds: string[];
}

export type SimulationScenario = 'realtime' | 'period' | 'collapse';

export type CriterioOrden = 'EDF' | 'FIFO' | 'ALEATORIO';

export interface SimulationConfig {
  scenario: SimulationScenario;
  startDate: Date;
  endDate?: Date;
  /** Días a simular: 3, 5 ó 7 */
  dias: number;
  /** Duración real de la simulación en minutos (30–90) */
  duracionRealMin: number;
  /** Criterio de ordenamiento para GVNS */
  criterio: CriterioOrden;
  /**
   * Si true, el planificador reconstruye el estado de la red desde el inicio
   * del dataset hasta la fecha elegida (procesa maletas pasadas).
   * Si false (default), tiempo=0 es la fecha elegida y solo se procesan
   * maletas desde ese momento — comportamiento requerido por Sim5D.
   */
  warmUp: boolean;
  /** Velocidad del escenario Colapso: K = min-dato/min-real (avance = K/60 h por seg). 3600=1h/s, 18000=5h/s, 36000=10h/s. */
  velocidadColapsoK?: number;
  /** @deprecated Derivado de duracionRealMin — sólo para compatibilidad con componentes legacy */
  speed: number;
  thresholds: {
    warehouse: { green: number; yellow: number; red: number };
    flight: { green: number; yellow: number; red: number };
  };
  algorithmParams: Record<string, any>;
}

// ─── Tipos del backend (simulación en vivo) ───────────────────────────────────

export type FaseSimulacion =
  | 'idle'
  | 'planificando'
  | 'listo'
  | 'calentando'   // warm-up turbo: reproduciendo el tramo previo a máxima velocidad
  | 'ejecutando'
  | 'pausado'
  | 'completado'
  | 'error';

export interface Contadores {
  total:     number;
  pendiente: number;
  en_vuelo:  number;
  en_escala: number;
  entregado: number;
  rechazado: number;
}

export interface AeropuertoEstado {
  iata:              string;
  maletas_almacen:   number;
  capacidad_almacen: number;
  ocupacion:         number; // 0..1 (ej. 0.450)
  semaforo:          'verde' | 'ambar' | 'rojo';
}


export interface PlanTramoVisual {
  envioIndice: number;
  tramoIndex: number;
  desde: string;
  hasta: string;
  salidaUTC: number;
  llegadaUTC: number;
  maletas: number;
}

export interface PlanResumenVisual {
  totalEnvios?: number;
  exitosos?: number;
  rechazados?: number;
  ventanaIniUTC?: number;
  ventanaFinUTC?: number;
}

export interface DatasetInfo {
  fecha_min:    string;
  fecha_max:    string;
  total_envios: string;
}

export interface SimulationStats {
  totalBaggage: number;
  delivered: number;
  inTransit: number;
  delayed: number;
  notBoarded: number;
  onTimeDeliveryRate: number;
  /** SLA cumplimiento continental (0-100). Populated by backend when available. */
  slaContinental?: number;
  /** SLA cumplimiento intercontinental (0-100). Populated by backend when available. */
  slaIntercontinental?: number;
}

// ─── Modelo de datos del backend GVNS ───

export interface Aeropuerto {
  id: number;
  iata: string;
  continente: number; // 1 = América, 2 = Europa, 3 = Asia
  gmt: number;
  capacidadAlmacen: number;
}

export interface Vuelo {
  idOrigen: number;
  idDestino: number;
  salidaUTC: number;   // minutos del día UTC (0-1439)
  llegadaUTC: number;
  capacidadMaxima: number;
  ocupacionActual?: number;
}

export interface Envio {
  id: string;
  idOrigen: number;
  idDestino: number;
  cantidadMaletas: number;
  registroUTC: number;   // minuto absoluto desde epoch
  deadlineUTC: number;
  estado: 'Exitoso' | 'Rechazado' | 'SalvadoGVNS';
  rutaAsignada?: number[]; // secuencia de IDs de aeropuertos en la ruta
}