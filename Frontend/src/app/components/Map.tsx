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
import { Airport, Continent, Vuelo } from '../types';
import { ZoomIn, ZoomOut, Filter, Maximize2 } from 'lucide-react';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { getFlightDuration } from '../data/envios';

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

// ─── Active flights calculation ───
interface ActiveFlight {
  vuelo: Vuelo;
  progress: number; // 0..1
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  lat: number;
  lng: number;
  angle: number;
  isSameCont: boolean;
}

function getActiveFlights(
  simMinuteOfDay: number,
  vuelosBackend: import('../types').Vuelo[],
  aeropuertosBackend: import('../types').Aeropuerto[],
  airports: import('../types').Airport[],
): ActiveFlight[] {
  const active: ActiveFlight[] = [];

  for (const vuelo of vuelosBackend) {
    const origAp = aeropuertosBackend.find(a => a.id === vuelo.idOrigen);
    const destAp = aeropuertosBackend.find(a => a.id === vuelo.idDestino);
    if (!origAp || !destAp) continue;

    const origFront = airports.find(a => a.code === origAp.iata);
    const destFront = airports.find(a => a.code === destAp.iata);
    if (!origFront || !destFront) continue;

    const duration = getFlightDuration(vuelo);
    if (duration <= 0) continue;

    // Check if flight is active at current minute
    let elapsed: number;
    if (vuelo.llegadaUTC >= vuelo.salidaUTC) {
      // Same day flight
      if (simMinuteOfDay < vuelo.salidaUTC || simMinuteOfDay > vuelo.llegadaUTC) continue;
      elapsed = simMinuteOfDay - vuelo.salidaUTC;
    } else {
      // Crosses midnight
      if (simMinuteOfDay >= vuelo.salidaUTC) {
        elapsed = simMinuteOfDay - vuelo.salidaUTC;
      } else if (simMinuteOfDay <= vuelo.llegadaUTC) {
        elapsed = (1440 - vuelo.salidaUTC) + simMinuteOfDay;
      } else {
        continue;
      }
    }

    const progress = Math.min(Math.max(elapsed / duration, 0), 1);

    // Interpolate position using great circle approximation (linear lerp for simplicity)
    const lat = origFront.lat + (destFront.lat - origFront.lat) * progress;
    const lng = origFront.lng + (destFront.lng - origFront.lng) * progress;

    // Angle for rotation
    const dLng = destFront.lng - origFront.lng;
    const dLat = destFront.lat - origFront.lat;
    const angle = Math.atan2(dLng, dLat) * (180 / Math.PI);

    active.push({
      vuelo,
      progress,
      fromLat: origFront.lat,
      fromLng: origFront.lng,
      toLat: destFront.lat,
      toLng: destFront.lng,
      lat,
      lng,
      angle,
      isSameCont: origAp.continente === destAp.continente,
    });
  }

  return active;
}

interface MapProps {
  selectedAirportId?: string;
  onAirportSelect?: (airportId: string) => void;
  onFlightSelect?: (vuelo: Vuelo) => void;
  selectedFlightKey?: string; // `${idOrigen}-${idDestino}-${salidaUTC}`
}

export const Map = memo(function Map({ selectedAirportId, onAirportSelect, onFlightSelect, selectedFlightKey }: MapProps) {
  const { baggages, isRunning, simulationTime, aeropuertosState, tiempoSimUTC } = useSimulation();
  const { airports, flights, aeropuertosBackend, vuelosBackend } = useDomain();

  // Solo hay aviones reales cuando la simulación ha avanzado al menos un tick
  const simHasStarted = tiempoSimUTC > 0;
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([20, 10]);
  const [filter, setFilter] = useState<Continent | 'all'>('all');
  const [hoveredAirport, setHoveredAirport] = useState<string | null>(null);
  const [showPlanes, setShowPlanes] = useState(true);
  const [, setTick] = useState(0);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTick(t => t + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // ── Animación suave: extrapolación 10fps entre ticks SSE ──────────────────
  // Guardamos el último tick conocido y la tasa de avance inferida,
  // luego interpolamos cada 100ms para evitar saltos bruscos.
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
      lastTickRef.current.advancePerMs = (newUtcMin - prev.utcMin) / elapsedMs;
    }
    lastTickRef.current.utcMin  = newUtcMin;
    lastTickRef.current.wallMs  = now;
    setSmoothMinute(Math.floor(newUtcMin) % 1440);
  }, [tiempoSimUTC, simHasStarted]);

  // Loop a 10fps: extrapola posición entre ticks
  React.useEffect(() => {
    if (!isRunning || !showPlanes || !simHasStarted) return;
    const id = setInterval(() => {
      const now = performance.now();
      const ref = lastTickRef.current;
      if (ref.advancePerMs <= 0) return;
      const extrapolated = ref.utcMin + (now - ref.wallMs) * ref.advancePerMs;
      setSmoothMinute(Math.floor(extrapolated) % 1440);
    }, 100);
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
    [filter]
  );

  const visibleAirports = useMemo(() => {
    const decluttered = declutterAirports(filteredByContinent, zoom);
    if (selectedAirportId && !decluttered.find(a => a.id === selectedAirportId)) {
      const sel = filteredByContinent.find(a => a.id === selectedAirportId);
      if (sel) decluttered.push(sel);
    }
    return decluttered;
  }, [filteredByContinent, zoom, selectedAirportId]);

  const filteredFlights = useMemo(() =>
    flights.filter(f => {
      if (filter === 'all') return true;
      const from = airports.find(a => a.id === f.fromAirportId);
      const to = airports.find(a => a.id === f.toAirportId);
      return from?.continent === filter || to?.continent === filter;
    }),
    [filter]
  );

  const activeFlights = useMemo(() => {
    if (!showPlanes || !simHasStarted) return [];
    const all = getActiveFlights(smoothMinute, vuelosBackend, aeropuertosBackend, airports);
    // Filter by continent if needed
    if (filter === 'all') return all;
    return all.filter(af => {
      const origAp = aeropuertosBackend.find(a => a.id === af.vuelo.idOrigen);
      const destAp = aeropuertosBackend.find(a => a.id === af.vuelo.idDestino);
      const contMap: Record<number, Continent> = { 1: 'America', 2: 'Europe', 3: 'Asia' };
      return contMap[origAp?.continente ?? 0] === filter || contMap[destAp?.continente ?? 0] === filter;
    });
  }, [smoothMinute, showPlanes, simHasStarted, filter, vuelosBackend, aeropuertosBackend, airports]);

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
      const pct = parseFloat(live.ocupacion) * 100;
      return { occ: live.maletas_almacen, cap: live.capacidad_almacen, pct };
    }
    const pct = fallback.cap > 0 ? (fallback.occ / fallback.cap) * 100 : 0;
    return { occ: fallback.occ, cap: fallback.cap, pct };
  }, [aeropuertosState]);

  // ─── Set of origin→dest pairs with active planes (for route filtering) ───
  const activeRoutePairs = useMemo(() => {
    const s = new Set<string>();
    activeFlights.forEach(af => s.add(`${af.vuelo.idOrigen}-${af.vuelo.idDestino}`));
    return s;
  }, [activeFlights]);

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
            style={{ backgroundColor: 'var(--map-overlay-bg)', color: showPlanes ? '#3b82f6' : 'var(--map-overlay-text-muted)' }}
            title={showPlanes ? 'Ocultar aviones' : 'Mostrar aviones'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
            <span className="text-xs hidden sm:inline">{activeFlights.length}</span>
          </button>
        )}
      </div>

      {/* Zoom info */}
      <div className="absolute right-4 top-4 z-10 rounded-lg backdrop-blur px-3 py-2 shadow-md" style={{ backgroundColor: 'var(--map-overlay-bg)' }}>
        <p className="text-xs" style={{ color: 'var(--map-overlay-text-muted)' }}>Zoom</p>
        <p className="text-sm font-medium" style={{ color: 'var(--map-overlay-text)' }}>{zoom.toFixed(1)}x</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--panel-text-faint)' }}>
          {visibleCount}/{totalInFilter} aeropuertos
        </p>
        {showPlanes && simHasStarted && activeFlights.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: '#3b82f6' }}>
            {activeFlights.length} vuelos activos
          </p>
        )}
        {!simHasStarted && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--panel-text-faint)' }}>
            Sin simulación activa
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

          {/* Flight routes — only draw routes that have at least one active plane */}
          {filteredFlights.map(flight => {
            const from = airports.find(a => a.id === flight.fromAirportId);
            const to = airports.find(a => a.id === flight.toAirportId);
            if (!from || !to) return null;
            const fromBk = aeropuertosBackend.find(a => a.iata === from.code);
            const toBk   = aeropuertosBackend.find(a => a.iata === to.code);
            if (!fromBk || !toBk) return null;
            const hasPlane = activeRoutePairs.has(`${fromBk.id}-${toBk.id}`)
                          || activeRoutePairs.has(`${toBk.id}-${fromBk.id}`);
            if (!hasPlane) return null;
            const fromVisible = visibleAirports.some(a => a.id === from.id);
            const toVisible   = visibleAirports.some(a => a.id === to.id);
            if (!fromVisible || !toVisible) return null;
            return (
              <Line
                key={flight.id}
                from={[from.lng, from.lat]}
                to={[to.lng, to.lat]}
                stroke={flight.sameContinentRoute ? mc.route : '#3b82f6'}
                strokeWidth={(flight.sameContinentRoute ? 0.6 : 1.2) * markerScale}
                strokeLinecap="round"
                strokeDasharray={flight.sameContinentRoute ? `${3 * markerScale} ${2 * markerScale}` : '0'}
                strokeOpacity={0.55}
              />
            );
          })}

          {/* Animated airplanes — clickable */}
          {showPlanes && activeFlights.map((af) => {
            const flightKey = `${af.vuelo.idOrigen}-${af.vuelo.idDestino}-${af.vuelo.salidaUTC}`;
            const isSelected = selectedFlightKey === flightKey;
            const planeSize = (af.isSameCont ? 3.5 : 5) * markerScale;
            const color = af.isSameCont ? '#60a5fa' : '#fbbf24';
            return (
              <Marker
                key={`plane-${flightKey}`}
                coordinates={[af.lng, af.lat]}
                onClick={() => onFlightSelect?.(af.vuelo)}
                style={{ cursor: 'pointer' }}
              >
                {/* Selection ring */}
                {isSelected && <circle r={planeSize * 3} fill="none" stroke={color} strokeWidth={1.5 * markerScale} opacity={0.8} />}
                {/* Glow */}
                <circle r={planeSize * (isSelected ? 2.5 : 1.8)} fill={color} opacity={isSelected ? 0.3 : 0.15} />
                {/* Airplane icon */}
                <g transform={`rotate(${-af.angle + 90}) scale(${planeSize / 12})`}>
                  <path
                    d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
                    fill={color}
                    stroke={mc.bg}
                    strokeWidth={1}
                    transform="translate(-12, -12)"
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
      <div className="absolute bottom-4 right-4 rounded-lg backdrop-blur p-3 shadow-md border" style={{ backgroundColor: 'var(--map-overlay-bg)', borderColor: 'var(--panel-border)' }}>
        <p className="mb-2 text-xs font-medium" style={{ color: 'var(--map-overlay-text)' }}>Leyenda</p>
        <div className="space-y-1.5">
          {[
            { color: 'bg-green-500', text: 'Capacidad OK (<60%)' },
            { color: 'bg-yellow-500', text: 'Capacidad Media (60-80%)' },
            { color: 'bg-red-500', text: 'Capacidad Alta (>80%)' },
          ].map(l => (
            <div key={l.text} className="flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${l.color}`} />
              <span className="text-xs" style={{ color: 'var(--map-overlay-text-muted)' }}>{l.text}</span>
            </div>
          ))}
          <div className="border-t pt-1.5 mt-1.5" style={{ borderColor: 'var(--panel-border)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--panel-text-faint)' }}>Aviones en vuelo</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-blue-400" />
                <span className="text-[10px]" style={{ color: 'var(--map-overlay-text-muted)' }}>Continental</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-[10px]" style={{ color: 'var(--map-overlay-text-muted)' }}>Intercontinental</span>
              </div>
            </div>
          </div>
          <div className="border-t pt-1.5 mt-1.5" style={{ borderColor: 'var(--panel-border)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--panel-text-faint)' }}>Tamaño por tier</p>
            <div className="flex items-center gap-3">
              {[
                { size: 'h-3 w-3', label: 'Hub' },
                { size: 'h-2.5 w-2.5', label: 'Regional' },
                { size: 'h-2 w-2', label: 'Pequeño' },
              ].map(t => (
                <div key={t.label} className="flex items-center gap-1">
                  <div className={`${t.size} rounded-full`} style={{ backgroundColor: 'var(--map-overlay-text-muted)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--map-overlay-text-muted)' }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="absolute bottom-4 left-4 rounded-lg backdrop-blur p-2 shadow-md border" style={{ backgroundColor: 'var(--map-overlay-bg)', borderColor: 'var(--panel-border)' }}>
        <p className="text-xs" style={{ color: 'var(--map-overlay-text-muted)' }}>
          Arrastra para mover · Scroll o botones para zoom · Hover para detalles
        </p>
      </div>
    </div>
  );
});
