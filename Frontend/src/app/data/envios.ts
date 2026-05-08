import { Envio, Vuelo } from '../types';
import { aeropuertosBackend, getAeropuertoById, getAeropuertoByIata } from './aeropuertos';
import { vuelosParsed } from './vuelosRaw';

// Re-export so existing consumers keep working
export { aeropuertosBackend, getAeropuertoById, getAeropuertoByIata };

// Vuelos parseados del plan de vuelos real (vuelos.txt)
export const vuelosBackend: Vuelo[] = vuelosParsed;

// ─── Mock Envíos ───
// Formato original del archivo:
// id_envío-aaaammdd-hh-mm-dest-###-IdCliente
// Ejemplo: 000000001-20260102-00-47-SUAA-002-0032535
// Cargado en aeropuerto EBCI (origen)
//
// En producción: se parsean archivos .txt por aeropuerto con parseEnviosFile()
// En prototipo: datos hardcodeados que representan envíos realistas

export const envios: Envio[] = [
  // Envíos continentales América (deadline 1440 min = 24h)
  { id: 'ENV-000000001', idOrigen: 1,  idDestino: 2,  cantidadMaletas: 2,  registroUTC: 47,   deadlineUTC: 1487,  estado: 'Exitoso',     rutaAsignada: [1, 2] },
  { id: 'ENV-000000002', idOrigen: 1,  idDestino: 5,  cantidadMaletas: 3,  registroUTC: 98,   deadlineUTC: 1538,  estado: 'Exitoso',     rutaAsignada: [1, 5] },
  { id: 'ENV-000000003', idOrigen: 1,  idDestino: 8,  cantidadMaletas: 1,  registroUTC: 210,  deadlineUTC: 1650,  estado: 'Exitoso',     rutaAsignada: [1, 8] },
  { id: 'ENV-000000004', idOrigen: 4,  idDestino: 7,  cantidadMaletas: 5,  registroUTC: 180,  deadlineUTC: 1620,  estado: 'Exitoso',     rutaAsignada: [4, 1, 7] },
  { id: 'ENV-000000005', idOrigen: 5,  idDestino: 9,  cantidadMaletas: 2,  registroUTC: 330,  deadlineUTC: 1770,  estado: 'SalvadoGVNS', rutaAsignada: [5, 1, 9] },
  { id: 'ENV-000000006', idOrigen: 3,  idDestino: 4,  cantidadMaletas: 4,  registroUTC: 420,  deadlineUTC: 1860,  estado: 'Exitoso',     rutaAsignada: [3, 1, 4] },
  { id: 'ENV-000000007', idOrigen: 2,  idDestino: 10, cantidadMaletas: 1,  registroUTC: 60,   deadlineUTC: 1500,  estado: 'Rechazado' },
  { id: 'ENV-000000008', idOrigen: 8,  idDestino: 6,  cantidadMaletas: 3,  registroUTC: 540,  deadlineUTC: 1980,  estado: 'Exitoso',     rutaAsignada: [8, 7, 5, 6] },

  // Envíos intercontinentales América→Europa (deadline 2880 min = 48h)
  { id: 'ENV-000000009', idOrigen: 1,  idDestino: 12, cantidadMaletas: 3,  registroUTC: 120,  deadlineUTC: 3000,  estado: 'Exitoso',     rutaAsignada: [1, 12] },
  { id: 'ENV-000000010', idOrigen: 1,  idDestino: 14, cantidadMaletas: 2,  registroUTC: 24,   deadlineUTC: 2904,  estado: 'Exitoso',     rutaAsignada: [1, 14] },
  { id: 'ENV-000000011', idOrigen: 4,  idDestino: 20, cantidadMaletas: 5,  registroUTC: 240,  deadlineUTC: 3120,  estado: 'SalvadoGVNS', rutaAsignada: [4, 1, 12, 20] },
  { id: 'ENV-000000012', idOrigen: 1,  idDestino: 17, cantidadMaletas: 4,  registroUTC: 332,  deadlineUTC: 3212,  estado: 'Exitoso',     rutaAsignada: [1, 17] },
  { id: 'ENV-000000013', idOrigen: 5,  idDestino: 13, cantidadMaletas: 2,  registroUTC: 480,  deadlineUTC: 3360,  estado: 'Rechazado' },
  { id: 'ENV-000000014', idOrigen: 8,  idDestino: 14, cantidadMaletas: 2,  registroUTC: 300,  deadlineUTC: 3180,  estado: 'Exitoso',     rutaAsignada: [8, 4, 1, 14] },

  // Envíos intercontinentales Europa→América
  { id: 'ENV-000000015', idOrigen: 12, idDestino: 1,  cantidadMaletas: 3,  registroUTC: 487,  deadlineUTC: 3367,  estado: 'Exitoso',     rutaAsignada: [12, 1] },
  { id: 'ENV-000000016', idOrigen: 14, idDestino: 4,  cantidadMaletas: 1,  registroUTC: 109,  deadlineUTC: 2989,  estado: 'Exitoso',     rutaAsignada: [14, 1, 4] },
  { id: 'ENV-000000017', idOrigen: 20, idDestino: 5,  cantidadMaletas: 6,  registroUTC: 600,  deadlineUTC: 3480,  estado: 'SalvadoGVNS', rutaAsignada: [20, 12, 1, 5] },

  // Envíos Europa→Asia
  { id: 'ENV-000000018', idOrigen: 12, idDestino: 24, cantidadMaletas: 2,  registroUTC: 60,   deadlineUTC: 2940,  estado: 'Exitoso',     rutaAsignada: [12, 24] },
  { id: 'ENV-000000019', idOrigen: 14, idDestino: 21, cantidadMaletas: 4,  registroUTC: 240,  deadlineUTC: 3120,  estado: 'Exitoso',     rutaAsignada: [14, 12, 21] },
  { id: 'ENV-000000020', idOrigen: 19, idDestino: 28, cantidadMaletas: 1,  registroUTC: 390,  deadlineUTC: 3270,  estado: 'Rechazado' },

  // Envíos Asia→América
  { id: 'ENV-000000021', idOrigen: 24, idDestino: 1,  cantidadMaletas: 3,  registroUTC: 420,  deadlineUTC: 3300,  estado: 'Exitoso',     rutaAsignada: [24, 12, 1] },
  { id: 'ENV-000000022', idOrigen: 21, idDestino: 4,  cantidadMaletas: 2,  registroUTC: 120,  deadlineUTC: 3000,  estado: 'Exitoso',     rutaAsignada: [21, 12, 1, 4] },

  // Envíos continentales Europa
  { id: 'ENV-000000023', idOrigen: 12, idDestino: 20, cantidadMaletas: 4,  registroUTC: 540,  deadlineUTC: 1980,  estado: 'Exitoso',     rutaAsignada: [12, 20] },
  { id: 'ENV-000000024', idOrigen: 14, idDestino: 19, cantidadMaletas: 1,  registroUTC: 180,  deadlineUTC: 1620,  estado: 'Exitoso',     rutaAsignada: [14, 19] },
  { id: 'ENV-000000025', idOrigen: 11, idDestino: 13, cantidadMaletas: 2,  registroUTC: 44,   deadlineUTC: 1484,  estado: 'Exitoso',     rutaAsignada: [11, 13] },
  { id: 'ENV-000000026', idOrigen: 17, idDestino: 12, cantidadMaletas: 3,  registroUTC: 290,  deadlineUTC: 1730,  estado: 'SalvadoGVNS', rutaAsignada: [17, 12] },

  // Envíos continentales Asia
  { id: 'ENV-000000027', idOrigen: 24, idDestino: 23, cantidadMaletas: 2,  registroUTC: 180,  deadlineUTC: 1620,  estado: 'Exitoso',     rutaAsignada: [24, 23] },
  { id: 'ENV-000000028', idOrigen: 21, idDestino: 28, cantidadMaletas: 6,  registroUTC: 60,   deadlineUTC: 1500,  estado: 'SalvadoGVNS', rutaAsignada: [21, 28] },
  { id: 'ENV-000000029', idOrigen: 22, idDestino: 30, cantidadMaletas: 1,  registroUTC: 240,  deadlineUTC: 1680,  estado: 'Exitoso',     rutaAsignada: [22, 30] },
  { id: 'ENV-000000030', idOrigen: 25, idDestino: 29, cantidadMaletas: 3,  registroUTC: 360,  deadlineUTC: 1800,  estado: 'Exitoso',     rutaAsignada: [25, 21, 29] },

  // Más envíos realistas para llenar métricas
  { id: 'ENV-000000031', idOrigen: 7,  idDestino: 21, cantidadMaletas: 4,  registroUTC: 180,  deadlineUTC: 3060,  estado: 'Rechazado' },
  { id: 'ENV-000000032', idOrigen: 9,  idDestino: 11, cantidadMaletas: 2,  registroUTC: 510,  deadlineUTC: 3390,  estado: 'Exitoso',     rutaAsignada: [9, 1, 11] },
  { id: 'ENV-000000033', idOrigen: 6,  idDestino: 15, cantidadMaletas: 3,  registroUTC: 90,   deadlineUTC: 2970,  estado: 'Exitoso',     rutaAsignada: [6, 5, 1, 15] },
  { id: 'ENV-000000034', idOrigen: 10, idDestino: 26, cantidadMaletas: 1,  registroUTC: 300,  deadlineUTC: 3180,  estado: 'SalvadoGVNS', rutaAsignada: [10, 8, 1, 24, 26] },
  { id: 'ENV-000000035', idOrigen: 23, idDestino: 12, cantidadMaletas: 3,  registroUTC: 480,  deadlineUTC: 3360,  estado: 'Exitoso',     rutaAsignada: [23, 24, 12] },
  { id: 'ENV-000000036', idOrigen: 26, idDestino: 14, cantidadMaletas: 2,  registroUTC: 150,  deadlineUTC: 3030,  estado: 'Exitoso',     rutaAsignada: [26, 24, 12, 14] },
  { id: 'ENV-000000037', idOrigen: 15, idDestino: 22, cantidadMaletas: 5,  registroUTC: 420,  deadlineUTC: 3300,  estado: 'Exitoso',     rutaAsignada: [15, 12, 24, 22] },
  { id: 'ENV-000000038', idOrigen: 18, idDestino: 27, cantidadMaletas: 1,  registroUTC: 270,  deadlineUTC: 3150,  estado: 'Rechazado' },
  { id: 'ENV-000000039', idOrigen: 16, idDestino: 3,  cantidadMaletas: 4,  registroUTC: 600,  deadlineUTC: 3480,  estado: 'Exitoso',     rutaAsignada: [16, 13, 12, 1, 3] },
  { id: 'ENV-000000040', idOrigen: 30, idDestino: 8,  cantidadMaletas: 2,  registroUTC: 330,  deadlineUTC: 3210,  estado: 'SalvadoGVNS', rutaAsignada: [30, 22, 24, 12, 1, 8] },
];

// ─── Helpers ───

export function getVuelosByAeropuerto(id: number): Vuelo[] {
  return vuelosBackend.filter(v => v.idOrigen === id || v.idDestino === id);
}

export function getEnviosByAeropuerto(id: number): Envio[] {
  return envios.filter(e => e.idOrigen === id || e.idDestino === id || (e.rutaAsignada && e.rutaAsignada.includes(id)));
}

export function formatMinutesUTC(minutes: number): string {
  const h = Math.floor(minutes % 1440 / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} UTC`;
}

export function getContinentLabel(c: number): string {
  if (c === 1) return 'América';
  if (c === 2) return 'Europa';
  return 'Asia';
}

/**
 * Encuentra vuelos entre dos aeropuertos (para trazar rutas de envío)
 */
export function findFlightBetween(fromId: number, toId: number): Vuelo | undefined {
  return vuelosBackend.find(v => v.idOrigen === fromId && v.idDestino === toId);
}

/**
 * Calcula la duración de un vuelo en minutos, manejando vuelos que cruzan medianoche
 */
export function getFlightDuration(vuelo: Vuelo): number {
  if (vuelo.llegadaUTC >= vuelo.salidaUTC) {
    return vuelo.llegadaUTC - vuelo.salidaUTC;
  }
  // Cruza medianoche
  return (1440 - vuelo.salidaUTC) + vuelo.llegadaUTC;
}
