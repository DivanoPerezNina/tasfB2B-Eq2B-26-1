import React, { useState, useMemo, useCallback, memo } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
  ZoomableGroup,
} from 'react-simple-maps';
import { useSimulation } from '../context/SimulationContext';
import { useDomain } from '../context/DomainContext';
import { Airport, Continent, Vuelo, PlanTramoVisual, Aeropuerto, VisualCancellation } from '../types';
import { ZoomIn, ZoomOut, Filter, Maximize2, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const COUNTRY_LABELS = [
  { name: 'Estados Unidos', lat: 39, lng: -98 },
  { name: 'Colombia', lat: 4, lng: -74 },
  { name: 'Perú', lat: -9, lng: -75 },
  { name: 'Brasil', lat: -10, lng: -53 },
  { name: 'España', lat: 40, lng: -4 },
  { name: 'Francia', lat: 46, lng: 2 },
  { name: 'Alemania', lat: 51, lng: 10 },
  { name: 'China', lat: 35, lng: 103 },
  { name: 'Japón', lat: 37, lng: 138 },
];

function declutterAirports(list: Airport[], zoom: number): Airport[] {
  const minDist = 8 / zoom;
  const visible: Airport[] = [];
  const sorted = [...list].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.warehouseCapacity - a.warehouseCapacity;
  });
  for (const airport of sorted) {
    const tooClose = visible.some(v => {
      const dLat = v.lat - airport.lat;
      const dLng = v.lng - airport.lng;
      return Math.sqrt(dLat * dLat + dLng * dLng) < minDist;
    });
    if (!tooClose) visible.push(airport);
  }
  return visible;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const MAX_VISIBLE_ACTIVE_FLIGHTS = 180;

// Tasa máxima plausible de avance del reloj simulado (min sim por ms real). El
// periodo comprimido más agresivo (~7 días en 30 min) avanza ~0.006 min/ms; el
// warm-up turbo avanza miles. Este umbral separa ambos para no contaminar la
// extrapolación con los saltos instantáneos del warm-up.
const MAX_PLAUSIBLE_RATE = 1;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function normalizeLngDelta(delta: number): number {
  // Escoge la ruta visual más corta cuando un vuelo cruza el meridiano 180°.
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

function normalizeLng(lng: number): number {
  if (lng > 180) return lng - 360;
  if (lng < -180) return lng + 360;
  return lng;
}

function lerpLng(start: number, end: number, progress: number): number {
  return normalizeLng(start + normalizeLngDelta(end - start) * progress);
}

function mercatorY(lat: number): number {
  const maxLat = 85.05112878;
  const safeLat = clamp(lat, -maxLat, maxLat);
  const rad = (safeLat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function getPlaneRotationToDestination(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const dx = normalizeLngDelta(toLng - fromLng) * (Math.PI / 180);
  const dy = -(mercatorY(toLat) - mercatorY(fromLat));

  if (Math.abs(dx) < 0.000001 && Math.abs(dy) < 0.000001) {
    return 0;
  }

  return Math.atan2(dy, dx) * (180 / Math.PI);
}

// ─── Active flights calculation from the real plan ───
interface ActiveFlight {
  vuelo: Vuelo;
  envioIndice: number;
  tramoIndex: number;
  progress: number; // 0..1
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  trailLat: number;
  trailLng: number;
  lat: number;
  lng: number;
  angle: number;
  isSameCont: boolean;
}

interface ActiveFlightResult {
  flights: ActiveFlight[];
  totalActive: number;
}

type FlightOccupancyFilter = 'all' | 'vacio' | 'verde' | 'ambar' | 'rojo';

function getFlightOccupancyStatus(
  load: number,
  capacity: number,
  thresholds: { green: number; yellow: number; red: number },
): Exclude<FlightOccupancyFilter, 'all'> {
  if (load <= 0) return 'vacio';
  if (capacity <= 0) return 'verde';
  const percentage = (load / capacity) * 100;
  if (percentage <= thresholds.green) return 'verde';
  if (percentage <= thresholds.yellow) return 'ambar';
  return 'rojo';
}

function getFlightOccupancyColor(
  status: Exclude<FlightOccupancyFilter, 'all'>,
  isDarkTheme: boolean,
): string {
  if (isDarkTheme) {
    if (status === 'vacio') return '#94a3b8';
    if (status === 'verde') return '#22c55e';
    if (status === 'ambar') return '#f59e0b';
    return '#ef4444';
  }

  // En modo claro se usan tonos más profundos para que las rutas conserven
  // contraste sobre el océano y los países claros.
  if (status === 'vacio') return '#475569';
  if (status === 'verde') return '#166534';
  if (status === 'ambar') return '#a16207';
  return '#881337';
}

function getWarehouseOccupancyColor(status: 'vacio' | 'verde' | 'ambar' | 'rojo', isDarkTheme: boolean): string {
  if (isDarkTheme) {
    if (status === 'vacio') return '#94a3b8';
    if (status === 'verde') return '#22c55e';
    if (status === 'ambar') return '#f59e0b';
    return '#ef4444';
  }
  if (status === 'vacio') return '#64748b';
  if (status === 'verde') return '#15803d';
  if (status === 'ambar') return '#b45309';
  return '#991b1b';
}

function airportContinentFromBackend(a?: Aeropuerto): Continent | undefined {
  if (!a) return undefined;
  if (a.continente === 1) return 'America';
  if (a.continente === 2) return 'Europe';
  if (a.continente === 3) return 'Asia';
  return undefined;
}

// Normaliza duración de vuelo en minutos del día, manejando cruces de medianoche
function duracionMinutosDia(salidaMin: number, llegadaMin: number): number {
  const diff = llegadaMin - salidaMin;
  return diff >= 0 ? diff : diff + 1440;
}

function getActiveFlightsFromPlan(
  simMinuteUTC: number,
  planTramos: PlanTramoVisual[],
  airports: Airport[],
  aeropuertosBackend: Aeropuerto[],
  vuelosBackend: Vuelo[],
  filter: Continent | 'all',
): ActiveFlightResult {
  type ActiveOccurrence = {
    key: string;
    desde: string;
    hasta: string;
    salidaUTC: number;
    llegadaUTC: number;
    maletas: number;
    envioIndice: number;
    tramoIndex: number;
  };

  const currentMinute = simMinuteUTC;
  const occurrences = new globalThis.Map<string, ActiveOccurrence>();

  // Importante: el mapa solo debe dibujar vuelos que realmente estén siendo
  // utilizados por el plan vigente. No se crean aviones a partir del catálogo
  // completo de vuelos, porque eso hacía aparecer cientos de vuelos vacíos al
  // inicio de la simulación.
  for (const tramo of planTramos) {
    if (currentMinute < tramo.salidaUTC || currentMinute >= tramo.llegadaUTC) continue;

    const key = `${tramo.desde}|${tramo.hasta}|${Math.round(tramo.salidaUTC)}|${Math.round(tramo.llegadaUTC)}`;
    const existing = occurrences.get(key);
    if (existing) {
      existing.maletas += Math.max(0, tramo.maletas ?? 0);
      continue;
    }

    occurrences.set(key, {
      key,
      desde: tramo.desde,
      hasta: tramo.hasta,
      salidaUTC: tramo.salidaUTC,
      llegadaUTC: tramo.llegadaUTC,
      maletas: Math.max(0, tramo.maletas ?? 0),
      envioIndice: tramo.envioIndice,
      tramoIndex: tramo.tramoIndex,
    });
  }

  const flights: ActiveFlight[] = [];
  let totalActive = 0;

  for (const occurrence of occurrences.values()) {
    const origFront = airports.find((airport) => airport.code === occurrence.desde);
    const destFront = airports.find((airport) => airport.code === occurrence.hasta);
    if (!origFront || !destFront) continue;

    const origBack = aeropuertosBackend.find((airport) => airport.iata === occurrence.desde);
    const destBack = aeropuertosBackend.find((airport) => airport.iata === occurrence.hasta);
    const origCont = airportContinentFromBackend(origBack) ?? origFront.continent;
    const destCont = airportContinentFromBackend(destBack) ?? destFront.continent;
    if (filter !== 'all' && origCont !== filter && destCont !== filter) continue;

    totalActive += 1;
    if (flights.length >= MAX_VISIBLE_ACTIVE_FLIGHTS) continue;

    const duration = Math.max(1, occurrence.llegadaUTC - occurrence.salidaUTC);
    const progress = clamp((currentMinute - occurrence.salidaUTC) / duration);
    const lat = lerp(origFront.lat, destFront.lat, progress);
    const lng = lerpLng(origFront.lng, destFront.lng, progress);
    const angle = getPlaneRotationToDestination(lat, lng, destFront.lat, destFront.lng);

    const salidaDia = ((occurrence.salidaUTC % 1440) + 1440) % 1440;
    const llegadaDia = ((occurrence.llegadaUTC % 1440) + 1440) % 1440;
    const duracion = duracionMinutosDia(salidaDia, llegadaDia);
    const vueloReal = vuelosBackend.find((flight) =>
      flight.idOrigen === origBack?.id
      && flight.idDestino === destBack?.id
      && Math.abs(flight.salidaUTC - salidaDia) < 2
      && Math.abs(duracionMinutosDia(flight.salidaUTC, flight.llegadaUTC) - duracion) < 5,
    ) ?? vuelosBackend.find((flight) =>
      flight.idOrigen === origBack?.id
      && flight.idDestino === destBack?.id
      && flight.capacidadMaxima > 0,
    );

    flights.push({
      vuelo: {
        idOrigen: origBack?.id ?? 0,
        idDestino: destBack?.id ?? 0,
        salidaUTC: occurrence.salidaUTC,
        llegadaUTC: occurrence.llegadaUTC,
        capacidadMaxima: vueloReal?.capacidadMaxima ?? 0,
        ocupacionActual: occurrence.maletas,
      },
      envioIndice: occurrence.envioIndice,
      tramoIndex: occurrence.tramoIndex,
      progress,
      fromLat: origFront.lat,
      fromLng: origFront.lng,
      toLat: destFront.lat,
      toLng: destFront.lng,
      trailLat: origFront.lat,
      trailLng: origFront.lng,
      lat,
      lng,
      angle,
      isSameCont: origCont === destCont,
    });
  }

  return { flights, totalActive };
}

interface MapProps {
  selectedAirportId?: string;
  onAirportSelect?: (airportId: string) => void;
  onFlightSelect?: (vuelo: Vuelo) => void;
  onClearSelection?: () => void;
  selectedFlightKey?: string; // `${idOrigen}-${idDestino}-${salidaUTC}`
  selectedFlight?: Vuelo | null;
  canceledFlights?: VisualCancellation[];
  warehouseCodeFilter?: string;
  warehouseStatusFilter?: 'all' | 'verde' | 'ambar' | 'rojo' | 'vacio';
  highlightedShipmentRoute?: PlanTramoVisual[];
}

export const Map = memo(function Map({
  selectedAirportId,
  onAirportSelect,
  onFlightSelect,
  onClearSelection,
  selectedFlightKey,
  selectedFlight,
  canceledFlights = [],
  warehouseCodeFilter = '',
  warehouseStatusFilter = 'all',
  highlightedShipmentRoute = [],
}: MapProps) {
  const {
    isRunning,
    aeropuertosState,
    tiempoSimUTC,
    contadores,
    planTramos,
    planVisualCargado,
    config,
    visualCancellations,
  } = useSimulation();
  const { airports, aeropuertosBackend, vuelosBackend, aeropuertosBFF } = useDomain();

  // Solo hay aviones reales cuando la simulación ha avanzado al menos un tick
  const simHasStarted = tiempoSimUTC > 0;
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([20, 10]);
  const [filter, setFilter] = useState<Continent | 'all'>('all');
  const [flightOccupancyFilter, setFlightOccupancyFilter] = useState<FlightOccupancyFilter>('all');
  const [hoveredAirport, setHoveredAirport] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);   // leyenda del mapa minimizable
  const [zoomInfoOpen, setZoomInfoOpen] = useState(true); // tarjeta superior derecha minimizable
  const [tipsOpen, setTipsOpen] = useState(true);        // indicaciones de arrastre minimizables
  const [showPlanes, setShowPlanes] = useState(true);
  const [, setThemeVersion] = useState(0);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion(version => version + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-carbon-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const isDarkTheme = document.documentElement.classList.contains('dark')
    || document.documentElement.getAttribute('data-carbon-theme') === 'g100';

  React.useEffect(() => {
    if (!selectedAirportId) return;
    const airport = airports.find(a => a.id === selectedAirportId);
    if (!airport) return;
    setCenter([airport.lng, airport.lat]);
    setZoom(z => Math.max(z, 3.4));
  }, [selectedAirportId, airports]);


  React.useEffect(() => {
    if (highlightedShipmentRoute.length === 0) return;
    const routeAirports = highlightedShipmentRoute.flatMap((leg) => [
      airports.find((airport) => airport.code === leg.desde),
      airports.find((airport) => airport.code === leg.hasta),
    ]).filter(Boolean) as Airport[];
    if (routeAirports.length === 0) return;
    const lngs = routeAirports.map((airport) => airport.lng);
    const lats = routeAirports.map((airport) => airport.lat);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    setCenter([(minLng + maxLng) / 2, (minLat + maxLat) / 2]);
    const span = Math.max(maxLng - minLng, maxLat - minLat);
    setZoom(span > 100 ? 1.25 : span > 55 ? 1.7 : span > 25 ? 2.3 : 3.4);
  }, [highlightedShipmentRoute, airports]);

  // ── Animación suave: extrapolación 30fps entre ticks SSE ──────────────────
  // Guardamos el último tick conocido y la tasa de avance inferida,
  // luego interpolamos cada 33ms para evitar saltos bruscos (clave a 5-10 h/s,
  // donde un vuelo cruza en <1 s y a 10fps se vería escalonado).
  const lastTickRef = React.useRef({ utcMin: 0, wallMs: 0, advancePerMs: 0 });
  const [smoothMinute, setSmoothMinute] = React.useState(0);

  // Actualizar la referencia cada vez que llega un nuevo tick del servidor
  React.useEffect(() => {
    if (!simHasStarted) return;
    const now = performance.now();
    const newUtcMin = tiempoSimUTC;
    const prev = lastTickRef.current;
    if (prev.wallMs > 0 && newUtcMin > prev.utcMin) {
      const elapsedMs = now - prev.wallMs;
      const rate = elapsedMs > 0 ? (newUtcMin - prev.utcMin) / elapsedMs : 0;
      // Ignorar los SALTOS del warm-up (avanzan decenas de minutos simulados en
      // pocos ms reales → tasa enorme). Si dejáramos esa tasa, el bucle de
      // extrapolación dispararía smoothMinute miles de minutos al futuro, más
      // allá de la ventana, y el mapa quedaría sin aviones. Solo aceptamos tasas
      // plausibles de tiempo real / periodo comprimido (< 1 min sim por ms real).
      if (rate > 0 && rate < MAX_PLAUSIBLE_RATE) {
        lastTickRef.current.advancePerMs = rate;
      }
    }
    lastTickRef.current.utcMin  = newUtcMin;
    lastTickRef.current.wallMs  = now;
    setSmoothMinute(newUtcMin);
  }, [tiempoSimUTC, simHasStarted]);

  // Loop a 30fps: extrapola posición entre ticks
  React.useEffect(() => {
    if (!isRunning || !showPlanes || !simHasStarted) return;
    // Al (re)arrancar el bucle —incluido tras una PAUSA o al terminar el
    // warm-up— re-anclamos el reloj de pared al instante actual. Sin esto,
    // (now - wallMs) arrastraría todo el tiempo de pared transcurrido mientras
    // estuvo pausado y los aviones saltarían hacia adelante para luego volver a
    // su sitio con el siguiente tick del servidor.
    lastTickRef.current.wallMs = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const ref = lastTickRef.current;
      if (ref.advancePerMs <= 0) return;
      const extrapolated = ref.utcMin + (now - ref.wallMs) * ref.advancePerMs;
      setSmoothMinute(extrapolated);
    }, 33);
    return () => clearInterval(id);
  }, [isRunning, showPlanes, simHasStarted]);

  const mc = {
    bg: cssVar('--map-bg'),
    land: cssVar('--map-land'),
    landHover: cssVar('--map-land-hover'),
    border: cssVar('--map-border'),
    route: cssVar('--map-route'),
    label: cssVar('--map-label'),
    labelStroke: cssVar('--map-label-stroke'),
    airport: cssVar('--airport-marker') || '#2563eb',
    compactAirport: cssVar('--airport-marker-compact') || '#ec4899',
    cancelledRoute: cssVar('--cancelled-route') || '#ffffff',
  };

  const getAirportStatus = useCallback((airport: Airport): 'verde' | 'ambar' | 'rojo' | 'vacio' => {
    const live = aeropuertosState.find(a => a.iata === airport.code);
    const occupied = live?.maletas_almacen ?? airport.currentOccupancy;
    const capacity = live?.capacidad_almacen ?? airport.warehouseCapacity;
    if (occupied <= 0) return 'vacio';
    const percentage = capacity > 0 ? (occupied / capacity) * 100 : 0;
    if (percentage > config.thresholds.warehouse.yellow) return 'rojo';
    if (percentage > config.thresholds.warehouse.green) return 'ambar';
    return 'verde';
  }, [aeropuertosState, config.thresholds.warehouse]);

  const filteredByContinent = useMemo(() =>
    airports.filter(a => {
      const byContinent = filter === 'all' || a.continent === filter;
      const q = warehouseCodeFilter.trim().toUpperCase();
      const byCode = !q || a.code.includes(q) || a.city.toUpperCase().includes(q);
      const byStatus = warehouseStatusFilter === 'all' || getAirportStatus(a) === warehouseStatusFilter;
      return byContinent && byCode && byStatus;
    }),
    [airports, filter, warehouseCodeFilter, warehouseStatusFilter, getAirportStatus]
  );

  const visibleAirports = useMemo(() => {
    const decluttered = declutterAirports(filteredByContinent, zoom);
    if (selectedAirportId && !decluttered.find(a => a.id === selectedAirportId)) {
      const sel = filteredByContinent.find(a => a.id === selectedAirportId);
      if (sel) decluttered.push(sel);
    }
    return decluttered;
  }, [filteredByContinent, zoom, selectedAirportId]);

  // Los aeropuertos omitidos por el decluttering siguen presentes como
  // marcadores compactos. Así ninguna ruta termina visualmente en un punto
  // vacío cuando el mapa está alejado. Al acercar el zoom, pasan
  // automáticamente al marcador azul normal.
  const compactAirports = useMemo(() => {
    const regularIds = new Set(visibleAirports.map((airport) => airport.id));
    return filteredByContinent.filter((airport) => !regularIds.has(airport.id));
  }, [filteredByContinent, visibleAirports]);

  const activeFlightResult = useMemo(() => {
    if (!showPlanes || !simHasStarted || !planVisualCargado || planTramos.length === 0) {
      return { flights: [], totalActive: 0 };
    }
    return getActiveFlightsFromPlan(smoothMinute, planTramos, airports, aeropuertosBackend, vuelosBackend, filter);
  }, [smoothMinute, showPlanes, simHasStarted, planVisualCargado, planTramos, airports, aeropuertosBackend, vuelosBackend, filter]);

  const allActiveFlights = activeFlightResult.flights;
  const activeFlights = useMemo(() => allActiveFlights.filter((flight) => {
    if (flightOccupancyFilter === 'all') return true;
    return getFlightOccupancyStatus(
      flight.vuelo.ocupacionActual ?? 0,
      flight.vuelo.capacidadMaxima,
      config.thresholds.flight,
    ) === flightOccupancyFilter;
  }), [allActiveFlights, config.thresholds.flight, flightOccupancyFilter]);
  const activeFlightTotal = activeFlightResult.totalActive;

  React.useEffect(() => {
    if (!selectedFlight) return;
    const active = allActiveFlights.find((flight) =>
      flight.vuelo.idOrigen === selectedFlight.idOrigen
      && flight.vuelo.idDestino === selectedFlight.idDestino
      && Math.abs(flight.vuelo.salidaUTC - selectedFlight.salidaUTC) <= 2,
    );
    if (active) {
      setCenter([active.lng, active.lat]);
      setZoom((current) => Math.max(current, 4.8));
      return;
    }
    const originBack = aeropuertosBackend.find((airport) => airport.id === selectedFlight.idOrigen);
    const destinationBack = aeropuertosBackend.find((airport) => airport.id === selectedFlight.idDestino);
    const origin = airports.find((airport) => airport.code === originBack?.iata);
    const destination = airports.find((airport) => airport.code === destinationBack?.iata);
    if (!origin || !destination) return;
    setCenter([(origin.lng + destination.lng) / 2, (origin.lat + destination.lat) / 2]);
    const span = Math.max(Math.abs(origin.lng - destination.lng), Math.abs(origin.lat - destination.lat));
    setZoom(span > 100 ? 1.4 : span > 50 ? 1.9 : span > 20 ? 2.8 : 4.5);
  }, [selectedFlight, selectedFlightKey, allActiveFlights, aeropuertosBackend, airports]);

  const allVisualCancellations = useMemo(() => {
    const unique = new globalThis.Map<string, VisualCancellation>();
    [...visualCancellations, ...canceledFlights].forEach((item) => {
      unique.set(item.id, item);
    });
    return Array.from(unique.values());
  }, [canceledFlights, visualCancellations]);

  const activeCancellations = useMemo(() => {
    if (!simHasStarted) return [];
    return allVisualCancellations
      .filter(c => smoothMinute >= c.salidaUTC && smoothMinute <= c.llegadaUTC)
      .map(c => {
        const from = airports.find(a => a.code === c.origen);
        const to = airports.find(a => a.code === c.destino);
        return from && to ? { ...c, from, to } : null;
      })
      .filter(Boolean) as Array<VisualCancellation & { from: Airport; to: Airport }>;
  }, [allVisualCancellations, smoothMinute, simHasStarted, airports]);

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(z * 1.5, 8)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(z / 1.5, 1)), []);
  const resetView = useCallback(() => { setZoom(1); setCenter([20, 10]); }, []);
  const handleMoveEnd = useCallback((position: { coordinates: [number, number]; zoom: number }) => {
    setCenter(position.coordinates);
    setZoom(position.zoom);
  }, []);

  const markerScale = 1 / Math.sqrt(zoom);
  const showCodes = zoom >= 1.8;
  const showCityNames = zoom >= 3.5;
  const totalInFilter = filteredByContinent.length;
  const visibleCount = visibleAirports.length;
  const compactCount = compactAirports.length;

  const getLiveOccupancy = useCallback((airportCode: string, fallback: { occ: number; cap: number }) => {
    const live = aeropuertosState.find(a => a.iata === airportCode);
    if (live) {
      const pct = live.capacidad_almacen > 0 ? (live.maletas_almacen / live.capacidad_almacen) * 100 : 0;
      return { occ: live.maletas_almacen, cap: live.capacidad_almacen, pct };
    }
    const pct = fallback.cap > 0 ? (fallback.occ / fallback.cap) * 100 : 0;
    return { occ: fallback.occ, cap: fallback.cap, pct };
  }, [aeropuertosState]);

  // C21: el propio ícono del aeropuerto refleja el semáforo de ocupación
  // del almacén, tanto en marcador principal como en marcador compacto.
  const getAirportColor = useCallback((airport: Airport): string => {
    const { occ, pct } = getLiveOccupancy(airport.code, {
      occ: airport.currentOccupancy,
      cap: airport.warehouseCapacity,
    });
    const status = occ <= 0
      ? 'vacio'
      : pct <= config.thresholds.warehouse.green
        ? 'verde'
        : pct <= config.thresholds.warehouse.yellow
          ? 'ambar'
          : 'rojo';
    return getWarehouseOccupancyColor(status, isDarkTheme);
  }, [config.thresholds.warehouse, getLiveOccupancy, isDarkTheme]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-panel-border" style={{ backgroundColor: mc.bg }}>
      {/* Controls */}
      <div className="absolute left-4 top-4 z-10 flex gap-2">
        <div className="flex gap-1 rounded-lg backdrop-blur p-1 shadow-md" style={{ backgroundColor: 'var(--map-overlay-bg)' }}>
          <Button size="sm" variant="ghost" onClick={handleZoomIn} title="Acercar">
            <ZoomIn className="h-4 w-4" style={{ color: 'var(--map-overlay-text)' }} />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleZoomOut} title="Alejar">
            <ZoomOut className="h-4 w-4" style={{ color: 'var(--map-overlay-text)' }} />
          </Button>
          <div className="h-8 w-px" style={{ backgroundColor: 'var(--panel-border)' }} />
          <Button size="sm" variant="ghost" onClick={resetView} title="Restablecer vista">
            <Maximize2 className="h-4 w-4" style={{ color: 'var(--map-overlay-text)' }} />
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-lg backdrop-blur px-3 shadow-md" style={{ backgroundColor: 'var(--map-overlay-bg)' }}>
          <Filter className="h-4 w-4" style={{ color: 'var(--map-overlay-text-muted)' }} />
          <Select value={filter} onValueChange={(v) => setFilter(v as Continent | 'all')}>
            <SelectTrigger className="w-32 border-none shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="America">América</SelectItem>
              <SelectItem value="Europe">Europa</SelectItem>
              <SelectItem value="Asia">Asia</SelectItem>
            </SelectContent>
          </Select>
          <div className="h-8 w-px" style={{ backgroundColor: 'var(--panel-border)' }} />
          <Select value={flightOccupancyFilter} onValueChange={(value) => setFlightOccupancyFilter(value as FlightOccupancyFilter)}>
            <SelectTrigger className="w-36 border-none shadow-none" title="Filtrar aviones por ocupación">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Carga: todos</SelectItem>
              <SelectItem value="vacio">Carga: vacío</SelectItem>
              <SelectItem value="verde">Carga: verde</SelectItem>
              <SelectItem value="ambar">Carga: ámbar</SelectItem>
              <SelectItem value="rojo">Carga: rojo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Planes toggle — solo visible cuando hay simulación activa */}
        {simHasStarted && (
          <button
            onClick={() => setShowPlanes(!showPlanes)}
            className="flex items-center gap-1.5 rounded-lg backdrop-blur px-3 py-1.5 shadow-md transition-colors"
            style={{
              backgroundColor: 'var(--map-overlay-bg)',
              color: showPlanes ? (isDarkTheme ? '#fbbf24' : '#f97316') : 'var(--map-overlay-text-muted)',
            }}
            title={showPlanes ? 'Ocultar aviones' : 'Mostrar aviones'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
            <span className="text-xs hidden sm:inline">{flightOccupancyFilter === 'all' ? (activeFlightTotal || contadores.en_vuelo) : `${activeFlights.length}/${activeFlightTotal}`}</span>
          </button>
        )}
      </div>

      {/* Zoom info */}
      <div
        className="absolute right-4 top-4 z-10 rounded-lg backdrop-blur shadow-md border"
        style={{
          backgroundColor: 'var(--map-overlay-bg)',
          borderColor: 'var(--panel-border)',
          minWidth: zoomInfoOpen ? 138 : 112,
          maxWidth: zoomInfoOpen ? 220 : 112,
          padding: zoomInfoOpen ? '.7rem .85rem' : '.45rem .65rem',
        }}
      >
        <button
          onClick={() => setZoomInfoOpen(o => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            gap: '.5rem',
            marginBottom: zoomInfoOpen ? '.35rem' : 0,
          }}
          title={zoomInfoOpen ? 'Ocultar información de zoom' : 'Mostrar información de zoom'}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--map-overlay-text)' }}>
            Zoom
          </span>
          {zoomInfoOpen
            ? <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--map-overlay-text-muted)' }} />
            : <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--map-overlay-text-muted)' }} />}
        </button>

        {zoomInfoOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', lineHeight: 1.25 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.75rem' }}>
              <span className="text-[11px]" style={{ color: 'var(--map-overlay-text-muted)' }}>Nivel</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--map-overlay-text)' }}>{zoom.toFixed(1)}x</span>
            </div>

            <p className="text-[11px]" style={{ color: 'var(--panel-text-faint)', margin: 0 }}>
              {totalInFilter}/{totalInFilter} aeropuertos
            </p>
            {compactCount > 0 && (
              <p className="text-[10px]" style={{ color: 'var(--panel-text-faint)', margin: 0 }}>
                {visibleCount} principales · {compactCount} compactos
              </p>
            )}

            {showPlanes && simHasStarted && (activeFlightTotal > 0 || contadores.en_vuelo > 0) && (
              <p className="text-[11px]" style={{ color: '#fbbf24', margin: 0 }}>
                {activeFlightTotal || contadores.en_vuelo} {config.scenario === 'collapse' ? 'envíos en tránsito' : 'vuelos activos'}
                {activeFlightTotal > activeFlights.length ? ` · ${activeFlights.length} visibles` : ''}
              </p>
            )}

            {!simHasStarted && (
              <p className="text-[11px]" style={{ color: 'var(--panel-text-faint)', margin: 0 }}>
                Sin simulación activa
              </p>
            )}

            {!simHasStarted && (
              <p className="text-[10px] text-panel-text-faint" style={{ margin: 0, maxWidth: 190 }}>
                Aviones y ocupación en vivo estarán disponibles al iniciar.
              </p>
            )}

            {config.scenario === 'collapse' && simHasStarted && (
              <p className="text-[10px] text-panel-text-faint" style={{ margin: 0, maxWidth: 190 }}>
                Visualización acelerada por bloque.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hoveredAirport && (() => {
        const ap = airports.find(a => a.id === hoveredAirport);
        if (!ap) return null;
        const airportDetails = aeropuertosBFF.find(item => item.iata === ap.code);
        const country = airportDetails?.pais ?? 'País no disponible';
        const { occ, cap, pct } = getLiveOccupancy(ap.code, { occ: ap.currentOccupancy, cap: ap.warehouseCapacity });
        const semColor = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';
        return (
          <div className="absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-lg backdrop-blur px-4 py-3 shadow-xl pointer-events-none border" style={{ backgroundColor: 'var(--map-overlay-bg)', borderColor: 'var(--panel-border)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--map-overlay-text)' }}>{ap.code} — {ap.city}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--map-overlay-text-muted)' }}>{country} · {ap.name}</p>
            <div className="flex gap-4 mt-1.5">
              {[
                { label: 'Capacidad', val: cap },
                { label: 'Ocupación', val: `${occ} (${pct.toFixed(0)}%)` },
                { label: 'Tier', val: ap.tier === 1 ? 'Hub' : ap.tier === 2 ? 'Regional' : 'Pequeño' },
                { label: 'Continente', val: ap.continent === 'America' ? 'América' : ap.continent === 'Europe' ? 'Europa' : 'Asia' },
              ].map(d => (
                <div key={d.label}>
                  <p className="text-[10px]" style={{ color: 'var(--panel-text-faint)' }}>{d.label}</p>
                  <p className="text-xs" style={{ color: d.label === 'Ocupación' ? semColor : 'var(--map-overlay-text)' }}>{d.val}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--panel-border)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: semColor }} />
            </div>
          </div>
        );
      })()}

      {/* Map */}
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 150, center: [0, 20] }}
        style={{ width: '100%', height: '100%', cursor: 'default' }}
        onClick={() => onClearSelection?.()}
      >
        <ZoomableGroup
          zoom={zoom}
          center={center}
          onMoveEnd={handleMoveEnd}
          minZoom={1}
          maxZoom={8}
        >
          <rect x={-500} y={-500} width={2000} height={2000} fill={mc.bg} />

          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={mc.land}
                  stroke={mc.border}
                  strokeWidth={0.4 * markerScale}
                  style={{
                    default: { outline: 'none' },
                    hover: { fill: mc.landHover, outline: 'none' },
                    pressed: { outline: 'none' },
                  }}
                />
              ))
            }
          </Geographies>

          {zoom >= 1.15 && COUNTRY_LABELS.map(label => (
            <Marker key={label.name} coordinates={[label.lng, label.lat]}>
              <text
                textAnchor="middle"
                style={{
                  fontSize: 8 / zoom,
                  fontWeight: 600,
                  letterSpacing: 0.2 / zoom,
                  fill: mc.label,
                  opacity: 0.55,
                  paintOrder: 'stroke',
                  stroke: mc.labelStroke,
                  strokeWidth: 2 / zoom,
                  pointerEvents: 'none',
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {label.name}
              </text>
            </Marker>
          ))}

          {/* Ruta completa del envío seleccionado (F01/F03/F09). */}
          {highlightedShipmentRoute.map((leg, index) => {
            const from = airports.find((airport) => airport.code === leg.desde);
            const to = airports.find((airport) => airport.code === leg.hasta);
            if (!from || !to) return null;
            return (
              <React.Fragment key={`shipment-route-${leg.envioIndice}-${leg.tramoIndex}-${leg.salidaUTC}`}>
                <Line
                  from={[from.lng, from.lat]}
                  to={[to.lng, to.lat]}
                  stroke="#e879f9"
                  strokeWidth={2.2 * markerScale}
                  strokeOpacity={0.9}
                  strokeLinecap="round"
                />
                <Marker coordinates={[from.lng, from.lat]}>
                  <circle r={5 * markerScale} fill="#e879f9" stroke={mc.bg} strokeWidth={1.4 * markerScale} />
                  <text textAnchor="middle" dy={1.5 * markerScale} style={{ fontSize: 5 * markerScale, fontWeight: 700, fill: '#ffffff', pointerEvents: 'none' }}>{index + 1}</text>
                </Marker>
              </React.Fragment>
            );
          })}

          {/* Cancelaciones visibles: ruta blanca punteada durante la ventana del vuelo cancelado, sin avión. */}
          {activeCancellations.map(c => (
            <Line
              key={`cancel-${c.id}`}
              from={[c.from.lng, c.from.lat]}
              to={[c.to.lng, c.to.lat]}
              stroke={mc.cancelledRoute}
              strokeWidth={1.05 * markerScale}
              strokeOpacity={0.9}
              strokeDasharray={`${2.4 * markerScale} ${2.4 * markerScale}`}
              strokeLinecap="round"
            />
          ))}

          {/* Rutas activas. Línea sólida = origen → avión. Línea punteada = avión → destino. */}
          {showPlanes && activeFlights.map((af, index) => {
            const flightKey = `${af.vuelo.idOrigen}-${af.vuelo.idDestino}-${af.vuelo.salidaUTC}-${af.vuelo.llegadaUTC}-${index}`;
            const selectedRouteKey = `${af.vuelo.idOrigen}-${af.vuelo.idDestino}-${af.vuelo.salidaUTC}`;
            const isSelected = selectedFlightKey === selectedRouteKey;
            const occupancyStatus = getFlightOccupancyStatus(af.vuelo.ocupacionActual ?? 0, af.vuelo.capacidadMaxima, config.thresholds.flight);
            const activeColor = isSelected ? '#a855f7' : getFlightOccupancyColor(occupancyStatus, isDarkTheme);
            const baseWidth = (isSelected ? 1.8 : 1.0) * markerScale;

            return (
              <React.Fragment key={`active-route-${flightKey}`}>
                {/* Tramo recorrido: origen → avión */}
                <Line
                  from={[af.trailLng, af.trailLat]}
                  to={[af.lng, af.lat]}
                  stroke={activeColor}
                  strokeWidth={baseWidth}
                  strokeLinecap="round"
                  strokeOpacity={0.72}
                />

                {/* Tramo pendiente: avión → destino */}
                <Line
                  from={[af.lng, af.lat]}
                  to={[af.toLng, af.toLat]}
                  stroke={activeColor}
                  strokeWidth={baseWidth * 0.9}
                  strokeOpacity={0.45}
                  strokeDasharray={`${2.4 * markerScale} ${2.4 * markerScale}`}
                  strokeLinecap="round"
                />
              </React.Fragment>
            );
          })}

          {/* Animated airplanes — clickable */}
          {showPlanes && activeFlights.map((af, index) => {
            const flightKey = `${af.vuelo.idOrigen}-${af.vuelo.idDestino}-${af.vuelo.salidaUTC}`;
            const isSelected = selectedFlightKey === flightKey;
            const planeSize = 4.4 * markerScale;
            const occupancyStatus = getFlightOccupancyStatus(af.vuelo.ocupacionActual ?? 0, af.vuelo.capacidadMaxima, config.thresholds.flight);
            const routeColor = getFlightOccupancyColor(occupancyStatus, isDarkTheme);
            const planeColor = isDarkTheme ? routeColor : '#f97316';
            const emphasisColor = isSelected ? '#a855f7' : routeColor;
            return (
              <Marker
                key={`plane-${flightKey}-${af.vuelo.llegadaUTC}-${index}`}
                coordinates={[af.lng, af.lat]}
                onClick={(event) => {
                  event.stopPropagation();
                  onFlightSelect?.(af.vuelo);
                }}
                style={{ cursor: 'pointer' }}
              >
                {/* Selection ring */}
                {isSelected && (
                  <circle
                    r={planeSize * 3.2}
                    fill="none"
                    stroke={emphasisColor}
                    strokeWidth={1.5 * markerScale}
                    opacity={0.85}
                  />
                )}
                {/* Glow */}
                <circle r={planeSize * (isSelected ? 2.7 : 1.9)} fill={emphasisColor} opacity={isSelected ? 0.32 : 0.16} />
                <circle r={planeSize * 0.65} fill={mc.bg} opacity={0.45} />
                {/* Avión real: el path está centrado y su nariz apunta hacia arriba en 0°. */}
                <g transform={`rotate(${af.angle}) scale(${planeSize / 32})`}>
                  <path
                    d="
                      M 30 0
                      C 27 -3 23 -4 18 -4
                      L 6 -4
                      L -7 -18
                      C -8.5 -19.5 -11 -18.5 -10 -16
                      L -5 -4
                      L -18 -4
                      L -27 -10
                      C -29 -11.5 -31 -10 -31 -7
                      L -31 7
                      C -31 10 -29 11.5 -27 10
                      L -18 4
                      L -5 4
                      L -10 16
                      C -11 18.5 -8.5 19.5 -7 18
                      L 6 4
                      L 18 4
                      C 23 4 27 3 30 0
                      Z
                    "
                    fill={planeColor}
                    stroke={mc.bg}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />

                  {/* Cabina / cuerpo central */}
                  <path
                    d="M 22 0 L 4 -2.2 L -9 0 L 4 2.2 Z"
                    fill={mc.bg}
                    opacity={0.45}
                  />

                  {/* Línea central */}
                  <path
                    d="M -20 0 L 24 0"
                    stroke={mc.bg}
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    opacity={0.55}
                  />
                </g>
              </Marker>
            );
          })}

          {/* Aeropuertos compactos: visibles cuando el zoom alejado
              oculta el marcador principal por proximidad. */}
          {compactAirports.map((airport) => {
            const isHovered = hoveredAirport === airport.id;
            const compactRadius = (isHovered ? 3.1 : 1.8) * markerScale;
            const compactLabelSize = 7 / zoom;
            const compactColor = getAirportColor(airport);
            return (
              <Marker
                key={`compact-airport-${airport.id}`}
                coordinates={[airport.lng, airport.lat]}
                onClick={(event) => {
                  event.stopPropagation();
                  onAirportSelect?.(airport.id);
                }}
                onMouseEnter={() => setHoveredAirport(airport.id)}
                onMouseLeave={() => setHoveredAirport(null)}
                style={{ cursor: 'pointer' }}
              >
                {isHovered && (
                  <circle
                    r={compactRadius + 3 * markerScale}
                    fill={compactColor}
                    opacity={0.2}
                  />
                )}
                <circle
                  r={compactRadius}
                  fill={compactColor}
                  stroke={mc.bg}
                  strokeWidth={0.9 * markerScale}
                />
                {isHovered && (
                  <text
                    textAnchor="middle"
                    y={-(compactRadius + 5 / zoom)}
                    style={{
                      fontSize: compactLabelSize,
                      fontWeight: 700,
                      fill: mc.label,
                      paintOrder: 'stroke',
                      stroke: mc.labelStroke,
                      strokeWidth: 1.5 / zoom,
                      pointerEvents: 'none',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  >
                    {airport.code}
                  </text>
                )}
              </Marker>
            );
          })}

          {/* Airports */}
          {visibleAirports.map(airport => {
            const isSelected = selectedAirportId === airport.id;
            const isHovered = hoveredAirport === airport.id;
            const color = getAirportColor(airport);

            const tierR = 4.2;
            const r = ((isSelected || isHovered) ? tierR + 1.3 : tierR) * markerScale;
            const strokeW = (isSelected ? 2 : 1.2) * markerScale;
            // Tamaño de fuente constante en píxeles visuales (no crece con el zoom)
            const fontSize     = 9 / zoom;   // IATA code ≈ 9px visual siempre
            const fontSizeCity = 7 / zoom;   // ciudad  ≈ 7px visual siempre
            const labelOffset  = 10 / zoom;  // distancia al dot ≈ 10px visual siempre

            return (
              <Marker
                key={airport.id}
                coordinates={[airport.lng, airport.lat]}
                onClick={(event) => {
                  event.stopPropagation();
                  onAirportSelect?.(airport.id);
                }}
                onMouseEnter={() => setHoveredAirport(airport.id)}
                onMouseLeave={() => setHoveredAirport(null)}
                style={{ cursor: 'pointer' }}
              >
                {(isSelected || isHovered) && (
                  <circle r={r + 4 * markerScale} fill={color} opacity={0.22} />
                )}
                <g>
                  <path
                    d={`M 0 ${-r * 1.35} L ${r * 1.15} ${r * 0.25} L ${r * 0.42} ${r * 0.25} L ${r * 0.42} ${r * 1.15} L ${-r * 0.42} ${r * 1.15} L ${-r * 0.42} ${r * 0.25} L ${-r * 1.15} ${r * 0.25} Z`}
                    fill={color}
                    stroke={mc.label}
                    strokeOpacity={0.65}
                    strokeWidth={strokeW}
                    strokeLinejoin="round"
                  />
                  <path
                    d={`M ${-r * 0.45} ${-r * 0.08} H ${r * 0.45} M ${-r * 0.32} ${r * 0.42} H ${r * 0.32}`}
                    stroke={mc.bg}
                    strokeWidth={0.9 * markerScale}
                    strokeLinecap="round"
                    opacity={0.75}
                  />
                </g>
                {showCodes && (
                  <text
                    textAnchor="middle"
                    y={-(r + labelOffset)}
                    style={{
                      fontSize,
                      fontWeight: 700,
                      fill: mc.label,
                      paintOrder: 'stroke',
                      stroke: mc.labelStroke,
                      strokeWidth: 2 / zoom,
                      pointerEvents: 'none',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  >
                    {airport.code}
                  </text>
                )}
                {showCityNames && (
                  <text
                    textAnchor="middle"
                    y={-(r + labelOffset + fontSize + 2 / zoom)}
                    style={{
                      fontSize: fontSizeCity,
                      fontWeight: 400,
                      fill: mc.route,
                      paintOrder: 'stroke',
                      stroke: mc.labelStroke,
                      strokeWidth: 1.5 / zoom,
                      pointerEvents: 'none',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  >
                    {airport.city}
                  </text>
                )}
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>

      {/* Legend */}
      <div
        className="absolute right-4 rounded-lg backdrop-blur shadow-md border"
        style={{
          top: zoomInfoOpen ? '17.25rem' : '4.5rem',
          // Sin legendOpen, no forzar bottom/maxHeight: el cuadro debe encogerse
          // al tamaño de su encabezado, no quedar estirado con espacio vacío.
          bottom: legendOpen ? '1rem' : 'auto',
          width: 'min(220px, calc(100% - 2rem))',
          maxHeight: legendOpen ? (zoomInfoOpen ? 'calc(100% - 18.25rem)' : 'calc(100% - 5.5rem)') : 'none',
          overflowY: legendOpen ? 'auto' : 'hidden',
          overscrollBehavior: 'contain',
          scrollbarGutter: 'stable',
          backgroundColor: 'var(--map-overlay-bg)',
          borderColor: 'var(--panel-border)',
          padding: legendOpen ? '.7rem .75rem' : '.55rem .7rem',
        }}
      >
        <button
          onClick={() => setLegendOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '.5rem', marginBottom: legendOpen ? '.5rem' : 0 }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--map-overlay-text)' }}>Leyenda</span>
          {legendOpen
            ? <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--map-overlay-text-muted)' }} />
            : <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--map-overlay-text-muted)' }} />}
        </button>
        {legendOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', fontSize: 11, lineHeight: 1.3 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
            {[
              { color: 'bg-green-500', text: 'Capacidad OK (<60%)' },
              { color: 'bg-yellow-500', text: 'Capacidad Media (60-80%)' },
              { color: 'bg-red-500', text: 'Capacidad Alta (>80%)' },
            ].map(l => (
              <div key={l.text} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <div className={`h-3 w-3 rounded-full ${l.color}`} style={{ flexShrink: 0 }} />
                <span style={{ color: 'var(--map-overlay-text-muted)' }}>{l.text}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', borderTop: '1px solid var(--panel-border)', paddingTop: '.5rem' }}>
            <p style={{ fontWeight: 600, margin: 0, color: 'var(--panel-text-faint)' }}>Ocupación de aviones</p>
            {[
              { color: getFlightOccupancyColor('vacio', isDarkTheme), label: 'Vacío (0 maletas)' },
              { color: getFlightOccupancyColor('verde', isDarkTheme), label: `Verde (≤${config.thresholds.flight.green}%)` },
              { color: getFlightOccupancyColor('ambar', isDarkTheme), label: `Ámbar (${config.thresholds.flight.green}-${config.thresholds.flight.yellow}%)` },
              { color: getFlightOccupancyColor('rojo', isDarkTheme), label: `Rojo (>${config.thresholds.flight.yellow}%)` },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>{item.label}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', borderTop: '1px solid var(--panel-border)', paddingTop: '.5rem' }}>
            <p style={{ fontWeight: 600, margin: 0, color: 'var(--panel-text-faint)' }}>Lectura de ruta</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <div className="h-0.5 w-6 rounded-full bg-amber-400" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>Recorrido</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <div className="h-0.5 w-6 border-t-2 border-dashed" style={{ borderColor: '#fbbf24', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>Pendiente al destino</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <div className="h-0.5 w-6 border-t-2 border-dashed" style={{ borderColor: 'var(--cancelled-route)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>Vuelo cancelado</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', borderTop: '1px solid var(--panel-border)', paddingTop: '.5rem' }}>
            <p style={{ fontWeight: 600, margin: 0, color: 'var(--panel-text-faint)' }}>Ocupación de almacenes en aeropuertos</p>
            {[
              { color: getWarehouseOccupancyColor('vacio', isDarkTheme), label: 'Vacío (0 maletas)' },
              { color: getWarehouseOccupancyColor('verde', isDarkTheme), label: `Verde (≤${config.thresholds.warehouse.green}%)` },
              { color: getWarehouseOccupancyColor('ambar', isDarkTheme), label: `Ámbar (${config.thresholds.warehouse.green}-${config.thresholds.warehouse.yellow}%)` },
              { color: getWarehouseOccupancyColor('rojo', isDarkTheme), label: `Rojo (>${config.thresholds.warehouse.yellow}%)` },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>{item.label}</span>
              </div>
            ))}
            <span style={{ fontSize: 10, color: 'var(--map-overlay-text-muted)' }}>El marcador compacto conserva el mismo semáforo al alejar el mapa.</span>
          </div>
        </div>
        )}
      </div>

      {/* Tips */}
      <div className="absolute bottom-4 left-4 rounded-lg backdrop-blur shadow-md border" style={{ backgroundColor: 'var(--map-overlay-bg)', borderColor: 'var(--panel-border)' }}>
        {tipsOpen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.625rem', padding: '.625rem .875rem' }}>
            <p className="text-xs" style={{ color: 'var(--map-overlay-text-muted)', margin: 0 }}>
              Arrastra para mover · Scroll para zoom · Hover para detalles
            </p>
            <button onClick={() => setTipsOpen(false)} title="Ocultar">
              <X className="h-3 w-3" style={{ color: 'var(--map-overlay-text-muted)' }} />
            </button>
          </div>
        ) : (
          <button onClick={() => setTipsOpen(true)} title="Mostrar ayuda" style={{ padding: '.375rem .5rem', fontSize: 12, color: 'var(--map-overlay-text-muted)' }}>
            ?
          </button>
        )}
      </div>
    </div>
  );
});
