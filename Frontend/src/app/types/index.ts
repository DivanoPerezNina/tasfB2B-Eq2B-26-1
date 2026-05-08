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

export interface SimulationConfig {
  scenario: SimulationScenario;
  startDate: Date;
  endDate?: Date;
  speed: number; // velocidad de simulación (1 = tiempo real)
  thresholds: {
    warehouse: { green: number; yellow: number; red: number };
    flight: { green: number; yellow: number; red: number };
  };
  algorithmParams: Record<string, any>;
}

export interface SimulationStats {
  totalBaggage: number;
  delivered: number;
  inTransit: number;
  delayed: number;
  notBoarded: number;
  onTimeDeliveryRate: number;
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