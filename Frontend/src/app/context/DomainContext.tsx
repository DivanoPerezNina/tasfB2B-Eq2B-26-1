/**
 * DomainContext — carga aeropuertos y vuelos desde el BFF (BD real) al montar la app.
 * Reemplaza los datos mock estáticos de airports.ts / aeropuertos.ts / vuelosRaw.ts.
 * Todos los componentes que necesiten estos datos consumen este contexto.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Airport, Aeropuerto, Vuelo, Flight, Continent } from '../types';
// Fallbacks estáticos mientras carga o si el BFF no está disponible
import { airports as staticAirports }       from '../data/airports';
import { aeropuertosBackend as staticAeros } from '../data/aeropuertos';
import { vuelosBackend as staticVuelos }     from '../data/envios';
import { flights as staticFlights }          from '../data/flights';

const BFF = 'http://localhost:8081';

// ─── Tipos BFF (envelope ya desenvuelto) ──────────────────────────────────────
export interface AeroBFF {
  id:               number;
  iata:             string;
  ciudad:           string;
  pais:             string;
  continente:       number;   // 1=América  2=Europa  3=Asia
  gmt_offset:       number;
  capacidad_almacen: number;
  lat:              number;
  lng:              number;
}

export interface VueloBFF {
  id:              number;
  origen_iata:     string;
  destino_iata:    string;
  salida_minutos:  number;
  llegada_minutos: number;
  capacidad_max:   number;
  mismo_continente: boolean;
}

// ─── Contexto ─────────────────────────────────────────────────────────────────
interface DomainContextType {
  /** Aeropuertos en formato frontend (para Map markers) */
  airports:          Airport[];
  /** Aeropuertos en formato backend numérico (para lookups id↔iata) */
  aeropuertosBackend: Aeropuerto[];
  /** Vuelos en formato backend numérico (para calcular aviones activos) */
  vuelosBackend:     Vuelo[];
  /** Rutas únicas en formato frontend (para líneas en el mapa) */
  flights:           Flight[];
  /** Raw desde BFF — para uso extendido (search, etc.) */
  aeropuertosBFF:    AeroBFF[];
  vuelosBFF:         VueloBFF[];

  isLoading: boolean;
  error:     string | null;
}

const DomainContext = createContext<DomainContextType | undefined>(undefined);

export const useDomain = () => {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomain must be used within DomainProvider');
  return ctx;
};

// ─── Conversores ──────────────────────────────────────────────────────────────

const CONT_MAP: Record<number, Continent> = { 1: 'America', 2: 'Europe', 3: 'Asia' };

function latLngToSVG(lat: number, lng: number) {
  return { x: (lng + 180) * (1000 / 360), y: (90 - lat) * (500 / 180) };
}

/** AeroBFF → Airport (formato frontend para mapa) */
function toAirport(a: AeroBFF): Airport {
  // Toma nombre completo y tier del estático si existe; si no, usa ciudad como nombre
  const st = staticAirports.find(s => s.code === a.iata);
  return {
    id:               a.iata.toLowerCase(),
    code:             a.iata,
    name:             st?.name ?? a.ciudad,
    city:             a.ciudad,
    continent:        CONT_MAP[a.continente] ?? 'America',
    coordinates:      latLngToSVG(a.lat, a.lng),
    lat:              a.lat,
    lng:              a.lng,
    warehouseCapacity: a.capacidad_almacen,
    currentOccupancy: 0,
    tier:             st?.tier ?? (a.capacidad_almacen >= 460 ? 1 : a.capacidad_almacen >= 420 ? 2 : 3),
  };
}

/** AeroBFF → Aeropuerto (formato backend numérico) */
function toAeropuerto(a: AeroBFF): Aeropuerto {
  return {
    id:               a.id,
    iata:             a.iata,
    continente:       a.continente,
    gmt:              a.gmt_offset,
    capacidadAlmacen: a.capacidad_almacen,
  };
}

/** VueloBFF + mapa IATA→id → Vuelo (formato backend numérico) */
function toVuelo(v: VueloBFF, iataToId: Map<string, number>): Vuelo | null {
  const origId = iataToId.get(v.origen_iata);
  const destId = iataToId.get(v.destino_iata);
  if (origId == null || destId == null) return null;
  return {
    idOrigen:      origId,
    idDestino:     destId,
    salidaUTC:     v.salida_minutos,
    llegadaUTC:    v.llegada_minutos,
    capacidadMaxima: v.capacidad_max,
  };
}

/** VueloBFF[] → rutas únicas Flight[] (para líneas del mapa) */
function toFlights(vuelos: VueloBFF[]): Flight[] {
  const routeMap = new Map<string, Flight>();
  for (const v of vuelos) {
    const fromId = v.origen_iata.toLowerCase();
    const toId   = v.destino_iata.toLowerCase();
    const key    = `${fromId}-${toId}`;
    if (!routeMap.has(key)) {
      routeMap.set(key, {
        id:               key,
        fromAirportId:    fromId,
        toAirportId:      toId,
        capacity:         v.capacidad_max,
        currentLoad:      0,
        duration:         v.llegada_minutos >= v.salida_minutos
                            ? v.llegada_minutos - v.salida_minutos
                            : (1440 - v.salida_minutos) + v.llegada_minutos,
        sameContinentRoute: v.mismo_continente,
      });
    }
  }
  return Array.from(routeMap.values());
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const DomainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [aeropuertosBFF, setAeropuertosBFF] = useState<AeroBFF[]>([]);
  const [vuelosBFF,      setVuelosBFF]      = useState<VueloBFF[]>([]);
  const [isLoading,      setIsLoading]      = useState(true);
  const [error,          setError]          = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [resA, resV] = await Promise.all([
          fetch(`${BFF}/api/aeropuertos`),
          fetch(`${BFF}/api/vuelos`),
        ]);

        const jsonA = await resA.json();
        const jsonV = await resV.json();

        if (cancelled) return;

        // Desenvolver generic response: { success, data: [...], message }
        const aeros: AeroBFF[] = jsonA.data ?? jsonA;
        const vuelos: VueloBFF[] = jsonV.data ?? jsonV;

        if (!Array.isArray(aeros) || aeros.length === 0) {
          console.warn('[Domain] Aeropuertos vacíos desde BFF — usando datos estáticos');
        }
        if (!Array.isArray(vuelos) || vuelos.length === 0) {
          console.warn('[Domain] Vuelos vacíos desde BFF — usando datos estáticos');
        }

        setAeropuertosBFF(Array.isArray(aeros) ? aeros : []);
        setVuelosBFF(Array.isArray(vuelos) ? vuelos : []);
        console.log(`[Domain] ✓ ${aeros.length} aeropuertos | ${vuelos.length} vuelos cargados desde BD`);
      } catch (e: any) {
        if (cancelled) return;
        console.warn('[Domain] BFF no disponible, usando datos estáticos:', e.message);
        setError(e.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  // ─── Derivar las 4 listas desde BFF; fallback a estáticos ─────────────────
  const airports = aeropuertosBFF.length > 0
    ? aeropuertosBFF.map(toAirport)
    : staticAirports;

  const aeropuertosBackend = aeropuertosBFF.length > 0
    ? aeropuertosBFF.map(toAeropuerto)
    : staticAeros;

  const vuelosBackend = (() => {
    if (aeropuertosBFF.length === 0 || vuelosBFF.length === 0) return staticVuelos;
    const iataToId = new Map(aeropuertosBFF.map(a => [a.iata, a.id]));
    return vuelosBFF.flatMap(v => {
      const res = toVuelo(v, iataToId);
      return res ? [res] : [];
    });
  })();

  const flights = vuelosBFF.length > 0
    ? toFlights(vuelosBFF)
    : staticFlights;

  return (
    <DomainContext.Provider value={{
      airports,
      aeropuertosBackend,
      vuelosBackend,
      flights,
      aeropuertosBFF,
      vuelosBFF,
      isLoading,
      error,
    }}>
      {children}
    </DomainContext.Provider>
  );
};
