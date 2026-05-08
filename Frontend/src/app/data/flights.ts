import { Flight } from '../types';
import { vuelosBackend, aeropuertosBackend } from './envios';

/**
 * Genera las rutas únicas (aristas del grafo) desde los vuelos reales del plan.
 * Cada par origen-destino se convierte en un Flight para la visualización del mapa.
 * 
 * Se usa una capacidad representativa (la del primer vuelo encontrado en esa ruta).
 */
function generateFlightsFromVuelos(): Flight[] {
  const routeMap = new Map<string, Flight>();

  for (const vuelo of vuelosBackend) {
    const origAp = aeropuertosBackend.find(a => a.id === vuelo.idOrigen);
    const destAp = aeropuertosBackend.find(a => a.id === vuelo.idDestino);
    if (!origAp || !destAp) continue;

    const fromId = origAp.iata.toLowerCase();
    const toId = destAp.iata.toLowerCase();
    const key = `${fromId}-${toId}`;

    if (!routeMap.has(key)) {
      const sameCont = origAp.continente === destAp.continente;
      routeMap.set(key, {
        id: `f-${key}`,
        fromAirportId: fromId,
        toAirportId: toId,
        capacity: vuelo.capacidadMaxima,
        currentLoad: vuelo.ocupacionActual ?? 0,
        duration: sameCont ? 1 : 2,
        sameContinentRoute: sameCont,
      });
    }
  }

  return Array.from(routeMap.values());
}

export const flights: Flight[] = generateFlightsFromVuelos();
