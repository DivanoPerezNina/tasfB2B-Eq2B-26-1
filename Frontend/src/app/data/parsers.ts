/**
 * Parsers para archivos .txt del sistema de logística Tasf.B2B
 * 
 * Estos parsers están diseñados para procesar los archivos de entrada:
 * - vuelos.txt: Plan de vuelos estático (rutas establecidas)
 * - envios_XXXX.txt: Registros de envío por aeropuerto de origen
 * - aeropuertos.txt: Datos de aeropuertos (futuro)
 */

import { Vuelo, Envio, Aeropuerto } from '../types';
import { aeropuertosBackend, getAeropuertoByIata } from './aeropuertos';

/**
 * Convierte "HH:MM" a minutos desde medianoche UTC (0-1439)
 */
export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Parsea una línea de vuelos.txt
 * Formato: ORIG-DEST-HH:MM-HH:MM-CCCC
 * Ejemplo: SKBO-SEQM-03:34-04:21-0300
 */
export function parseVueloLine(line: string): Vuelo | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Split by '-' but be careful with time format HH:MM
  // Format: XXXX-XXXX-HH:MM-HH:MM-CCCC
  const parts = trimmed.split('-');
  if (parts.length < 5) return null;

  const origIata = parts[0];
  const destIata = parts[1];
  const salida = `${parts[2]}`; // HH:MM
  const llegada = `${parts[3]}`; // HH:MM  
  const capacidadStr = parts[4];

  const orig = getAeropuertoByIata(origIata);
  const dest = getAeropuertoByIata(destIata);
  if (!orig || !dest) return null;

  const salidaUTC = parseTimeToMinutes(salida);
  const llegadaUTC = parseTimeToMinutes(llegada);
  const capacidadMaxima = parseInt(capacidadStr, 10);

  return {
    idOrigen: orig.id,
    idDestino: dest.id,
    salidaUTC,
    llegadaUTC,
    capacidadMaxima,
  };
}

/**
 * Parsea el contenido completo de vuelos.txt
 */
export function parseVuelosFile(content: string): Vuelo[] {
  const lines = content.split(/\r?\n/);
  const vuelos: Vuelo[] = [];
  for (const line of lines) {
    const vuelo = parseVueloLine(line);
    if (vuelo) vuelos.push(vuelo);
  }
  return vuelos;
}

/**
 * Formato de envío en archivo .txt:
 * id_envío-aaaammdd-hh-mm-dest-###-IdCliente
 * Ejemplo: 000000001-20260102-00-47-SUAA-002-0032535
 * 
 * El archivo se carga por aeropuerto de origen (el nombre del archivo indica el origen).
 */
export interface RawEnvioRecord {
  idPedido: string;
  fecha: { year: number; month: number; day: number };
  hora: number;
  minuto: number;
  destIata: string;
  cantidad: number;
  idCliente: string;
}

/**
 * Parsea una línea de envío
 */
export function parseEnvioLine(line: string): RawEnvioRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('-');
  if (parts.length < 7) return null;

  const idPedido = parts[0];
  const fechaStr = parts[1]; // aaaammdd
  const hora = parseInt(parts[2], 10);
  const minuto = parseInt(parts[3], 10);
  const destIata = parts[4];
  const cantidad = parseInt(parts[5], 10);
  const idCliente = parts[6];

  const year = parseInt(fechaStr.substring(0, 4), 10);
  const month = parseInt(fechaStr.substring(4, 6), 10);
  const day = parseInt(fechaStr.substring(6, 8), 10);

  return {
    idPedido,
    fecha: { year, month, day },
    hora,
    minuto,
    destIata,
    cantidad,
    idCliente,
  };
}

/**
 * Convierte un RawEnvioRecord a un Envio del modelo.
 * originAirportId es el ID del aeropuerto donde se cargó el archivo.
 * 
 * NOTA: En el prototipo, el estado y la ruta asignada son mock.
 * En producción, estos serán calculados por el algoritmo GVNS.
 */
export function rawEnvioToEnvio(
  raw: RawEnvioRecord,
  originAirportId: number,
  _algorithmResult?: { estado: Envio['estado']; rutaAsignada?: number[] }
): Envio {
  const dest = getAeropuertoByIata(raw.destIata);
  const destId = dest?.id ?? 0;

  // Calcular registro UTC en minutos absolutos desde epoch del día
  const registroUTC = raw.hora * 60 + raw.minuto;

  // Calcular deadline: mismo continente = 1 día (1440 min), intercontinental = 2 días (2880 min)
  const origAp = aeropuertosBackend.find(a => a.id === originAirportId);
  const sameCont = origAp && dest ? origAp.continente === dest.continente : false;
  const deadlineUTC = registroUTC + (sameCont ? 1440 : 2880);

  // Default: el algoritmo determinará esto. Para mock, se asigna un estado placeholder.
  const result = _algorithmResult ?? { estado: 'Exitoso' as const, rutaAsignada: [originAirportId, destId] };

  return {
    id: `ENV-${raw.idPedido}`,
    idOrigen: originAirportId,
    idDestino: destId,
    cantidadMaletas: raw.cantidad,
    registroUTC,
    deadlineUTC,
    estado: result.estado,
    rutaAsignada: result.rutaAsignada,
  };
}

/**
 * Parsea un archivo completo de envíos para un aeropuerto de origen dado.
 */
export function parseEnviosFile(content: string, originIata: string): Envio[] {
  const orig = getAeropuertoByIata(originIata);
  if (!orig) return [];

  const lines = content.split(/\r?\n/);
  const envios: Envio[] = [];
  for (const line of lines) {
    const raw = parseEnvioLine(line);
    if (raw) {
      envios.push(rawEnvioToEnvio(raw, orig.id));
    }
  }
  return envios;
}