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
import { Airport, Continent, Vuelo, PlanTramoVisual, Aeropuerto } from '../types';
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
  const flights: ActiveFlight[] = [];
  let totalActive = 0;
  const currentMinute = simMinuteUTC;

  for (const tramo of planTramos) {
    if (currentMinute < tramo.salidaUTC || currentMinute >= tramo.llegadaUTC) continue;

    const origFront = airports.find(a => a.code === tramo.desde);
    const destFront = airports.find(a => a.code === tramo.hasta);
    if (!origFront || !destFront) continue;

    const origBack = aeropuertosBackend.find(a => a.iata === tramo.desde);
    const destBack = aeropuertosBackend.find(a => a.iata === tramo.hasta);
    const origCont = airportContinentFromBackend(origBack) ?? origFront.continent;
    const destCont = airportContinentFromBackend(destBack) ?? destFront.continent;

    if (filter !== 'all' && origCont !== filter && destCont !== filter) continue;

    totalActive++;
    if (flights.length >= MAX_VISIBLE_ACTIVE_FLIGHTS) continue;

    const duration = tramo.llegadaUTC - tramo.salidaUTC;
    const progress = clamp((currentMinute - tramo.salidaUTC) / duration);

    const lat = lerp(origFront.lat, destFront.lat, progress);
    const lng = lerpLng(origFront.lng, destFront.lng, progress);

    // Línea del vuelo activo: debe quedar anclada en el aeropuerto de origen
    // y crecer hasta la posición actual del avión. Se elimina sola al llegar.
    const trailLat = origFront.lat;
    const trailLng = origFront.lng;

    // La nariz del avión siempre apunta hacia el destino del tramo, no hacia
    // el rastro ni hacia una posición anterior.
    const angle = getPlaneRotationToDestination(lat, lng, destFront.lat, destFront.lng);

    // Buscar el vuelo real correspondiente en vuelosBackend para obtener la capacidad
    const tramoSalidaDia = ((tramo.salidaUTC % 1440) + 1440) % 1440;
    const tramoLlegadaDia = ((tramo.llegadaUTC % 1440) + 1440) % 1440;
    const tramoDuracionNormalizada = duracionMinutosDia(tramoSalidaDia, tramoLlegadaDia);
    
    let vueloReal = vuelosBackend.find(v =>
      v.idOrigen === origBack?.id &&
      v.idDestino === destBack?.id &&
      Math.abs(v.salidaUTC - tramoSalidaDia) < 2 && // tolerancia de ±1 minuto
      Math.abs(duracionMinutosDia(v.salidaUTC, v.llegadaUTC) - tramoDuracionNormalizada) < 5 // tolerancia de ±4 min
    );
    
    // Fallback: si no hay match exacto, buscar por ruta con capacidadMaxima válida
    if (!vueloReal) {
      vueloReal = vuelosBackend.find(v =>
        v.idOrigen === origBack?.id &&
        v.idDestino === destBack?.id &&
        v.capacidadMaxima > 0
      );
    }

    flights.push({
      vuelo: {
        idOrigen: origBack?.id ?? 0,
        idDestino: destBack?.id ?? 0,
        salidaUTC: tramo.salidaUTC,
        llegadaUTC: tramo.llegadaUTC,
        capacidadMaxima: vueloReal?.capacidadMaxima ?? 0,
        ocupacionActual: tramo.maletas,
      },
      envioIndice: tramo.envioIndice,
      tramoIndex: tramo.tramoIndex,
      progress,
      fromLat: origFront.lat,
      fromLng: origFront.lng,
      toLat: destFront.lat,
      toLng: destFront.lng,
      trailLat,
      trailLng,
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
  selectedFlightKey?: string; // `${idOrigen}-${idDestino}-${salidaUTC}`
}

export const Map = memo(function Map({ selectedAirportId, onAirportSelect, onFlightSelect, selectedFlightKey }: MapProps) {
  const { isRunning, aeropuertosState, tiempoSimUTC, contadores, planTramos, planVisualCargado, config } = useSimulation();
  const { airports, aeropuertosBackend, vuelosBackend } = useDomain();

  // Solo hay aviones reales cuando la simulación ha avanzado al menos un tick
  const simHasStarted = tiempoSimUTC > 0;
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([20, 10]);
  const [filter, setFilter] = useState<Continent | 'all'>('all');
  const [hoveredAirport, setHoveredAirport] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);   // leyenda del mapa minimizable
  const [tipsOpen, setTipsOpen] = useState(true);        // indicaciones de arrastre minimizables
  const [showPlanes, setShowPlanes] = useState(true);
  const [, setTick] = useState(0);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTick(t => t + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

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
  };

  const filteredByContinent = useMemo(() =>
    airports.filter(a => filter === 'all' || a.continent === filter),
    [airports, filter]
  );

  const visibleAirports = useMemo(() => {
    const decluttered = declutterAirports(filteredByContinent, zoom);
    if (selectedAirportId && !decluttered.find(a => a.id === selectedAirportId)) {
      const sel = filteredByContinent.find(a => a.id === selectedAirportId);
      if (sel) decluttered.push(sel);
    }
    return decluttered;
  }, [filteredByContinent, zoom, selectedAirportId]);

  const activeFlightResult = useMemo(() => {
    if (!showPlanes || !simHasStarted || !planVisualCargado || planTramos.length === 0) {
      return { flights: [], totalActive: 0 };
    }
    return getActiveFlightsFromPlan(smoothMinute, planTramos, airports, aeropuertosBackend, vuelosBackend, filter);
  }, [smoothMinute, showPlanes, simHasStarted, planVisualCargado, planTramos, airports, aeropuertosBackend, vuelosBackend, filter]);

  const activeFlights = activeFlightResult.flights;
  const activeFlightTotal = activeFlightResult.totalActive;

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

  // ─── Live airport color from SSE aeropuertosState ───
  const getAirportColor = useCallback((airportCode: string, fallbackPct: number): string => {
    const live = aeropuertosState.find(a => a.iata === airportCode);
    if (live) {
      if (live.semaforo === 'rojo')  return '#ef4444';
      if (live.semaforo === 'ambar') return '#f59e0b';
      return '#10b981';
    }
    if (fallbackPct > 80) return '#ef4444';
    if (fallbackPct > 60) return '#f59e0b';
    return '#10b981';
  }, [aeropuertosState]);

  const getLiveOccupancy = useCallback((airportCode: string, fallback: { occ: number; cap: number }) => {
    const live = aeropuertosState.find(a => a.iata === airportCode);
    if (live) {
      const pct = live.ocupacion * 100;
      return { occ: live.maletas_almacen, cap: live.capacidad_almacen, pct };
    }
    const pct = fallback.cap > 0 ? (fallback.occ / fallback.cap) * 100 : 0;
    return { occ: fallback.occ, cap: fallback.cap, pct };
  }, [aeropuertosState]);

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
        </div>
        {/* Planes toggle — solo visible cuando hay simulación activa */}
        {simHasStarted && (
          <button
            onClick={() => setShowPlanes(!showPlanes)}
            className="flex items-center gap-1.5 rounded-lg backdrop-blur px-3 py-1.5 shadow-md transition-colors"
            style={{ backgroundColor: 'var(--map-overlay-bg)', color: showPlanes ? '#fbbf24' : 'var(--map-overlay-text-muted)' }}
            title={showPlanes ? 'Ocultar aviones' : 'Mostrar aviones'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
            <span className="text-xs hidden sm:inline">{activeFlightTotal || contadores.en_vuelo}</span>
          </button>
        )}
      </div>

      {/* Zoom info */}
      <div className="absolute right-4 top-4 z-10 rounded-lg backdrop-blur px-4 py-3 shadow-md" style={{ backgroundColor: 'var(--map-overlay-bg)', display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.4, minWidth: 140 }}>
        <p className="text-xs" style={{ color: 'var(--map-overlay-text-muted)' }}>Zoom</p>
        <p className="text-sm font-medium" style={{ color: 'var(--map-overlay-text)' }}>{zoom.toFixed(1)}x</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--panel-text-faint)' }}>
          {visibleCount}/{totalInFilter} aeropuertos
        </p>
        {showPlanes && simHasStarted && (activeFlightTotal > 0 || contadores.en_vuelo > 0) && (
          <p className="text-xs mt-0.5" style={{ color: '#fbbf24' }}>
            {activeFlightTotal || contadores.en_vuelo} {config.scenario === 'collapse' ? 'envíos en tránsito' : 'vuelos activos'}
            {activeFlightTotal > activeFlights.length ? ` · ${activeFlights.length} visibles` : ''}
          </p>
        )}
        {!simHasStarted && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--panel-text-faint)' }}>
            Sin simulación activa
          </p>
        )}
        {config.scenario === 'collapse' && simHasStarted && (
          <p className="text-[10px] mt-1 text-panel-text-faint max-w-xs">
            Visualización acelerada: los vuelos se muestran de forma agregada por bloque.
          </p>
        )}
      </div>

      {/* Tooltip */}
      {hoveredAirport && (() => {
        const ap = airports.find(a => a.id === hoveredAirport);
        if (!ap) return null;
        const { occ, cap, pct } = getLiveOccupancy(ap.code, { occ: ap.currentOccupancy, cap: ap.warehouseCapacity });
        const semColor = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';
        return (
          <div className="absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-lg backdrop-blur px-4 py-3 shadow-xl pointer-events-none border" style={{ backgroundColor: 'var(--map-overlay-bg)', borderColor: 'var(--panel-border)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--map-overlay-text)' }}>{ap.code} — {ap.city}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--map-overlay-text-muted)' }}>{ap.name}</p>
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
        style={{ width: '100%', height: '100%' }}
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

          {/* Rutas activas. Línea sólida = origen → avión. Línea punteada = avión → destino. */}
          {showPlanes && activeFlights.map((af, index) => {
            const flightKey = `${af.vuelo.idOrigen}-${af.vuelo.idDestino}-${af.vuelo.salidaUTC}-${af.vuelo.llegadaUTC}-${index}`;
            const activeColor = af.isSameCont ? '#38bdf8' : '#fbbf24';
            const baseWidth = (af.isSameCont ? 0.75 : 1.05) * markerScale;

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
            const planeSize = (af.isSameCont ? 3.5 : 5) * markerScale;
            const color = af.isSameCont ? '#60a5fa' : '#fbbf24';
            return (
              <Marker
                key={`plane-${flightKey}-${af.vuelo.llegadaUTC}-${index}`}
                coordinates={[af.lng, af.lat]}
                onClick={() => onFlightSelect?.(af.vuelo)}
                style={{ cursor: 'pointer' }}
              >
                {/* Selection ring */}
                {isSelected && (
                  <circle
                    r={planeSize * 3.2}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5 * markerScale}
                    opacity={0.85}
                  />
                )}
                {/* Glow */}
                <circle r={planeSize * (isSelected ? 2.7 : 1.9)} fill={color} opacity={isSelected ? 0.32 : 0.16} />
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
                    fill={color}
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

          {/* Airports */}
          {visibleAirports.map(airport => {
            const isSelected = selectedAirportId === airport.id;
            const isHovered = hoveredAirport === airport.id;
            const color = getAirportColor(airport.code, (airport.currentOccupancy / airport.warehouseCapacity) * 100);

            const tierR = airport.tier === 1 ? 5 : airport.tier === 2 ? 3.5 : 2.5;
            const r = ((isSelected || isHovered) ? tierR + 1.5 : tierR) * markerScale;
            const strokeW = (isSelected ? 2 : 1.2) * markerScale;
            // Tamaño de fuente constante en píxeles visuales (no crece con el zoom)
            const fontSize     = 9 / zoom;   // IATA code ≈ 9px visual siempre
            const fontSizeCity = 7 / zoom;   // ciudad  ≈ 7px visual siempre
            const labelOffset  = 10 / zoom;  // distancia al dot ≈ 10px visual siempre

            return (
              <Marker
                key={airport.id}
                coordinates={[airport.lng, airport.lat]}
                onClick={() => onAirportSelect?.(airport.id)}
                onMouseEnter={() => setHoveredAirport(airport.id)}
                onMouseLeave={() => setHoveredAirport(null)}
                style={{ cursor: 'pointer' }}
              >
                {(isSelected || isHovered) && (
                  <circle r={r + 3 * markerScale} fill={color} opacity={0.2} />
                )}
                <circle
                  r={r}
                  fill={color}
                  stroke={mc.label}
                  strokeOpacity={0.5}
                  strokeWidth={strokeW}
                />
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
      <div className="absolute bottom-4 right-4 rounded-lg backdrop-blur p-4 shadow-md border" style={{ backgroundColor: 'var(--map-overlay-bg)', borderColor: 'var(--panel-border)', maxWidth: 270 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem', fontSize: 12, lineHeight: 1.4 }}>
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
            <p style={{ fontWeight: 600, margin: 0, color: 'var(--panel-text-faint)' }}>
              {config.scenario === 'collapse' ? 'Actividad en tránsito' : 'Vuelos activos'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <div className="h-2 w-2 rounded-full bg-blue-400" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>Ruta continental</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <div className="h-2 w-2 rounded-full bg-amber-400" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>Ruta intercontinental</span>
            </div>
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
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', borderTop: '1px solid var(--panel-border)', paddingTop: '.5rem' }}>
            <p style={{ fontWeight: 600, margin: 0, color: 'var(--panel-text-faint)' }}>Tamaño por tier</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {[
                { size: 'h-3 w-3', label: 'Hub' },
                { size: 'h-2.5 w-2.5', label: 'Regional' },
                { size: 'h-2 w-2', label: 'Pequeño' },
              ].map(t => (
                <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: '.375rem' }}>
                  <div className={`${t.size} rounded-full`} style={{ backgroundColor: 'var(--map-overlay-text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--map-overlay-text-muted)' }}>{t.label}</span>
                </div>
              ))}
            </div>
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
