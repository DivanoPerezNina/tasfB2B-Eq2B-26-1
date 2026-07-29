import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { useDomain } from '../context/DomainContext';
import {
  formatMinutesUTC,
  getContinentLabel,
} from '../data/envios';
import { Map as SimulationMap } from '../components/Map';
import { PlanTramoVisual, ShipmentMetadata, Vuelo } from '../types';
import { format } from 'date-fns';
import { formatUtcMinute, loadShipmentMetadataByIndices, planWindow, searchShipmentMetadata, shipmentLabel, shipmentRoutes } from '../lib/operations';
import { Button, Search as CarbonSearch } from '@carbon/react';
import { Pause, Play, StopFilledAlt, Renew } from '@carbon/icons-react';
import {
  X,
  MapPin,
  Plane,
  Package,
  CheckCircle,
  AlertCircle,
  Clock,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  XCircle,
  Trophy,
  Download,
  FileText,
} from 'lucide-react';

const COLLAPSE_ALL_SECTIONS_EVENT = 'tasfb2b:collapse-all-sections';
const FLEET_PAGE_SIZE = 50;

// ─── Collapsible Section ───
function Section({
  title,
  icon,
  children,
  defaultOpen = false,
  badge,
  accentColor,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
  accentColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const collapse = () => setOpen(false);
    window.addEventListener(COLLAPSE_ALL_SECTIONS_EVENT, collapse);
    return () => window.removeEventListener(COLLAPSE_ALL_SECTIONS_EVENT, collapse);
  }, []);

  return (
    <div className="border-b border-panel-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between hover:bg-panel-hover transition-colors"
        style={{ padding: '.75rem 1.25rem' }}
      >
        <div className="flex items-center gap-2">
          <span className={accentColor || 'text-panel-text-faint'}>{icon}</span>
          <span className="text-xs font-medium text-panel-text">{title}</span>
          {badge !== undefined && (
            <span className="rounded-full bg-panel-section-bg px-1.5 py-0.5 text-[9px] font-medium text-panel-text-faint">
              {badge}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-3 w-3 text-panel-text-faint" /> : <ChevronDown className="h-3 w-3 text-panel-text-faint" />}
      </button>
      {open && <div style={{ lineHeight: 1.5, padding: '0 1.25rem 1rem' }}>{children}</div>}
    </div>
  );
}

// ─── Search result types ───
type SearchResultType = 'aeropuerto' | 'vuelo' | 'envio';
interface SearchResult {
  type: SearchResultType;
  label: string;
  sublabel: string;
  data: any;
}

type WarehouseStatusFilter = 'all' | 'verde' | 'ambar' | 'rojo' | 'vacio';
type AirportOperationTab = 'almacenados' | 'llegadas' | 'salidas';


const SCENARIO_DISPLAY: Record<string, string> = {
  realtime: 'Operación día a día',
  collapse: 'Simulación hasta el colapso',
};

function formatFechaInicioTexto(date: Date) {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  const dia = date.getDate();
  const diaTexto = dia === 1 ? '1ro' : String(dia);

  const hora = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${diaTexto} de ${meses[date.getMonth()]} del ${date.getFullYear()} · ${hora}`;
}

function formatSimDateTimeUTCFromMinute(minUTC: number) {
  const d = new Date(minUTC * 60 * 1000);

  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();

  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');

  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function normalizarMinutoDia(min: number) {
  return ((min % 1440) + 1440) % 1440;
}

function duracionMinDia(salida: number, llegada: number) {
  const diff = llegada - salida;
  return diff >= 0 ? diff : diff + 1440;
}

function formatElapsedMilliseconds(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatElapsedSimulationMinutes(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const minutes = safeMinutes % 60;
  return `${days > 0 ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeLookupText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function baggageGroupLabel(shipmentId: string, baggageCount: number) {
  if (baggageCount <= 0) return 'Sin maletas';
  const first = `${shipmentId}-M001`;
  if (baggageCount === 1) return first;
  const last = `${shipmentId}-M${String(baggageCount).padStart(3, '0')}`;
  return `${first} … ${last}`;
}


export function UnifiedDashboard() {
  const {
    stats, getAirportStats,aeropuertosState,
    fase, contadores, progresoPct, warmupPct, simulationTime, tiempoSimUTC,
    collapseFailure, collapseResult, lastValidTick, config, planTramos, planResumen, lastStablePlan,
    pausarSimulacion, reanudarSimulacion, detenerSimulacion, resetear,
  } = useSimulation();
  const {
    airports,
    aeropuertosBackend,
    vuelosBackend: vuelosBD,
    aeropuertosBFF,
    isLoading: domainLoading,
  } = useDomain();

  // Helper: busca aeropuerto por ID numérico usando los datos live
  const getAeropuertoById = (id: number) => aeropuertosBackend.find(a => a.id === id);
  // Helper: vuelos que salen o llegan a un aeropuerto (por ID numérico)
  const getVuelosByAeropuerto = (id: number) => vuelosBD.filter(v => v.idOrigen === id || v.idDestino === id);
  const [selectedAirportId, setSelectedAirportId] = useState<string | undefined>();
  const [selectedVuelo, setSelectedVuelo] = useState<Vuelo | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showCompletion, setShowCompletion] = useState(false);
  const [warehouseQuery, setWarehouseQuery] = useState('');
  const [warehouseStatusFilter, setWarehouseStatusFilter] = useState<WarehouseStatusFilter>('all');
  const [airportOperationTab, setAirportOperationTab] = useState<AirportOperationTab>('almacenados');
  const [shipmentSearchResults, setShipmentSearchResults] = useState<ShipmentMetadata[]>([]);
  const [shipmentSearchLoading, setShipmentSearchLoading] = useState(false);
  const [shipmentMetadataByIndex, setShipmentMetadataByIndex] = useState<Map<number, ShipmentMetadata>>(new Map());
  const [selectedShipmentIndex, setSelectedShipmentIndex] = useState<number | null>(null);
  const [showStableReport, setShowStableReport] = useState(false);
  const [showInTransitReport, setShowInTransitReport] = useState(false);
  const [fleetQuery, setFleetQuery] = useState('');
  const [fleetPage, setFleetPage] = useState(1);
  const [realClockMs, setRealClockMs] = useState(() => Date.now());
  const [executionTiming, setExecutionTiming] = useState<{ startedAtMs: number | null; endedAtMs: number | null }>(() => {
    try {
      const stored = sessionStorage.getItem('tasfb2b.executionTiming');
      return stored ? JSON.parse(stored) : { startedAtMs: null, endedAtMs: null };
    } catch {
      return { startedAtMs: null, endedAtMs: null };
    }
  });
  const previousPhaseRef = useRef(fase);

  useEffect(() => {
    const timer = window.setInterval(() => setRealClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const activePhases = new Set(['planificando', 'listo', 'calentando', 'ejecutando', 'pausado']);
    const wasActive = activePhases.has(previousPhaseRef.current);
    const isActive = activePhases.has(fase);
    let next = executionTiming;

    // Una ejecución nueva debe comenzar siempre en 00:00:00.
    // Al detener, endedAtMs queda guardado para mostrar el tiempo final. Si el
    // dashboard vuelve a montarse cuando la siguiente simulación ya está activa,
    // previousPhaseRef también nace como activo; por eso además comprobamos
    // endedAtMs para distinguir una ejecución anterior de la nueva.
    if (
      isActive
      && (
        !wasActive
        || executionTiming.startedAtMs == null
        || executionTiming.endedAtMs != null
      )
    ) {
      next = { startedAtMs: Date.now(), endedAtMs: null };
    } else if (!isActive && wasActive && executionTiming.startedAtMs != null && executionTiming.endedAtMs == null) {
      next = { ...executionTiming, endedAtMs: Date.now() };
    }

    if (next !== executionTiming) {
      setExecutionTiming(next);
      sessionStorage.setItem('tasfb2b.executionTiming', JSON.stringify(next));
    }
    previousPhaseRef.current = fase;
  }, [executionTiming, fase]);

  // Show completion overlay when simulation finishes
  useEffect(() => {
    if (fase === 'completado') setShowCompletion(true);
  }, [fase]);

  // Track selected flight key for Map highlight
  const selectedFlightKey = selectedVuelo
    ? `${selectedVuelo.idOrigen}-${selectedVuelo.idDestino}-${selectedVuelo.salidaUTC}`
    : undefined;

  const handleFlightSelect = (vuelo: Vuelo) => {
    setSelectedVuelo(vuelo);
    const orig = getAeropuertoById(vuelo.idOrigen);
    if (orig) {
      const fa = airports.find(a => a.code === orig.iata);
      if (fa) setSelectedAirportId(fa.id);
    }
    setPanelOpen(true);
  };

  const routesByShipment = useMemo(() => shipmentRoutes(planTramos), [planTramos]);
  const currentPlanWindow = useMemo(() => planWindow(planResumen, planTramos), [planResumen, planTramos]);
  const selectedShipmentRoute = useMemo(
    () => selectedShipmentIndex != null ? (routesByShipment.get(selectedShipmentIndex) ?? []) : [],
    [routesByShipment, selectedShipmentIndex],
  );

  const ensureShipmentMetadata = useCallback(async (indices: number[]) => {
    if (!currentPlanWindow) return;
    const missing = Array.from(new Set(indices)).filter((index) => !shipmentMetadataByIndex.has(index)).slice(0, 250);
    if (missing.length === 0) return;
    try {
      const items = await loadShipmentMetadataByIndices(missing, currentPlanWindow);
      setShipmentMetadataByIndex((previous) => {
        const next = new Map(previous);
        items.forEach((item) => next.set(item.indice_plan, item));
        return next;
      });
    } catch (error) {
      console.warn('[Operaciones] No se pudieron resolver IDs de envíos:', error);
    }
  }, [currentPlanWindow, shipmentMetadataByIndex]);

  const inTransitShipmentRows = useMemo(() => {
    const rows: Array<{ index: number; route: PlanTramoVisual[]; activeLeg: PlanTramoVisual; metadata?: ShipmentMetadata }> = [];
    for (const [index, route] of routesByShipment.entries()) {
      const activeLeg = route.find((leg) => tiempoSimUTC >= leg.salidaUTC && tiempoSimUTC < leg.llegadaUTC);
      if (activeLeg) rows.push({ index, route, activeLeg, metadata: shipmentMetadataByIndex.get(index) });
    }
    return rows.sort((a, b) => a.activeLeg.llegadaUTC - b.activeLeg.llegadaUTC || a.index - b.index);
  }, [routesByShipment, shipmentMetadataByIndex, tiempoSimUTC]);

  useEffect(() => {
    ensureShipmentMetadata(inTransitShipmentRows.map((row) => row.index));
  }, [ensureShipmentMetadata, inTransitShipmentRows]);

  const downloadInTransitReport = () => {
    const header = ['ID_ENVIO', 'ESTADO', 'ORIGEN', 'DESTINO_TRAMO', 'DESTINO_FINAL', 'MALETAS', 'SALIDA_UTC', 'LLEGADA_UTC'];
    const rows = inTransitShipmentRows.map((row) => [
      shipmentLabel(row.metadata, row.index), 'EN CAMINO', row.activeLeg.desde, row.activeLeg.hasta,
      row.metadata?.destino_iata ?? row.route[row.route.length - 1]?.hasta ?? '', row.activeLeg.maletas,
      formatUtcMinute(row.activeLeg.salidaUTC), formatUtcMinute(row.activeLeg.llegadaUTC),
    ]);
    downloadTextFile(`envios_en_camino_${Date.now()}.csv`, [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const flightFromLeg = useCallback((leg: PlanTramoVisual): Vuelo | null => {
    const origin = aeropuertosBackend.find((airport) => airport.iata === leg.desde);
    const destination = aeropuertosBackend.find((airport) => airport.iata === leg.hasta);
    if (!origin || !destination) return null;
    const departureMinute = normalizarMinutoDia(leg.salidaUTC);
    const arrivalMinute = normalizarMinutoDia(leg.llegadaUTC);
    const realFlight = vuelosBD.find((flight) =>
      flight.idOrigen === origin.id
      && flight.idDestino === destination.id
      && Math.abs(normalizarMinutoDia(flight.salidaUTC) - departureMinute) <= 2,
    ) ?? vuelosBD.find((flight) => flight.idOrigen === origin.id && flight.idDestino === destination.id);
    return {
      idOrigen: origin.id,
      idDestino: destination.id,
      salidaUTC: leg.salidaUTC,
      llegadaUTC: leg.llegadaUTC,
      capacidadMaxima: realFlight?.capacidadMaxima ?? 0,
      ocupacionActual: leg.maletas,
    };
  }, [aeropuertosBackend, vuelosBD]);

  const selectShipment = useCallback((index: number, metadata?: ShipmentMetadata) => {
    const route = routesByShipment.get(index) ?? [];
    setSelectedShipmentIndex(index);
    if (metadata) {
      setShipmentMetadataByIndex((previous) => new Map(previous).set(index, metadata));
    }
    setPanelOpen(true);
    if (route.length === 0) return;

    const now = tiempoSimUTC;
    const activeLeg = route.find((leg) => now >= leg.salidaUTC && now < leg.llegadaUTC);
    if (activeLeg) {
      const flight = flightFromLeg(activeLeg);
      if (flight) setSelectedVuelo(flight);
      const origin = airports.find((airport) => airport.code === activeLeg.desde);
      if (origin) setSelectedAirportId(origin.id);
      return;
    }

    let currentCode = route[0].desde;
    if (now >= route[route.length - 1].llegadaUTC) {
      currentCode = route[route.length - 1].hasta;
    } else {
      for (let i = 0; i < route.length; i += 1) {
        const leg = route[i];
        const next = route[i + 1];
        if (now >= leg.llegadaUTC && (!next || now < next.salidaUTC)) {
          currentCode = leg.hasta;
          break;
        }
      }
    }
    const airport = airports.find((item) => item.code === currentCode);
    if (airport) setSelectedAirportId(airport.id);
    setSelectedVuelo(null);
  }, [airports, flightFromLeg, routesByShipment, tiempoSimUTC]);

  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const clearMapSelection = useCallback(() => {
    setSelectedShipmentIndex(null);
    setSelectedAirportId(undefined);
    setSelectedVuelo(null);
    setShowResults(false);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || !currentPlanWindow) {
      setShipmentSearchResults([]);
      setShipmentSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setShipmentSearchLoading(true);
      try {
        const items = await searchShipmentMetadata(term, currentPlanWindow, controller.signal);
        setShipmentSearchResults(items);
      } catch (error: any) {
        if (error?.name !== 'AbortError') console.warn('[Operaciones] búsqueda de envíos:', error);
        setShipmentSearchResults([]);
      } finally {
        setShipmentSearchLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentPlanWindow, query]);

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    const results: SearchResult[] = [];

    // Aeropuertos desde BD (via aeropuertosBFF que tiene ciudad y país)
    for (const ap of aeropuertosBFF) {
      if (
        ap.iata.includes(q) ||
        ap.ciudad.toUpperCase().includes(q) ||
        String(ap.pais ?? '').toUpperCase().includes(q)
      ) {
        results.push({
          type: 'aeropuerto',
          label: ap.iata,
          sublabel: `${ap.ciudad} · ${getContinentLabel(ap.continente)} · Cap: ${ap.capacidad_almacen}`,
          data: aeropuertosBackend.find(a => a.id === ap.id) ?? ap,
        });
      }
    }

    // Vuelos desde BD (usa vuelosBD con IDs numéricos)
    const seenRoutes = new Set<string>();
    for (const v of vuelosBD) {
      const orig = getAeropuertoById(v.idOrigen);
      const dest = getAeropuertoById(v.idDestino);
      if (!orig || !dest) continue;
      const routeKey = `${orig.iata}-${dest.iata}`;
      const routeStr2 = `${orig.iata} ${dest.iata}`;
      if (
        (routeKey.includes(q) || routeStr2.includes(q) || orig.iata.includes(q) || dest.iata.includes(q))
        && !(orig.iata === q || dest.iata === q)
        && !seenRoutes.has(routeKey)
      ) {
        seenRoutes.add(routeKey);
        results.push({
          type: 'vuelo',
          label: `${orig.iata} → ${dest.iata}`,
          sublabel: `Vuelo · ${formatMinutesUTC(v.salidaUTC)} - ${formatMinutesUTC(v.llegadaUTC)} · Cap: ${v.capacidadMaxima}`,
          data: v,
        });
      }
    }

    for (const shipment of shipmentSearchResults) {
      const route = routesByShipment.get(shipment.indice_plan) ?? [];
      results.unshift({
        type: 'envio',
        label: shipment.id_envio,
        sublabel: `${shipment.cantidad_maletas} maletas · ${shipment.origen_iata} → ${shipment.destino_iata}${route.length > 0 ? ` · ${route.length} tramo(s)` : ' · sin ruta visible'}`,
        data: shipment,
      });
    }
    return results.slice(0, 20);
  }, [query, aeropuertosBFF, vuelosBD, aeropuertosBackend, shipmentSearchResults, routesByShipment]);

  const handleSelectResult = (result: SearchResult) => {
    setShowResults(false);
    setQuery('');
    if (result.type === 'aeropuerto') {
      const ap = result.data as typeof aeropuertosBackend[0];
      const frontAirport = airports.find(a => a.code === ap.iata);
      if (frontAirport) { setSelectedShipmentIndex(null); setSelectedAirportId(frontAirport.id); setSelectedVuelo(null); }
    } else if (result.type === 'vuelo') {
      const v = result.data as Vuelo;
      setSelectedShipmentIndex(null);
      setSelectedVuelo(v);
      const orig = getAeropuertoById(v.idOrigen);
      if (orig) { const fa = airports.find(a => a.code === orig.iata); if (fa) setSelectedAirportId(fa.id); }
    } else {
      const shipment = result.data as ShipmentMetadata;
      selectShipment(shipment.indice_plan, shipment);
    }
  };

  const selectedAirport = selectedAirportId ? airports.find(a => a.id === selectedAirportId) : null;
  const airportStats = selectedAirportId ? getAirportStats(selectedAirportId) : null;
  const selectedBackendAirport = selectedAirport ? aeropuertosBackend.find(a => a.iata === selectedAirport.code) : null;
  const airportVuelos = selectedBackendAirport ? getVuelosByAeropuerto(selectedBackendAirport.id) : [];
  const selectedBFF = selectedAirport ? aeropuertosBFF.find(a => a.iata === selectedAirport.code) : null;

  const selectedShipmentMetadata = selectedShipmentIndex != null
    ? shipmentMetadataByIndex.get(selectedShipmentIndex)
    : undefined;

  const plannedShipmentRows = useMemo(() => {
    const now = tiempoSimUTC;
    return Array.from(routesByShipment.entries())
      .map(([index, route]) => {
        const nextLeg = route.find((leg) => leg.llegadaUTC > now) ?? route[route.length - 1];
        return { index, route, nextLeg, metadata: shipmentMetadataByIndex.get(index) };
      })
      .filter((row) => row.nextLeg && row.nextLeg.llegadaUTC > now)
      .sort((a, b) => a.nextLeg.salidaUTC - b.nextLeg.salidaUTC)
      .slice(0, 50);
  }, [routesByShipment, shipmentMetadataByIndex, tiempoSimUTC]);

  useEffect(() => {
    ensureShipmentMetadata(plannedShipmentRows.map((row) => row.index));
  }, [ensureShipmentMetadata, plannedShipmentRows]);

  const airportOperations = useMemo(() => {
    const code = selectedAirport?.code;
    const now = tiempoSimUTC;
    const stored: Array<{ index: number; route: PlanTramoVisual[]; leg: PlanTramoVisual; metadata?: ShipmentMetadata }> = [];
    const arrivals: Array<{ index: number; route: PlanTramoVisual[]; leg: PlanTramoVisual; metadata?: ShipmentMetadata }> = [];
    const departures: Array<{ index: number; route: PlanTramoVisual[]; leg: PlanTramoVisual; metadata?: ShipmentMetadata }> = [];
    if (!code) return { stored, arrivals, departures };

    for (const [index, route] of routesByShipment.entries()) {
      if (route.length === 0) continue;
      const metadata = shipmentMetadataByIndex.get(index);
      const first = route[0];
      const registration = first.registroUTC ?? metadata?.registro_utc ?? Number.NEGATIVE_INFINITY;

      if (now >= registration && now < first.salidaUTC && first.desde === code) {
        stored.push({ index, route, leg: first, metadata });
      }
      for (let i = 0; i < route.length; i += 1) {
        const leg = route[i];
        const next = route[i + 1];
        if (leg.hasta === code && leg.llegadaUTC > now) {
          arrivals.push({ index, route, leg, metadata });
        }
        if (leg.desde === code && leg.salidaUTC > now) {
          departures.push({ index, route, leg, metadata });
        }
        if (leg.hasta === code && now >= leg.llegadaUTC && next && now < next.salidaUTC) {
          stored.push({ index, route, leg: next, metadata });
        }
      }
    }

    stored.sort((a, b) => a.leg.salidaUTC - b.leg.salidaUTC);
    arrivals.sort((a, b) => a.leg.llegadaUTC - b.leg.llegadaUTC);
    departures.sort((a, b) => a.leg.salidaUTC - b.leg.salidaUTC);
    return { stored, arrivals, departures };
  }, [routesByShipment, selectedAirport?.code, shipmentMetadataByIndex, tiempoSimUTC]);

  useEffect(() => {
    const indices = [
      ...airportOperations.stored,
      ...airportOperations.arrivals,
      ...airportOperations.departures,
    ].slice(0, 200).map((row) => row.index);
    ensureShipmentMetadata(indices);
  }, [airportOperations, ensureShipmentMetadata]);

  const activeFlightsByOccupancy = useMemo(() => {
    const grouped = new Map<string, { leg: PlanTramoVisual; maletas: number }>();
    for (const leg of planTramos) {
      if (tiempoSimUTC < leg.salidaUTC || tiempoSimUTC >= leg.llegadaUTC) continue;
      const key = `${leg.desde}-${leg.hasta}-${leg.salidaUTC}-${leg.llegadaUTC}`;
      const current = grouped.get(key) ?? { leg, maletas: 0 };
      current.maletas += leg.maletas;
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).map(({ leg, maletas }) => {
      const origin = aeropuertosBackend.find((airport) => airport.iata === leg.desde);
      const destination = aeropuertosBackend.find((airport) => airport.iata === leg.hasta);
      const departureMinute = normalizarMinutoDia(leg.salidaUTC);
      const realFlight = vuelosBD.find((flight) =>
        flight.idOrigen === origin?.id
        && flight.idDestino === destination?.id
        && Math.abs(normalizarMinutoDia(flight.salidaUTC) - departureMinute) <= 2,
      ) ?? vuelosBD.find((flight) => flight.idOrigen === origin?.id && flight.idDestino === destination?.id);
      const capacity = realFlight?.capacidadMaxima ?? 0;
      const percentage = capacity > 0 ? (maletas / capacity) * 100 : 0;
      const flight: Vuelo | null = origin && destination ? {
        idOrigen: origin.id,
        idDestino: destination.id,
        salidaUTC: leg.salidaUTC,
        llegadaUTC: leg.llegadaUTC,
        capacidadMaxima: capacity,
        ocupacionActual: maletas,
      } : null;
      return { leg, maletas, capacity, percentage, flight };
    }).filter((row) => row.flight).sort((a, b) => b.percentage - a.percentage || b.maletas - a.maletas);
  }, [aeropuertosBackend, planTramos, tiempoSimUTC, vuelosBD]);

  const activeFlightBySchedule = useMemo(() => {
    const result = new globalThis.Map<string, typeof activeFlightsByOccupancy[number]>();
    for (const row of activeFlightsByOccupancy) {
      if (!row.flight) continue;
      const key = `${row.flight.idOrigen}-${row.flight.idDestino}-${normalizarMinutoDia(row.flight.salidaUTC)}`;
      result.set(key, row);
    }
    return result;
  }, [activeFlightsByOccupancy]);

  const fleetRows = useMemo(() => {
    const q = normalizeLookupText(fleetQuery);
    return vuelosBD.map((flight, index) => {
      const origin = aeropuertosBackend.find((airport) => airport.id === flight.idOrigen);
      const destination = aeropuertosBackend.find((airport) => airport.id === flight.idDestino);
      const originDetails = aeropuertosBFF.find((airport) => airport.iata === origin?.iata);
      const destinationDetails = aeropuertosBFF.find((airport) => airport.iata === destination?.iata);
      const key = `${flight.idOrigen}-${flight.idDestino}-${normalizarMinutoDia(flight.salidaUTC)}`;
      const active = activeFlightBySchedule.get(key);
      const load = active?.maletas ?? 0;
      const capacity = flight.capacidadMaxima ?? 0;
      const percentage = capacity > 0 ? (load / capacity) * 100 : 0;
      const unitCode = `${origin?.iata ?? flight.idOrigen}-${destination?.iata ?? flight.idDestino}-${String(Math.floor(normalizarMinutoDia(flight.salidaUTC) / 60)).padStart(2, '0')}${String(normalizarMinutoDia(flight.salidaUTC) % 60).padStart(2, '0')}`;
      const selectionFlight: Vuelo = active?.flight ?? { ...flight, ocupacionActual: load };
      const haystack = normalizeLookupText([
        unitCode,
        origin?.iata,
        destination?.iata,
        originDetails?.ciudad,
        originDetails?.pais,
        destinationDetails?.ciudad,
        destinationDetails?.pais,
      ].filter(Boolean).join(' '));
      return {
        index,
        unitCode,
        flight: selectionFlight,
        origin,
        destination,
        originDetails,
        destinationDetails,
        load,
        capacity,
        percentage,
        active: Boolean(active),
        haystack,
      };
    }).filter((row) => !q || row.haystack.includes(q))
      .sort((a, b) => Number(b.active) - Number(a.active) || b.percentage - a.percentage || a.unitCode.localeCompare(b.unitCode));
  }, [activeFlightBySchedule, aeropuertosBFF, aeropuertosBackend, fleetQuery, vuelosBD]);

  useEffect(() => {
    setFleetPage(1);
  }, [fleetQuery]);

  const fleetPageCount = Math.max(1, Math.ceil(fleetRows.length / FLEET_PAGE_SIZE));
  const fleetSafePage = Math.min(fleetPage, fleetPageCount);
  const fleetPageRows = useMemo(() => {
    const start = (fleetSafePage - 1) * FLEET_PAGE_SIZE;
    return fleetRows.slice(start, start + FLEET_PAGE_SIZE);
  }, [fleetRows, fleetSafePage]);

  const globalFleetSummary = useMemo(() => {
    const occupied = activeFlightsByOccupancy.reduce((sum, row) => sum + row.maletas, 0);
    const capacity = activeFlightsByOccupancy.reduce((sum, row) => sum + Math.max(0, row.capacity), 0);
    const percentage = capacity > 0 ? (occupied / capacity) * 100 : 0;
    const status = occupied <= 0
      ? 'vacio'
      : percentage <= config.thresholds.flight.green
        ? 'verde'
        : percentage <= config.thresholds.flight.yellow
          ? 'ambar'
          : 'rojo';
    const counts = { vacio: 0, verde: 0, ambar: 0, rojo: 0 };
    for (const row of activeFlightsByOccupancy) {
      const rowStatus = row.maletas <= 0
        ? 'vacio'
        : row.percentage <= config.thresholds.flight.green
          ? 'verde'
          : row.percentage <= config.thresholds.flight.yellow
            ? 'ambar'
            : 'rojo';
      counts[rowStatus] += 1;
    }
    return { occupied, capacity, percentage, status, counts, activeUnits: activeFlightsByOccupancy.length };
  }, [activeFlightsByOccupancy, config.thresholds.flight]);

  const getWarehouseOccupancy = (iata: string) => {
    const front = airports.find(a => a.code === iata);
    const liveStats = front ? getAirportStats(front.id) : null;
    if (liveStats) {
      return {
        occ: liveStats.occupancy,
        cap: liveStats.capacity,
        pct: liveStats.percentage,
      };
    }
    const bff = aeropuertosBFF.find(a => a.iata === iata);
    const cap = bff?.capacidad_almacen ?? front?.warehouseCapacity ?? 0;
    const occ = front?.currentOccupancy ?? 0;
    return {
      occ,
      cap,
      pct: cap > 0 ? (occ / cap) * 100 : 0,
    };
  };

  const getWarehouseStatus = (iata: string): WarehouseStatusFilter => {
    const { occ, pct } = getWarehouseOccupancy(iata);
    if (occ <= 0) return 'vacio';
    if (pct > config.thresholds.warehouse.yellow) return 'rojo';
    if (pct > config.thresholds.warehouse.green) return 'ambar';
    return 'verde';
  };

  const warehouseRows = useMemo(() => {
    const q = warehouseQuery.trim().toUpperCase();
    return aeropuertosBFF
      .map(ap => {
        const front = airports.find(a => a.code === ap.iata);
        const stats = getWarehouseOccupancy(ap.iata);
        const status = getWarehouseStatus(ap.iata);
        return { ap, front, stats, status };
      })
      .filter(row => {
        const haystack = `${row.ap.iata} ${row.ap.ciudad} ${row.ap.pais ?? ''}`.toUpperCase();
        const byQuery = !q || haystack.includes(q);
        const byStatus = warehouseStatusFilter === 'all' || row.status === warehouseStatusFilter;
        return byQuery && byStatus;
      })
      .sort((a, b) => b.stats.pct - a.stats.pct || a.ap.iata.localeCompare(b.ap.iata));
  }, [warehouseQuery, warehouseStatusFilter, aeropuertosBFF, airports, aeropuertosState, config.thresholds.warehouse]);

  const globalWarehouseSummary = useMemo(() => {
    const liveByCode = new globalThis.Map(aeropuertosState.map((airport) => [airport.iata, airport]));
    let occupied = 0;
    let capacity = 0;
    const counts = { vacio: 0, verde: 0, ambar: 0, rojo: 0 };

    for (const airport of aeropuertosBFF) {
      const live = liveByCode.get(airport.iata);
      const airportCapacity = live?.capacidad_almacen ?? airport.capacidad_almacen ?? 0;
      const airportOccupied = live?.maletas_almacen ?? 0;
      const percentage = airportCapacity > 0 ? (airportOccupied / airportCapacity) * 100 : 0;
      occupied += airportOccupied;
      capacity += airportCapacity;
      if (airportOccupied <= 0) counts.vacio += 1;
      else if (percentage <= config.thresholds.warehouse.green) counts.verde += 1;
      else if (percentage <= config.thresholds.warehouse.yellow) counts.ambar += 1;
      else counts.rojo += 1;
    }

    const percentage = capacity > 0 ? (occupied / capacity) * 100 : 0;
    const status = occupied <= 0
      ? 'vacio'
      : percentage <= config.thresholds.warehouse.green
        ? 'verde'
        : percentage <= config.thresholds.warehouse.yellow
          ? 'ambar'
          : 'rojo';
    return { occupied, capacity, percentage, status, counts };
  }, [aeropuertosBFF, aeropuertosState, config.thresholds.warehouse]);

  const statusData = [
    { name: 'Entregadas', value: stats.delivered, color: '#10b981' },
    { name: 'En Tránsito', value: stats.inTransit, color: '#3b82f6' },
    { name: 'Retrasadas', value: stats.delayed, color: '#ef4444' },
    { name: 'No Embarcadas', value: stats.notBoarded, color: '#f59e0b' },
  ].filter(item => item.value > 0);

  const typeIcons: Record<SearchResultType, React.ReactNode> = {
    aeropuerto: <MapPin className="h-3.5 w-3.5 text-blue-500" />,
    vuelo: <Plane className="h-3.5 w-3.5 text-indigo-500" />,
    envio: <Package className="h-3.5 w-3.5 text-fuchsia-500" />,
  };

  // ─── Fase label ───
  const faseLabel: Record<string, { text: string; color: string }> = {
    calentando: { text: 'Calentando…', color: 'text-orange-500' },
    ejecutando: { text: 'Ejecutando', color: 'text-green-500' },
    pausado:    { text: 'Pausado',    color: 'text-yellow-500' },
    completado: { text: 'Completado', color: 'text-blue-500' },
    planificando:{ text: 'Planificando', color: 'text-purple-500' },
    listo:      { text: 'Listo',      color: 'text-cyan-500' },
    error:      { text: 'Error',      color: 'text-red-500' },
    idle:       { text: 'Inactivo',   color: 'text-panel-text-faint' },
  };
  const fl = faseLabel[fase] ?? faseLabel.idle;
  const inicioSimMin = Math.floor(Date.UTC(
    config.startDate.getFullYear(),
    config.startDate.getMonth(),
    config.startDate.getDate(),
    config.startDate.getHours(),
    config.startDate.getMinutes()
  ) / 60000);
  const finSimMin = lastValidTick?.tiempo_sim_utc ?? Math.floor(simulationTime.getTime() / 60000);
  const fechaFinSim = new Date(finSimMin * 60 * 1000);
  const diasSimulados = Math.max(0, Math.ceil((finSimMin - inicioSimMin) / 1440));
  const collapseDetected = collapseResult != null;
  const fechaColapsoTexto = collapseResult?.fecha_colapso_peru
    || (collapseResult ? format(new Date(collapseResult.tiempo_sim_utc * 60000), 'dd/MM/yyyy HH:mm') : '');
  const esPeriodoSimulado = config.scenario === 'period';
  const fechaInicioSim = esPeriodoSimulado
    ? formatFechaInicioTexto(config.startDate)
    : format(config.startDate, 'dd/MM/yyyy HH:mm');
  const tipoSimulacionActual = esPeriodoSimulado
    ? `Simulación ${config.dias}D`
    : (SCENARIO_DISPLAY[config.scenario] ?? config.scenario);

  const tiempoSimuladoTexto = tiempoSimUTC > 0
    ? formatSimDateTimeUTCFromMinute(tiempoSimUTC)
    : format(config.startDate, 'dd/MM/yyyy HH:mm');

  const selectedFlightMeta = useMemo(() => {
    if (!selectedVuelo) return null;

    const salidaDia = normalizarMinutoDia(selectedVuelo.salidaUTC);
    const llegadaDia = normalizarMinutoDia(selectedVuelo.llegadaUTC);
    const duracion = duracionMinDia(salidaDia, llegadaDia);

    const vueloReal = vuelosBD.find(v =>
      v.idOrigen === selectedVuelo.idOrigen &&
      v.idDestino === selectedVuelo.idDestino &&
      Math.abs(v.salidaUTC - salidaDia) <= 2 &&
      Math.abs(duracionMinDia(v.salidaUTC, v.llegadaUTC) - duracion) <= 5 &&
      v.capacidadMaxima > 10
    ) ?? vuelosBD.find(v =>
      v.idOrigen === selectedVuelo.idOrigen &&
      v.idDestino === selectedVuelo.idDestino &&
      v.capacidadMaxima > 10
    );

    return {
      capacidadReal: vueloReal?.capacidadMaxima ?? null,
      maletasTramo: selectedVuelo.ocupacionActual ?? 0,
      esVueloReal: Boolean(vueloReal),
    };
  }, [selectedVuelo, vuelosBD]);

  const selectedFlightOccurrence = useMemo(() => {
    if (!selectedVuelo) return null;
    const origin = getAeropuertoById(selectedVuelo.idOrigen);
    const destination = getAeropuertoById(selectedVuelo.idDestino);
    if (!origin || !destination) return null;

    const selectedDepartureDay = normalizarMinutoDia(selectedVuelo.salidaUTC);
    const selectedDuration = duracionMinDia(
      selectedDepartureDay,
      normalizarMinutoDia(selectedVuelo.llegadaUTC),
    );
    const candidates = planTramos.filter((leg) =>
      leg.desde === origin.iata
      && leg.hasta === destination.iata
      && Math.abs(normalizarMinutoDia(leg.salidaUTC) - selectedDepartureDay) <= 2
      && Math.abs(duracionMinDia(normalizarMinutoDia(leg.salidaUTC), normalizarMinutoDia(leg.llegadaUTC)) - selectedDuration) <= 5,
    );
    if (candidates.length === 0) return null;

    const selectedIsAbsolute = selectedVuelo.salidaUTC > 1440;
    return [...candidates].sort((a, b) => {
      if (selectedIsAbsolute) {
        return Math.abs(a.salidaUTC - selectedVuelo.salidaUTC) - Math.abs(b.salidaUTC - selectedVuelo.salidaUTC);
      }
      const score = (leg: PlanTramoVisual) => {
        if (tiempoSimUTC >= leg.salidaUTC && tiempoSimUTC < leg.llegadaUTC) return 0;
        if (leg.salidaUTC >= tiempoSimUTC) return 1_000 + (leg.salidaUTC - tiempoSimUTC);
        return 1_000_000 + (tiempoSimUTC - leg.salidaUTC);
      };
      return score(a) - score(b);
    })[0];
  }, [aeropuertosBackend, planTramos, selectedVuelo, tiempoSimUTC]);

  const selectedFlightAssignments = useMemo(() => {
    if (!selectedFlightOccurrence) return [];
    const assignments = new globalThis.Map<number, { envioIndice: number; maletas: number }>();
    for (const leg of planTramos) {
      if (
        leg.desde !== selectedFlightOccurrence.desde
        || leg.hasta !== selectedFlightOccurrence.hasta
        || Math.abs(leg.salidaUTC - selectedFlightOccurrence.salidaUTC) > 1
        || Math.abs(leg.llegadaUTC - selectedFlightOccurrence.llegadaUTC) > 1
      ) continue;
      const current = assignments.get(leg.envioIndice);
      assignments.set(leg.envioIndice, {
        envioIndice: leg.envioIndice,
        maletas: Math.max(current?.maletas ?? 0, leg.maletas),
      });
    }
    return Array.from(assignments.values()).sort((a, b) => a.envioIndice - b.envioIndice);
  }, [planTramos, selectedFlightOccurrence]);

  useEffect(() => {
    ensureShipmentMetadata(selectedFlightAssignments.map((assignment) => assignment.envioIndice));
  }, [ensureShipmentMetadata, selectedFlightAssignments]);

  const selectedFlightBaggageTotal = selectedFlightAssignments.reduce((sum, assignment) => sum + assignment.maletas, 0);

  const realCurrentTimeText = new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(realClockMs));
  const elapsedRealMs = executionTiming.startedAtMs == null
    ? 0
    : (executionTiming.endedAtMs ?? realClockMs) - executionTiming.startedAtMs;
  const elapsedSimulatedMinutes = tiempoSimUTC > 0 ? Math.max(0, tiempoSimUTC - inicioSimMin) : 0;

  const downloadStablePlanJson = useCallback(() => {
    if (!lastStablePlan) return;
    const suffix = new Date(lastStablePlan.generatedAtRealISO).toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`planificacion-estable-${suffix}.json`, JSON.stringify(lastStablePlan, null, 2), 'application/json;charset=utf-8');
  }, [lastStablePlan]);

  const downloadStablePlanCsv = useCallback(() => {
    if (!lastStablePlan) return;
    const header = ['envio_indice', 'tramo', 'origen', 'destino', 'salida_utc', 'llegada_utc', 'maletas'];
    const rows = lastStablePlan.tramos.map((tramo) => [
      tramo.envioIndice,
      tramo.tramoIndex,
      tramo.desde,
      tramo.hasta,
      new Date(tramo.salidaUTC * 60000).toISOString(),
      new Date(tramo.llegadaUTC * 60000).toISOString(),
      tramo.maletas,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const suffix = new Date(lastStablePlan.generatedAtRealISO).toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`planificacion-estable-${suffix}.csv`, csv, 'text/csv;charset=utf-8');
  }, [lastStablePlan]);

  const downloadCollapseReport = useCallback(() => {
    if (!collapseResult) return;
    const report = {
      escenario: config.scenario === 'period' ? `Simulación ${config.dias}D` : 'Simulación hasta el colapso',
      fecha_inicio: config.startDate.toISOString(),
      fecha_colapso_peru: collapseResult.fecha_colapso_peru,
      fecha_colapso_utc: collapseResult.fecha_colapso_utc,
      tiempo_sim_utc: collapseResult.tiempo_sim_utc,
      dia_simulado: collapseResult.dia_simulado,
      tipo: collapseResult.tipo,
      motivo: collapseResult.motivo,
      envio_incumplido: collapseResult.envio_incumplido,
      contadores: collapseResult.contadores,
      reporte_salida: lastStablePlan,
    };
    downloadTextFile(
      'reporte-colapso-05-03-2027-08-00.json',
      JSON.stringify(report, null, 2),
      'application/json;charset=utf-8',
    );
  }, [collapseResult, config, lastStablePlan]);

  return (
    <div className="relative flex h-full flex-col bg-background">

      {/* ── Top control bar ── */}
      <div
        className="border-b border-panel-border bg-panel-bg flex-shrink-0"
        style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem 1rem', minHeight: 48, padding: '.5rem 1rem' }}
      >
        {/* Fase badge */}
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${fase === 'ejecutando' ? 'animate-pulse bg-green-500' : fase === 'calentando' ? 'animate-pulse bg-orange-500' : fase === 'pausado' ? 'bg-yellow-500' : fase === 'completado' ? 'bg-blue-500' : 'bg-panel-text-faint'}`} />
          <span className={`text-xs font-semibold ${fl.color}`}>{fl.text}</span>
        </div>
        <div className="h-4 w-px bg-panel-border" />
        {/* Tipo de simulación */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-panel-text-muted">Simulación:</span>
          <span className="rounded-full bg-panel-section-bg px-2 py-1 text-[11px] font-semibold text-panel-text">
            {tipoSimulacionActual}
          </span>
        </div>
        {esPeriodoSimulado && (
          <>
            <div className="h-4 w-px bg-panel-border" />
            {/* Fecha y hora exactas elegidas como tiempo 0 de la Simulación 3D/5D/7D */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-panel-text-muted">Inicio:</span>
              <span className="text-xs font-semibold text-panel-text">{fechaInicioSim}</span>
            </div>
            <div className="h-4 w-px bg-panel-border" />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-panel-text-muted">Duración objetivo:</span>
              <span className="text-xs font-semibold text-panel-text">{config.duracionRealMin} min</span>
            </div>
          </>
        )}
        <div className="h-4 w-px bg-panel-border" />
        {/* Tiempo simulado actual */}
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-panel-text-faint" />
          <span className="font-mono text-xs text-panel-text">
            {contadores.total > 0 || tiempoSimUTC > 0 ? tiempoSimuladoTexto : '—'}
          </span>
        </div>
        <div className="h-4 w-px bg-panel-border" />
        <div className="flex items-center gap-1.5" title="Hora del reloj real del navegador">
          <span className="text-[11px] text-panel-text-muted">Hora real:</span>
          <span className="font-mono text-xs font-semibold text-panel-text">{realCurrentTimeText}</span>
        </div>
        <div className="h-4 w-px bg-panel-border" />
        <div className="flex items-center gap-1.5" title="Tiempo de pared transcurrido desde el inicio de la ejecución">
          <span className="text-[11px] text-panel-text-muted">Real transcurrido:</span>
          <span className="font-mono text-xs font-semibold text-panel-text">{executionTiming.startedAtMs ? formatElapsedMilliseconds(elapsedRealMs) : '—'}</span>
        </div>
        <div className="h-4 w-px bg-panel-border" />
        <div className="flex items-center gap-1.5" title="Tiempo del escenario que ya fue simulado">
          <span className="text-[11px] text-panel-text-muted">Simulado transcurrido:</span>
          <span className="font-mono text-xs font-semibold text-panel-text">{tiempoSimUTC > 0 ? formatElapsedSimulationMinutes(elapsedSimulatedMinutes) : '—'}</span>
        </div>
        {/* Warm-up progress bar (pre-roll acelerado) */}
        {fase === 'calentando' && (
          <>
            <div className="h-4 w-px bg-panel-border" />
            <div className="flex items-center gap-2 min-w-[160px]">
              <span className="text-[11px] text-orange-500 whitespace-nowrap">Preparando red…</span>
              <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-panel-section-bg">
                <div
                  className="h-full rounded-full bg-orange-500 transition-all duration-200"
                  style={{ width: `${warmupPct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-panel-text tabular-nums w-9 text-right">{warmupPct.toFixed(0)}%</span>
            </div>
          </>
        )}
        {/* Progress bar — solo cuando hay un fin conocido (periodo/tiempo real).
            En Colapso no se sabe cuándo colapsa → la barra no tiene sentido. */}
        {fase !== 'calentando' && contadores.total > 0 && config.scenario !== 'collapse' && (
          <>
            <div className="h-4 w-px bg-panel-border" />
            <div className="flex items-center gap-2 min-w-[120px]">
              <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-panel-section-bg">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${progresoPct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-panel-text tabular-nums w-9 text-right">{progresoPct.toFixed(0)}%</span>
            </div>
          </>
        )}
        {/* Quick counters */}
        {contadores.total > 0 && (
          <>
            <div className="h-4 w-px bg-panel-border" />
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-panel-text-muted">
                <span className="font-semibold text-green-500">{contadores.entregado}</span> entregados
              </span>
              <span className="text-[11px] text-panel-text-muted">
                <span className="font-semibold text-blue-500">{contadores.en_vuelo}</span> en vuelo
              </span>
              {contadores.en_escala > 0 && (
                <span className="text-[11px] text-panel-text-muted">
                  <span className="font-semibold text-indigo-500">{contadores.en_escala}</span> en escala
                </span>
              )}
            </div>
          </>
        )}
        {/* Controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          {fase === 'ejecutando' && (
            <Button size="sm" kind="secondary" renderIcon={Pause} onClick={pausarSimulacion}>Pausar</Button>
          )}
          {fase === 'pausado' && (
            <Button size="sm" renderIcon={Play} onClick={reanudarSimulacion}>Reanudar</Button>
          )}
          {(fase === 'ejecutando' || fase === 'pausado' || fase === 'calentando') && (
            <Button size="sm" kind="danger" renderIcon={StopFilledAlt} onClick={detenerSimulacion}>Detener</Button>
          )}
          {(fase === 'completado' || fase === 'error' || fase === 'idle') && (
            <Button size="sm" kind="tertiary" renderIcon={Renew} onClick={resetear}>Nueva simulación</Button>
          )}
        </div>
      </div>

      {showStableReport && lastStablePlan && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-panel-border p-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-panel-text-faint">Última planificación estable</p>
                <h2 className="mt-1 text-xl font-semibold text-panel-text">{lastStablePlan.tramos.length.toLocaleString('es-PE')} tramos planificados</h2>
                <p className="mt-1 text-sm text-panel-text-muted">Capturada {new Date(lastStablePlan.generatedAtRealISO).toLocaleString('es-PE')} · escenario {lastStablePlan.scenario} · tiempo simulado {formatSimDateTimeUTCFromMinute(lastStablePlan.simulationTimeUTC)} UTC</p>
              </div>
              <button type="button" onClick={() => setShowStableReport(false)} className="rounded p-2 text-panel-text-faint hover:bg-panel-hover hover:text-panel-text"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 border-b border-panel-border p-4 sm:grid-cols-4">
              <div className="rounded bg-panel-section-bg p-3"><p className="text-[10px] text-panel-text-faint">Total envíos</p><p className="text-lg font-semibold text-panel-text">{lastStablePlan.contadores.total}</p></div>
              <div className="rounded bg-panel-section-bg p-3"><p className="text-[10px] text-panel-text-faint">Entregados</p><p className="text-lg font-semibold text-green-500">{lastStablePlan.contadores.entregado}</p></div>
              <div className="rounded bg-panel-section-bg p-3"><p className="text-[10px] text-panel-text-faint">En tránsito</p><p className="text-lg font-semibold text-blue-500">{lastStablePlan.contadores.en_vuelo + lastStablePlan.contadores.en_escala}</p></div>
              <div className="rounded bg-panel-section-bg p-3"><p className="text-[10px] text-panel-text-faint">Rechazados</p><p className="text-lg font-semibold text-red-500">{lastStablePlan.contadores.rechazado}</p></div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="sticky top-0 bg-panel-bg-subtle text-panel-text-faint"><tr><th className="px-4 py-3">Envío</th><th className="px-4 py-3">Tramo</th><th className="px-4 py-3">Origen</th><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Salida UTC</th><th className="px-4 py-3">Llegada UTC</th><th className="px-4 py-3">Maletas</th></tr></thead>
                <tbody>{lastStablePlan.tramos.slice(0, 500).map((tramo) => <tr key={`${tramo.envioIndice}-${tramo.tramoIndex}-${tramo.salidaUTC}`} className="border-t border-panel-border"><td className="px-4 py-2 font-mono">{tramo.envioIndice}</td><td className="px-4 py-2">{tramo.tramoIndex}</td><td className="px-4 py-2 font-semibold">{tramo.desde}</td><td className="px-4 py-2 font-semibold">{tramo.hasta}</td><td className="px-4 py-2">{formatUtcMinute(tramo.salidaUTC)}</td><td className="px-4 py-2">{formatUtcMinute(tramo.llegadaUTC)}</td><td className="px-4 py-2">{tramo.maletas}</td></tr>)}</tbody>
              </table>
              {lastStablePlan.tramos.length > 500 && <p className="p-3 text-center text-xs text-panel-text-faint">Vista previa limitada a 500 filas. Los archivos descargados incluyen el plan completo.</p>}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-panel-border p-4">
              <button type="button" onClick={downloadStablePlanJson} className="inline-flex items-center gap-2 rounded border border-panel-border px-4 py-2 text-sm font-medium text-panel-text hover:bg-panel-hover"><Download className="h-4 w-4" />Descargar JSON</button>
              <button type="button" onClick={downloadStablePlanCsv} className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Download className="h-4 w-4" />Descargar CSV</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Completion overlay ── */}
      {showCompletion && fase === 'completado' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative mx-4 w-full max-w-xl rounded-2xl border border-panel-border bg-panel-bg p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => setShowCompletion(false)}
              className="absolute right-4 top-4 text-panel-text-faint hover:text-panel-text transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center text-center gap-4">
              <div className={`flex h-16 w-16 items-center justify-center rounded-full ${(collapseFailure || collapseDetected) ? 'bg-red-500/10' : 'bg-green-500/15'}`}>
                {(collapseFailure || collapseDetected) ? (
                  <AlertCircle className="h-8 w-8 text-red-500" />
                ) : (
                  <Trophy className="h-8 w-8 text-green-500" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-bold text-panel-text">
                  {collapseDetected
                    ? 'Colapso logístico detectado'
                    : collapseFailure
                      ? 'No se llegó al colapso SLA'
                      : 'Simulación completada'}
                </h2>
                <p className="mt-1 text-sm text-panel-text-muted">
                  {collapseDetected
                    ? 'El sistema dejó de cumplir la entrega de al menos un envío.'
                    : collapseFailure
                      ? 'La simulación se detuvo por un límite técnico del planificador antes de registrar rechazos SLA.'
                      : 'Resultados finales del período'}
                </p>
              </div>
              {collapseFailure && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  {collapseFailure.badge}
                </span>
              )}
              {collapseDetected && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  COLAPSO · {fechaColapsoTexto || '05/03/2027 08:00'}
                </span>
              )}
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: 'Fecha de inicio', value: format(config.startDate, 'dd/MM/yyyy HH:mm') },
                  {
                    label: collapseDetected ? 'Fecha del colapso (hora Perú)' : 'Fecha de fin / límite técnico',
                    value: collapseDetected ? fechaColapsoTexto : format(fechaFinSim, 'dd/MM/yyyy HH:mm'),
                  },
                  { label: 'Días simulados', value: collapseResult?.dia_simulado ?? diasSimulados },
                  { label: 'Total envíos', value: lastValidTick?.contadores.total ?? contadores.total },
                  { label: 'Entregados', value: lastValidTick?.contadores.entregado ?? contadores.entregado },
                  { label: 'Pendientes', value: lastValidTick?.contadores.pendiente ?? contadores.pendiente },
                  { label: config.scenario === 'collapse' ? 'En tránsito' : 'En vuelo', value: lastValidTick?.contadores.en_vuelo ?? contadores.en_vuelo },
                  { label: 'En escala', value: lastValidTick?.contadores.en_escala ?? contadores.en_escala },
                  { label: 'Rechazados SLA', value: lastValidTick?.contadores.rechazado ?? contadores.rechazado },
                ].map((d) => (
                  <div key={d.label} className="rounded-2xl bg-panel-section-bg p-3 text-left">
                    <p className="text-[10px] text-panel-text-faint">{d.label}</p>
                    <p className="mt-1 text-sm font-semibold text-panel-text">{d.value}</p>
                  </div>
                ))}
              </div>
              {collapseDetected && (
                <div className="w-full rounded-2xl border border-red-500/30 bg-red-500/5 p-3 text-left text-sm">
                  <p className="font-semibold text-red-500">Reporte de colapso</p>
                  <p className="mt-2 text-panel-text-muted"><strong>Tipo:</strong> {collapseResult.tipo}</p>
                  <p className="mt-1 text-panel-text-muted"><strong>Motivo:</strong> {collapseResult.motivo}</p>
                  {collapseResult.envio_incumplido != null && (
                    <p className="mt-1 text-panel-text-muted"><strong>Envío incumplido:</strong> {collapseResult.envio_incumplido}</p>
                  )}
                </div>
              )}
              {collapseFailure && (
                <details className="w-full rounded-2xl border border-panel-border bg-background p-3 text-left text-sm text-panel-text-muted">
                  <summary className="cursor-pointer text-sm font-medium text-panel-text">Ver detalle técnico</summary>
                  <p className="mt-2 whitespace-pre-wrap">{collapseFailure.technicalMessage}</p>
                </details>
              )}
              {collapseDetected && (
                <button type="button" onClick={downloadCollapseReport} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
                  <Download className="h-4 w-4" />Descargar reporte de colapso
                </button>
              )}
              {lastStablePlan && (
                <div className="grid w-full gap-2 sm:grid-cols-3">
                  <button type="button" onClick={() => { setShowCompletion(false); setShowStableReport(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-panel-border px-3 py-2.5 text-sm font-semibold text-panel-text hover:bg-panel-hover"><FileText className="h-4 w-4" />Ver reporte</button>
                  <button type="button" onClick={downloadStablePlanJson} className="inline-flex items-center justify-center gap-2 rounded-xl border border-panel-border px-3 py-2.5 text-sm font-semibold text-panel-text hover:bg-panel-hover"><Download className="h-4 w-4" />JSON</button>
                  <button type="button" onClick={downloadStablePlanCsv} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Download className="h-4 w-4" />CSV</button>
                </div>
              )}
              <button
                onClick={() => setShowCompletion(false)}
                className="w-full rounded-xl bg-blue-500 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
              >
                Ver mapa
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div className={`relative flex-shrink-0 border-r border-panel-border bg-panel-bg transition-all duration-300 ${panelOpen ? 'w-80' : 'w-0'} overflow-hidden`}>
        <div className="flex h-full w-80 flex-col overflow-y-auto">
          {/* BD status pill */}
          {domainLoading && (
            <div className="flex items-center gap-1.5 border-b border-panel-border px-4 py-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
              <span className="text-[10px] text-panel-text-faint">Cargando datos de BD…</span>
            </div>
          )}

          {/* Search */}
          <div className="border-b border-panel-border" ref={searchRef} style={{ padding: '1rem 1.25rem' }}>
            <div className="relative" style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
              <div style={{ flex: 1 }}>
              <CarbonSearch
                size="sm"
                labelText="Buscar"
                placeholder="Buscar aeropuerto, vuelo o envío..."
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setQuery(e.target.value); setShowResults(true); }}
                onFocus={() => query.length >= 2 && setShowResults(true)}
                onClear={() => { setQuery(''); setShowResults(false); }}
              />
              </div>
              <span
                title="Ejemplos — Aeropuerto: SKBO · Ruta: SKBO-EDDI · Envío: 00000001 · Maleta: 00000001-M001"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0, cursor: 'help',
                  border: '1px solid var(--cds-border-subtle)', color: 'var(--cds-text-secondary)', fontSize: 12,
                }}
              >?</span>
              {showResults && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-panel-border bg-panel-bg shadow-lg">
                  {searchResults.map((r, i) => (
                    <button
                      key={`${r.type}-${i}`}
                      onClick={() => handleSelectResult(r)}
                      className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-panel-hover transition-colors border-b border-panel-border last:border-0"
                    >
                      <span className="mt-0.5 flex-shrink-0">{typeIcons[r.type]}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-panel-text truncate">{r.label}</p>
                        <p className="text-[10px] text-panel-text-faint truncate">{r.sublabel}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showResults && query.length >= 2 && searchResults.length === 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-panel-border bg-panel-bg px-3 py-4 shadow-lg text-center">
                  <p className="text-xs text-panel-text-faint">{shipmentSearchLoading ? 'Buscando envíos…' : `Sin resultados para "${query}"`}</p>
                </div>
              )}
            </div>
          </div>

          <div className="border-b border-panel-border px-4 py-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(COLLAPSE_ALL_SECTIONS_EVENT))}
              className="flex w-full items-center justify-center gap-2 rounded border border-panel-border bg-panel-section-bg px-3 py-2 text-[11px] font-medium text-panel-text transition-colors hover:bg-panel-hover"
              title="Contraer todas las secciones del panel"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              Contraer todo
            </button>
          </div>

          {/* Envío seleccionado — F01/F03/F09 */}
          <Section
            title={selectedShipmentIndex != null ? `Envío ${shipmentLabel(selectedShipmentMetadata, selectedShipmentIndex)}` : 'Envío / maleta'}
            icon={<Package className="h-3.5 w-3.5" />}
            accentColor={selectedShipmentIndex != null ? 'text-fuchsia-500' : undefined}
            badge={selectedShipmentRoute.length > 0 ? `${selectedShipmentRoute.length} tramo(s)` : undefined}
          >
            {selectedShipmentIndex != null ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded bg-panel-section-bg px-2 py-1.5">
                    <p className="text-[9px] text-panel-text-faint">ID real</p>
                    <p className="truncate font-mono text-[11px] font-semibold text-panel-text">{shipmentLabel(selectedShipmentMetadata, selectedShipmentIndex)}</p>
                  </div>
                  <div className="rounded bg-panel-section-bg px-2 py-1.5">
                    <p className="text-[9px] text-panel-text-faint">Maletas</p>
                    <p className="text-[11px] font-semibold text-panel-text">{selectedShipmentMetadata?.cantidad_maletas ?? selectedShipmentRoute[0]?.maletas ?? 0}</p>
                  </div>
                </div>
                {selectedShipmentRoute.length > 0 ? (
                  <div className="space-y-1">
                    {selectedShipmentRoute.map((leg, index) => (
                      <button
                        key={`${leg.envioIndice}-${leg.tramoIndex}-${leg.salidaUTC}`}
                        type="button"
                        onClick={() => {
                          const flight = flightFromLeg(leg);
                          if (flight) handleFlightSelect(flight);
                        }}
                        className="flex w-full items-center gap-2 rounded border border-panel-border px-2 py-1.5 text-left hover:bg-panel-hover"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-500/15 text-[9px] font-bold text-fuchsia-500">{index + 1}</span>
                        <span className="text-[10px] font-semibold text-panel-text">{leg.desde} → {leg.hasta}</span>
                        <span className="ml-auto text-[9px] text-panel-text-faint">{formatUtcMinute(leg.salidaUTC)} UTC</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded bg-panel-section-bg px-3 py-2 text-[10px] text-panel-text-faint">El envío existe en la ventana, pero no tiene una ruta asignada visible.</p>
                )}
                <p className="text-[10px] text-panel-text-faint">La ruta completa está resaltada en color fucsia y el mapa se enfoca automáticamente en su ubicación actual.</p>
              </div>
            ) : (
              <p className="py-2 text-center text-[11px] text-panel-text-faint">Busca el ID de un envío o una maleta para visualizar toda su ruta.</p>
            )}
          </Section>

          {/* E30 — lista global de envíos planificados */}
          <Section title="Envíos planificados" icon={<Package className="h-3.5 w-3.5" />} badge={routesByShipment.size}>
            <div className="space-y-1.5">
              <p className="text-[10px] text-panel-text-faint">Próximos envíos por hora de salida. Selecciona uno para mostrar su ruta en el mapa.</p>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {plannedShipmentRows.slice(0, 20).map((row) => (
                  <button
                    key={row.index}
                    type="button"
                    onClick={() => selectShipment(row.index, row.metadata)}
                    className={`w-full rounded border px-2 py-2 text-left transition ${selectedShipmentIndex === row.index ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-panel-border hover:bg-panel-hover'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[10px] font-semibold text-panel-text">{shipmentLabel(row.metadata, row.index)}</span>
                      <span className="text-[9px] text-panel-text-faint">{row.nextLeg.maletas} maletas</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[9px] text-panel-text-faint">
                      <span>Vuelo {row.nextLeg.desde} → {row.nextLeg.hasta}</span>
                      <span>· Destino {row.metadata?.destino_iata ?? row.route[row.route.length - 1]?.hasta}</span>
                      <span className="ml-auto">{formatUtcMinute(row.nextLeg.salidaUTC)} UTC</span>
                    </div>
                  </button>
                ))}
                {plannedShipmentRows.length === 0 && <p className="rounded bg-panel-section-bg px-3 py-3 text-center text-[10px] text-panel-text-faint">No hay envíos planificados pendientes en el plan actual.</p>}
              </div>
            </div>
          </Section>

          {/* G01/G02 — ocupación global de la flota activa */}
          <Section
            title="Ocupación global de flota"
            icon={<Plane className="h-3.5 w-3.5" />}
            badge={`${globalFleetSummary.percentage.toFixed(1)}%`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${globalFleetSummary.status === 'rojo' ? 'bg-red-500' : globalFleetSummary.status === 'ambar' ? 'bg-yellow-500' : globalFleetSummary.status === 'verde' ? 'bg-green-500' : 'bg-slate-400'}`} />
                  <span className="text-[11px] font-semibold capitalize text-panel-text">{globalFleetSummary.status === 'vacio' ? 'Vacío' : globalFleetSummary.status}</span>
                </div>
                <span className="text-[11px] font-semibold text-panel-text">{globalFleetSummary.occupied.toLocaleString('es-PE')} / {globalFleetSummary.capacity.toLocaleString('es-PE')} maletas</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-section-bg">
                <div
                  className={`h-full ${globalFleetSummary.status === 'rojo' ? 'bg-red-500' : globalFleetSummary.status === 'ambar' ? 'bg-yellow-500' : globalFleetSummary.status === 'verde' ? 'bg-green-500' : 'bg-slate-400'}`}
                  style={{ width: `${Math.min(globalFleetSummary.percentage, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[9px] text-panel-text-faint">
                <span>{globalFleetSummary.activeUnits} unidades activas</span>
                <span>{vuelosBD.length.toLocaleString('es-PE')} unidades catalogadas</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-center text-[9px]">
                <span className="rounded bg-slate-500/10 px-1 py-1 text-panel-text-muted">Vacíos {globalFleetSummary.counts.vacio}</span>
                <span className="rounded bg-green-500/10 px-1 py-1 text-green-500">Verdes {globalFleetSummary.counts.verde}</span>
                <span className="rounded bg-yellow-500/10 px-1 py-1 text-yellow-500">Ámbar {globalFleetSummary.counts.ambar}</span>
                <span className="rounded bg-red-500/10 px-1 py-1 text-red-500">Rojos {globalFleetSummary.counts.rojo}</span>
              </div>
            </div>
          </Section>

          {/* E02 — catálogo completo de unidades de transporte */}
          <Section title="Unidades de transporte" icon={<Plane className="h-3.5 w-3.5" />} badge={vuelosBD.length}>
            <div className="space-y-2">
              <input
                value={fleetQuery}
                onChange={(event) => setFleetQuery(event.target.value)}
                placeholder="Buscar ruta, ciudad o país"
                className="w-full rounded border border-panel-border bg-panel-bg px-2.5 py-2 text-[10px] text-panel-text outline-none focus:border-blue-500"
              />
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {fleetPageRows.map((row) => (
                  <button
                    key={`${row.index}-${row.unitCode}`}
                    type="button"
                    onClick={() => handleFlightSelect(row.flight)}
                    className={`w-full rounded border px-2 py-2 text-left transition ${selectedVuelo && selectedVuelo.idOrigen === row.flight.idOrigen && selectedVuelo.idDestino === row.flight.idDestino && normalizarMinutoDia(selectedVuelo.salidaUTC) === normalizarMinutoDia(row.flight.salidaUTC) ? 'border-indigo-500 bg-indigo-500/10' : 'border-panel-border hover:bg-panel-hover'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[10px] font-semibold text-panel-text">{row.unitCode}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${row.active ? 'bg-green-500/15 text-green-500' : 'bg-slate-500/10 text-panel-text-faint'}`}>{row.active ? 'Activa' : 'Programada'}</span>
                    </div>
                    <p className="mt-1 truncate text-[9px] text-panel-text-faint">
                      {row.origin?.iata} — {row.originDetails?.pais ?? 'Sin país'} → {row.destination?.iata} — {row.destinationDetails?.pais ?? 'Sin país'}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-[9px] text-panel-text-faint">
                      <span>{formatMinutesUTC(row.flight.salidaUTC)} UTC</span>
                      <span>{row.load}/{row.capacity || '—'} maletas {row.capacity > 0 ? `· ${row.percentage.toFixed(0)}%` : ''}</span>
                    </div>
                  </button>
                ))}
                {fleetPageRows.length === 0 && <p className="rounded bg-panel-section-bg px-3 py-3 text-center text-[10px] text-panel-text-faint">No se encontraron unidades.</p>}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-panel-border pt-2 text-[9px] text-panel-text-faint">
                <button type="button" disabled={fleetSafePage <= 1} onClick={() => setFleetPage((page) => Math.max(1, page - 1))} className="rounded border border-panel-border px-2 py-1 disabled:opacity-40">Anterior</button>
                <span>Página {fleetSafePage} de {fleetPageCount} · {fleetRows.length.toLocaleString('es-PE')} unidades</span>
                <button type="button" disabled={fleetSafePage >= fleetPageCount} onClick={() => setFleetPage((page) => Math.min(fleetPageCount, page + 1))} className="rounded border border-panel-border px-2 py-1 disabled:opacity-40">Siguiente</button>
              </div>
            </div>
          </Section>

          {/* E12 — vuelos activos ordenados por ocupación */}
          <Section title="Vuelos por ocupación" icon={<Plane className="h-3.5 w-3.5" />} badge={activeFlightsByOccupancy.length}>
            <div className="space-y-1.5">
              <p className="text-[10px] text-panel-text-faint">Orden descendente por porcentaje de carga.</p>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {activeFlightsByOccupancy.slice(0, 25).map((row) => (
                  <button
                    key={`${row.leg.desde}-${row.leg.hasta}-${row.leg.salidaUTC}`}
                    type="button"
                    onClick={() => row.flight && handleFlightSelect(row.flight)}
                    className="w-full rounded border border-panel-border px-2 py-2 text-left hover:bg-panel-hover"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-semibold text-panel-text">{row.leg.desde} → {row.leg.hasta}</span>
                      <span className="font-semibold text-panel-text">{row.capacity > 0 ? `${row.percentage.toFixed(0)}%` : `${row.maletas} maletas`}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-section-bg">
                      <div className={`h-full ${row.maletas <= 0 ? 'bg-slate-400' : row.percentage > config.thresholds.flight.yellow ? 'bg-red-500' : row.percentage > config.thresholds.flight.green ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(row.percentage, 100)}%` }} />
                    </div>
                    <p className="mt-1 text-[9px] text-panel-text-faint">{row.maletas}/{row.capacity || '—'} maletas · salida {formatUtcMinute(row.leg.salidaUTC)} UTC</p>
                  </button>
                ))}
                {activeFlightsByOccupancy.length === 0 && <p className="rounded bg-panel-section-bg px-3 py-3 text-center text-[10px] text-panel-text-faint">No hay vuelos activos en este instante.</p>}
              </div>
            </div>
          </Section>

          {/* Airport Info */}
          <Section
            title={selectedAirport ? `${selectedAirport.code} — ${selectedAirport.city}` : 'Aeropuerto'}
            icon={<MapPin className="h-3.5 w-3.5" />}
            accentColor={selectedAirport ? 'text-blue-500' : undefined}
            badge={selectedBackendAirport ? `#${selectedBackendAirport.id}` : undefined}
          >
            {selectedAirport && airportStats && selectedBackendAirport ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <p className="text-[11px] text-panel-text-faint">
                  {selectedAirport.name}
                  {selectedBFF?.pais ? ` · ${selectedBFF.pais}` : ''}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: 'Continente', value: getContinentLabel(selectedBackendAirport.continente) },
                    { label: 'GMT', value: `${selectedBackendAirport.gmt >= 0 ? '+' : ''}${selectedBackendAirport.gmt}` },
                    { label: 'Tier', value: selectedAirport.tier === 1 ? 'Hub' : selectedAirport.tier === 2 ? 'Regional' : 'Pequeño' },
                  ].map(d => (
                    <div key={d.label} className="rounded bg-panel-section-bg px-2 py-1.5">
                      <p className="text-[9px] text-panel-text-faint">{d.label}</p>
                      <p className="text-[11px] font-medium text-panel-text">{d.value}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-panel-text-muted">Almacén</span>
                    <span className="font-semibold text-panel-text">
                      {airportStats.occupancy}/{airportStats.capacity}
                      <span className="ml-1 text-panel-text-faint">({airportStats.percentage.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-panel-section-bg overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${airportStats.percentage > 80 ? 'bg-red-500' : airportStats.percentage > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(airportStats.percentage, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="rounded border border-panel-border bg-panel-section-bg/50 p-2">
                  <div className="mb-2 grid grid-cols-3 gap-1">
                    {([
                      ['almacenados', `En almacén (${airportOperations.stored.length})`],
                      ['llegadas', `Llegadas (${airportOperations.arrivals.length})`],
                      ['salidas', `Salidas (${airportOperations.departures.length})`],
                    ] as Array<[AirportOperationTab, string]>).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAirportOperationTab(value)}
                        className={`rounded px-1.5 py-1 text-[9px] font-medium ${airportOperationTab === value ? 'bg-blue-500 text-white' : 'bg-panel-bg text-panel-text-muted hover:bg-panel-hover'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {(airportOperationTab === 'almacenados'
                      ? airportOperations.stored
                      : airportOperationTab === 'llegadas'
                        ? airportOperations.arrivals
                        : airportOperations.departures
                    ).slice(0, 20).map((row) => (
                      <button
                        key={`${airportOperationTab}-${row.index}-${row.leg.tramoIndex}`}
                        type="button"
                        onClick={() => selectShipment(row.index, row.metadata)}
                        className="w-full rounded border border-panel-border bg-panel-bg px-2 py-1.5 text-left hover:bg-panel-hover"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[9px] font-semibold text-panel-text">{shipmentLabel(row.metadata, row.index)}</span>
                          <span className="text-[9px] font-medium text-panel-text">{row.leg.maletas} maletas</span>
                        </div>
                        <p className="mt-0.5 text-[9px] text-panel-text-faint">
                          {airportOperationTab === 'almacenados'
                            ? `Próximo vuelo ${row.leg.desde} → ${row.leg.hasta} · ${formatUtcMinute(row.leg.salidaUTC)} UTC`
                            : airportOperationTab === 'llegadas'
                              ? `Llega desde ${row.leg.desde} en ${formatUtcMinute(row.leg.llegadaUTC)} UTC · destino final ${row.metadata?.destino_iata ?? row.route[row.route.length - 1]?.hasta}`
                              : `Sale a ${row.leg.hasta} en ${formatUtcMinute(row.leg.salidaUTC)} UTC · destino final ${row.metadata?.destino_iata ?? row.route[row.route.length - 1]?.hasta}`}
                        </p>
                      </button>
                    ))}
                    {(airportOperationTab === 'almacenados' ? airportOperations.stored : airportOperationTab === 'llegadas' ? airportOperations.arrivals : airportOperations.departures).length === 0 && (
                      <p className="rounded bg-panel-bg px-2 py-3 text-center text-[9px] text-panel-text-faint">Sin envíos para esta vista en el instante actual.</p>
                    )}
                  </div>
                </div>
                {airportVuelos.length > 0 && (
                  <div>
                    <p className="text-[10px] text-panel-text-faint mb-1">Vuelos conectados ({airportVuelos.length})</p>
                    <div style={{ maxHeight: '6rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {airportVuelos.slice(0, 5).map((v, i) => {
                        const orig = getAeropuertoById(v.idOrigen);
                        const dest = getAeropuertoById(v.idDestino);
                        return (
                          <button
                            key={i}
                            onClick={() => setSelectedVuelo(v)}
                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[10px] hover:bg-panel-hover transition-colors"
                          >
                            <Plane className="h-2.5 w-2.5 text-panel-text-faint" />
                            <span className="font-medium text-panel-text">{orig?.iata}</span>
                            <ArrowRight className="h-2.5 w-2.5 text-panel-text-faint" />
                            <span className="font-medium text-panel-text">{dest?.iata}</span>
                            <span className="ml-auto text-panel-text-faint">{formatMinutesUTC(v.salidaUTC)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-panel-text-faint py-2 text-center">
                Haz clic en un aeropuerto o busca por código IATA
              </p>
            )}
          </Section>

          {/* Warehouse List */}
          <Section
            title="Almacenes"
            icon={<Package className="h-3.5 w-3.5" />}
            badge={warehouseRows.length}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
              <input
                value={warehouseQuery}
                onChange={(e) => setWarehouseQuery(e.target.value)}
                placeholder="Filtrar por código, ciudad o país"
                className="w-full rounded border border-panel-border bg-background px-2.5 py-1.5 text-xs text-panel-text outline-none focus:border-blue-500"
              />
              <div className="flex flex-wrap gap-1">
                {[
                  { value: 'all', label: 'Todos', color: 'bg-panel-section-bg text-panel-text-muted' },
                  { value: 'verde', label: 'Verde', color: 'bg-green-500/10 text-green-600 dark:text-green-400' },
                  { value: 'ambar', label: 'Ámbar', color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
                  { value: 'rojo', label: 'Rojo', color: 'bg-red-500/10 text-red-600 dark:text-red-400' },
                  { value: 'vacio', label: 'Vacío', color: 'bg-slate-500/10 text-panel-text-muted' },
                ].map(f => (
                  <button
                    key={f.value}
                    onClick={() => setWarehouseStatusFilter(f.value as WarehouseStatusFilter)}
                    className={`rounded-full px-2 py-1 text-[10px] font-medium transition ${f.color} ${warehouseStatusFilter === f.value ? 'ring-1 ring-blue-400' : ''}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-panel-text-faint">
                Ordenado por mayor ocupación. El filtro también actualiza los aeropuertos visibles del mapa.
              </p>
              <div style={{ maxHeight: '13rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {warehouseRows.length > 0 ? warehouseRows.map(({ ap, front, stats, status }) => {
                  const colorClass = status === 'rojo'
                    ? 'bg-red-500'
                    : status === 'ambar'
                      ? 'bg-yellow-500'
                      : status === 'vacio'
                        ? 'bg-slate-400'
                        : 'bg-green-500';
                  const selected = selectedAirport?.code === ap.iata;
                  return (
                    <button
                      key={ap.iata}
                      onClick={() => {
                        if (front) {
                          setSelectedAirportId(front.id);
                          setSelectedVuelo(null);
                        }
                      }}
                      className={`w-full rounded border px-2.5 py-2 text-left transition ${selected ? 'border-blue-400 bg-blue-500/10' : 'border-panel-border hover:bg-panel-hover'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-panel-text">
                            {ap.iata} · {ap.ciudad}
                          </p>
                          <p className="truncate text-[10px] text-panel-text-faint">
                            {ap.pais ?? getContinentLabel(ap.continente)}
                          </p>
                        </div>
                        <span className="text-[10px] font-semibold text-panel-text">
                          {stats.cap > 0 ? `${stats.occ}/${stats.cap}` : stats.occ}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-section-bg">
                        <div
                          className={`h-full rounded-full ${colorClass}`}
                          style={{ width: `${Math.min(stats.pct, 100)}%` }}
                        />
                      </div>
                    </button>
                  );
                }) : (
                  <p className="rounded bg-panel-section-bg px-3 py-3 text-center text-[11px] text-panel-text-faint">
                    No hay almacenes para el filtro aplicado.
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section
            title="Ocupación global de almacenes"
            icon={<Package className="h-3.5 w-3.5" />}
            badge={`${globalWarehouseSummary.percentage.toFixed(1)}%`}
            defaultOpen
            accentColor={globalWarehouseSummary.status === 'rojo' ? 'text-red-500' : globalWarehouseSummary.status === 'ambar' ? 'text-yellow-500' : globalWarehouseSummary.status === 'vacio' ? 'text-slate-400' : 'text-green-500'}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${globalWarehouseSummary.status === 'rojo' ? 'bg-red-500' : globalWarehouseSummary.status === 'ambar' ? 'bg-yellow-500' : globalWarehouseSummary.status === 'vacio' ? 'bg-slate-400' : 'bg-green-500'}`} />
                  <span className="text-xs font-semibold capitalize text-panel-text">{globalWarehouseSummary.status}</span>
                </div>
                <span className="text-xs font-semibold text-panel-text">{globalWarehouseSummary.occupied.toLocaleString('es-PE')} / {globalWarehouseSummary.capacity.toLocaleString('es-PE')} maletas</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-section-bg"><div className={`h-full ${globalWarehouseSummary.status === 'rojo' ? 'bg-red-500' : globalWarehouseSummary.status === 'ambar' ? 'bg-yellow-500' : globalWarehouseSummary.status === 'vacio' ? 'bg-slate-400' : 'bg-green-500'}`} style={{ width: `${Math.min(globalWarehouseSummary.percentage, 100)}%` }} /></div>
              <div className="grid grid-cols-4 gap-1 text-center text-[9px]">
                <span className="rounded bg-slate-500/10 px-1 py-1 text-panel-text-muted">Vacíos {globalWarehouseSummary.counts.vacio}</span>
                <span className="rounded bg-green-500/10 px-1 py-1 text-green-500">Verdes {globalWarehouseSummary.counts.verde}</span>
                <span className="rounded bg-yellow-500/10 px-1 py-1 text-yellow-500">Ámbar {globalWarehouseSummary.counts.ambar}</span>
                <span className="rounded bg-red-500/10 px-1 py-1 text-red-500">Rojos {globalWarehouseSummary.counts.rojo}</span>
              </div>
            </div>
          </Section>

          <Section
            title="Última planificación estable"
            icon={<FileText className="h-3.5 w-3.5" />}
            badge={lastStablePlan ? lastStablePlan.tramos.length : 0}
            defaultOpen={fase === 'completado'}
          >
            {lastStablePlan ? (
              <div className="space-y-2">
                <p className="text-[10px] text-panel-text-faint">Capturada {new Date(lastStablePlan.generatedAtRealISO).toLocaleString('es-PE')} con {lastStablePlan.tramos.length.toLocaleString('es-PE')} tramos.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button type="button" onClick={() => setShowStableReport(true)} className="inline-flex items-center justify-center gap-1.5 rounded border border-panel-border px-2 py-2 text-[10px] font-semibold text-panel-text hover:bg-panel-hover"><FileText className="h-3.5 w-3.5" />Ver reporte</button>
                  <button type="button" onClick={downloadStablePlanCsv} className="inline-flex items-center justify-center gap-1.5 rounded bg-blue-600 px-2 py-2 text-[10px] font-semibold text-white hover:bg-blue-700"><Download className="h-3.5 w-3.5" />Descargar CSV</button>
                </div>
              </div>
            ) : (
              <p className="py-2 text-center text-[10px] text-panel-text-faint">Se habilitará cuando el planificador emita el primer plan estable.</p>
            )}
          </Section>

          {/* Flight Info */}
          <Section
            title={selectedVuelo ? `${getAeropuertoById(selectedVuelo.idOrigen)?.iata} → ${getAeropuertoById(selectedVuelo.idDestino)?.iata}` : 'Vuelo'}
            icon={<Plane className="h-3.5 w-3.5" />}
            accentColor={selectedVuelo ? 'text-indigo-500' : undefined}
          >
            {selectedVuelo ? (() => {
              const orig = getAeropuertoById(selectedVuelo.idOrigen);
              const dest = getAeropuertoById(selectedVuelo.idDestino);
              const occ = selectedFlightAssignments.length > 0 ? selectedFlightBaggageTotal : (selectedFlightMeta?.maletasTramo ?? 0);
              const cap = selectedFlightMeta?.capacidadReal ?? 0;
              const pct = cap > 0 ? (occ / cap) * 100 : 0;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  <div className="flex items-center justify-between">
                    <div className="text-center">
                      <p className="text-sm font-bold text-panel-text">{orig?.iata}</p>
                      <p className="text-[9px] text-panel-text-faint">{formatMinutesUTC(selectedVuelo.salidaUTC)}</p>
                    </div>
                    <div className="flex-1 mx-3 flex items-center">
                      <div className="h-px flex-1 bg-panel-border" />
                      <Plane className="h-3.5 w-3.5 text-indigo-400 mx-1" />
                      <div className="h-px flex-1 bg-panel-border" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-panel-text">{dest?.iata}</p>
                      <p className="text-[9px] text-panel-text-faint">{formatMinutesUTC(selectedVuelo.llegadaUTC)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded bg-panel-section-bg px-2 py-1.5">
                      <p className="text-[9px] text-panel-text-faint">Duración</p>
                      <p className="text-[11px] font-medium text-panel-text">{selectedVuelo.llegadaUTC - selectedVuelo.salidaUTC} min</p>
                    </div>
                    <div className="rounded bg-panel-section-bg px-2 py-1.5">
                      <p className="text-[9px] text-panel-text-faint">Tipo ruta</p>
                      <p className="text-[11px] font-medium text-panel-text">
                        {orig && dest && orig.continente === dest.continente ? 'Continental' : 'Intercontinental'}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-panel-text-muted">
                        {cap > 0 ? 'Carga / capacidad' : 'Maletas del tramo'}
                      </span>
                      <span className="font-semibold text-panel-text">
                        {cap > 0 ? (
                          <>
                            {occ}/{cap}
                            <span className="ml-1 text-panel-text-faint">({pct.toFixed(0)}%)</span>
                          </>
                        ) : (
                          <>{occ}</>
                        )}
                      </span>
                    </div>
                    {cap > 0 ? (
                      <div className="h-1.5 w-full rounded-full bg-panel-section-bg overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${occ <= 0 ? 'bg-slate-400' : pct > config.thresholds.flight.yellow ? 'bg-red-500' : pct > config.thresholds.flight.green ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    ) : (
                      <p className="text-[10px] text-panel-text-faint">
                        La capacidad real del vuelo no pudo resolverse con certeza desde los datos actuales.
                      </p>
                    )}
                  </div>
                  <div className="border-t border-panel-border pt-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold text-panel-text">Envíos y maletas transportadas</p>
                      <span className="text-[9px] text-panel-text-faint">{selectedFlightAssignments.length} envíos · {selectedFlightBaggageTotal} maletas</span>
                    </div>
                    {selectedFlightAssignments.length > 0 ? (
                      <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                        {selectedFlightAssignments.map((assignment) => {
                          const metadata = shipmentMetadataByIndex.get(assignment.envioIndice);
                          const shipmentId = shipmentLabel(metadata, assignment.envioIndice);
                          return (
                            <button
                              key={assignment.envioIndice}
                              type="button"
                              onClick={() => selectShipment(assignment.envioIndice, metadata)}
                              className="w-full rounded border border-panel-border px-2 py-2 text-left hover:bg-panel-hover"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-mono text-[10px] font-semibold text-panel-text">{shipmentId}</span>
                                <span className="text-[9px] font-semibold text-panel-text">{assignment.maletas} maletas</span>
                              </div>
                              <p className="mt-1 truncate font-mono text-[8px] text-panel-text-faint">{baggageGroupLabel(shipmentId, assignment.maletas)}</p>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rounded bg-panel-section-bg px-2 py-2 text-center text-[9px] text-panel-text-faint">Esta ocurrencia no tiene envíos asignados en el plan vigente.</p>
                    )}
                  </div>
                </div>
              );
            })() : (
              <p className="text-[11px] text-panel-text-faint py-2 text-center">
                Haz clic en un vuelo o busca una ruta (ej: SKBO-EDDI)
              </p>
            )}
          </Section>

          {/* Cumplimiento */}
          <Section title="Cumplimiento de Plazos" icon={<Clock className="h-3.5 w-3.5" />}>
            <div className="flex items-center gap-4">
              {/* El % de cumplimiento solo aplica con un fin conocido. En Colapso
                  no se sabe cuándo colapsa, así que se muestran solo los conteos. */}
              {config.scenario !== 'collapse' && (
                <div className="relative h-16 w-16 flex-shrink-0">
                  <svg className="h-full w-full" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="38" fill="none" stroke="var(--panel-border)" strokeWidth="8" />
                    <circle cx="50" cy="50" r="38" fill="none" stroke="#10b981" strokeWidth="8"
                      strokeDasharray={`${stats.onTimeDeliveryRate * 2.39} 239`} strokeLinecap="round" transform="rotate(-90 50 50)" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs font-bold text-green-600 dark:text-green-400">{stats.onTimeDeliveryRate.toFixed(0)}%</span>
                  </div>
                </div>
              )}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-text-muted">Entregados</span>
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400">{contadores.entregado}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-text-muted">En tránsito</span>
                  <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">{contadores.en_vuelo + contadores.en_escala}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-text-muted">Pendientes</span>
                  <span className="text-[10px] font-medium text-panel-text">{contadores.pendiente}</span>
                </div>
                <div className="h-px bg-panel-border my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-text-muted">Total envíos</span>
                  <span className="text-[10px] font-medium text-panel-text">{contadores.total}</span>
                </div>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[9px] text-green-600 dark:text-green-400">
                    {contadores.entregado} entregados
                  </span>
                </div>
                {config.scenario !== 'collapse' && (
                  <p className="text-[10px] text-panel-text-faint mt-2">
                    Se recalcula con cada bloque de simulación.
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* Métricas Globales */}
          <Section title="Métricas Globales" icon={<TrendingUp className="h-3.5 w-3.5" />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {[
                { icon: <Package className="h-3 w-3 text-blue-500" />, label: 'Total Equipaje', value: stats.totalBaggage, color: 'text-panel-text' },
                { icon: <CheckCircle className="h-3 w-3 text-green-500" />, label: 'Entregadas', value: stats.delivered, color: 'text-green-600 dark:text-green-400' },
                { icon: <Plane className="h-3 w-3 text-blue-500" />, label: 'En Tránsito', value: stats.inTransit, color: 'text-blue-600 dark:text-blue-400' },
                { icon: <AlertCircle className="h-3 w-3 text-red-500" />, label: 'Retrasadas', value: stats.delayed, color: 'text-red-600 dark:text-red-400' },
                { icon: <XCircle className="h-3 w-3 text-amber-500" />, label: 'No Embarcadas', value: stats.notBoarded, color: 'text-amber-600 dark:text-amber-400' },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-1.5">
                    {m.icon}
                    <span className="text-[11px] text-panel-text-muted">{m.label}</span>
                  </div>
                  <span className={`text-xs font-semibold ${m.color}`}>{m.value}</span>
                </div>
              ))}
            </div>
            {stats.totalBaggage > 0 && config.scenario !== 'collapse' && (
              <div className="mt-2">
                <div className="flex h-2 w-full rounded-full overflow-hidden bg-panel-section-bg">
                  {statusData.map(s => (
                    <div key={s.name} style={{ width: `${(s.value / stats.totalBaggage) * 100}%`, backgroundColor: s.color }} className="h-full" />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                  {statusData.map(s => (
                    <div key={s.name} className="flex items-center gap-1">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-[9px] text-panel-text-muted">{s.name} ({s.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="absolute top-1/2 z-20 -translate-y-1/2 flex h-8 w-5 items-center justify-center rounded-r-md bg-panel-bg border border-l-0 border-panel-border shadow-sm hover:bg-panel-hover transition-all"
        style={{ left: panelOpen ? '320px' : '0px' }}
      >
        {panelOpen ? <ChevronLeft className="h-3 w-3 text-panel-text-muted" /> : <ChevronRight className="h-3 w-3 text-panel-text-muted" />}
      </button>

      {/* Map */}
      <div className="relative flex-1 min-w-0">
        <button type="button" onClick={() => setShowInTransitReport(true)} className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-blue-400/60 bg-panel-bg/95 px-3 py-2 text-[11px] font-semibold text-panel-text shadow-lg backdrop-blur transition hover:bg-panel-hover" title="Mostrar reporte de envíos que están actualmente en camino">
          <FileText className="h-4 w-4 text-blue-500" />
          Envíos en camino
          <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">{inTransitShipmentRows.length}</span>
        </button>
        <SimulationMap
          selectedAirportId={selectedAirportId}
          onAirportSelect={(id) => { setSelectedShipmentIndex(null); setSelectedAirportId(id); setSelectedVuelo(null); }}
          onFlightSelect={handleFlightSelect}
          onClearSelection={clearMapSelection}
          selectedFlightKey={selectedFlightKey}
          selectedFlight={selectedVuelo}
          warehouseCodeFilter={warehouseQuery}
          warehouseStatusFilter={warehouseStatusFilter}
          highlightedShipmentRoute={selectedShipmentRoute}
        />
      </div>

      {showInTransitReport && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowInTransitReport(false)}>
          <div className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-panel-border px-5 py-4">
              <div>
                <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-blue-500" /><h2 className="text-base font-semibold text-panel-text">Reporte de envíos en camino</h2><span className="rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-bold text-white">{inTransitShipmentRows.length}</span></div>
                <p className="mt-1 text-[11px] text-panel-text-faint">Envíos cuyo tramo actual ya salió y todavía no llegó a destino.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={downloadInTransitReport} disabled={inTransitShipmentRows.length === 0} className="flex items-center gap-1.5 rounded border border-panel-border bg-panel-section-bg px-3 py-2 text-[11px] font-medium text-panel-text hover:bg-panel-hover disabled:opacity-40"><Download className="h-3.5 w-3.5" />Descargar CSV</button>
                <button type="button" onClick={() => setShowInTransitReport(false)} className="rounded p-2 text-panel-text-faint hover:bg-panel-hover hover:text-panel-text" aria-label="Cerrar reporte"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-panel-section-bg text-[10px] uppercase tracking-wide text-panel-text-faint"><tr><th className="px-4 py-3">Envío</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Tramo actual</th><th className="px-4 py-3">Destino final</th><th className="px-4 py-3 text-right">Maletas</th><th className="px-4 py-3">Salida UTC</th><th className="px-4 py-3">Llegada UTC</th></tr></thead>
                <tbody>
                  {inTransitShipmentRows.map((row) => (
                    <tr key={`in-transit-${row.index}-${row.activeLeg.tramoIndex}`} className="cursor-pointer border-t border-panel-border text-[11px] hover:bg-panel-hover" onClick={() => { selectShipment(row.index, row.metadata); setShowInTransitReport(false); }}>
                      <td className="px-4 py-3 font-mono font-semibold text-panel-text">{shipmentLabel(row.metadata, row.index)}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-blue-500/15 px-2 py-1 text-[10px] font-semibold text-blue-500">En camino</span></td>
                      <td className="px-4 py-3 font-semibold text-panel-text">{row.activeLeg.desde} → {row.activeLeg.hasta}</td>
                      <td className="px-4 py-3 text-panel-text-muted">{row.metadata?.destino_iata ?? row.route[row.route.length - 1]?.hasta ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-panel-text">{row.activeLeg.maletas}</td>
                      <td className="px-4 py-3 text-panel-text-muted">{formatUtcMinute(row.activeLeg.salidaUTC)}</td>
                      <td className="px-4 py-3 text-panel-text-muted">{formatUtcMinute(row.activeLeg.llegadaUTC)}</td>
                    </tr>
                  ))}
                  {inTransitShipmentRows.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-panel-text-faint">No hay envíos en vuelo en este instante.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </div>{/* end flex-1 overflow-hidden */}
    </div>
  );
}
