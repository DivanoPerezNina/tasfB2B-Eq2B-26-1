import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { useDomain } from '../context/DomainContext';
import {
  formatMinutesUTC,
  getContinentLabel,
} from '../data/envios';
import { Map } from '../components/Map';
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
} from 'lucide-react';

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


export function UnifiedDashboard() {
  const {
    stats, getAirportStats,aeropuertosState,
    fase, contadores, progresoPct, warmupPct, simulationTime, tiempoSimUTC,
    collapseFailure, lastValidTick, config, planTramos, planResumen,
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
    if (pct > 80) return 'rojo';
    if (pct > 60) return 'ambar';
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
  }, [warehouseQuery, warehouseStatusFilter, aeropuertosBFF, airports, aeropuertosState]);

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
              <div className={`flex h-16 w-16 items-center justify-center rounded-full ${collapseFailure ? 'bg-red-500/10' : 'bg-green-500/15'}`}>
                {collapseFailure ? (
                  <AlertCircle className="h-8 w-8 text-red-500" />
                ) : (
                  <Trophy className="h-8 w-8 text-green-500" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-bold text-panel-text">
                  {collapseFailure ? 'No se llegó al colapso SLA' : 'Simulación completada'}
                </h2>
                <p className="mt-1 text-sm text-panel-text-muted">
                  {collapseFailure
                    ? 'La simulación se detuvo por un límite técnico del planificador antes de registrar rechazos SLA.'
                    : 'Resultados finales del período'}
                </p>
              </div>
              {collapseFailure && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  {collapseFailure.badge}
                </span>
              )}
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: 'Fecha de inicio', value: format(config.startDate, 'dd/MM/yyyy HH:mm') },
                  { label: 'Fecha de fin / límite técnico', value: format(fechaFinSim, 'dd/MM/yyyy HH:mm') },
                  { label: 'Días simulados', value: diasSimulados },
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
              {collapseFailure && (
                <details className="w-full rounded-2xl border border-panel-border bg-background p-3 text-left text-sm text-panel-text-muted">
                  <summary className="cursor-pointer text-sm font-medium text-panel-text">Ver detalle técnico</summary>
                  <p className="mt-2 whitespace-pre-wrap">{collapseFailure.technicalMessage}</p>
                </details>
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
                      <div className={`h-full ${row.percentage > 90 ? 'bg-red-500' : row.percentage > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(row.percentage, 100)}%` }} />
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

          {/* Flight Info */}
          <Section
            title={selectedVuelo ? `${getAeropuertoById(selectedVuelo.idOrigen)?.iata} → ${getAeropuertoById(selectedVuelo.idDestino)?.iata}` : 'Vuelo'}
            icon={<Plane className="h-3.5 w-3.5" />}
            accentColor={selectedVuelo ? 'text-indigo-500' : undefined}
          >
            {selectedVuelo ? (() => {
              const orig = getAeropuertoById(selectedVuelo.idOrigen);
              const dest = getAeropuertoById(selectedVuelo.idDestino);
              const occ = selectedFlightMeta?.maletasTramo ?? 0;
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
                          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    ) : (
                      <p className="text-[10px] text-panel-text-faint">
                        La capacidad real del vuelo no pudo resolverse con certeza desde los datos actuales.
                      </p>
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
      <div className="flex-1 min-w-0">
        <Map
          selectedAirportId={selectedAirportId}
          onAirportSelect={(id) => { setSelectedShipmentIndex(null); setSelectedAirportId(id); setSelectedVuelo(null); }}
          onFlightSelect={handleFlightSelect}
          selectedFlightKey={selectedFlightKey}
          warehouseCodeFilter={warehouseQuery}
          warehouseStatusFilter={warehouseStatusFilter}
          highlightedShipmentRoute={selectedShipmentRoute}
        />
      </div>
      </div>{/* end flex-1 overflow-hidden */}
    </div>
  );
}
