import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { useDomain } from '../context/DomainContext';
import {
  formatMinutesUTC,
  getContinentLabel,
} from '../data/envios';
import { Map } from '../components/Map';
import { Vuelo } from '../types';
import { format } from 'date-fns';
import {
  Search,
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
  Pause,
  Play,
  Square,
  RotateCcw,
  Trophy,
} from 'lucide-react';

// ─── Collapsible Section ───
function Section({
  title,
  icon,
  children,
  defaultOpen = true,
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
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-panel-hover transition-colors"
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
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ─── Search result types ───
type SearchResultType = 'aeropuerto' | 'vuelo';
interface SearchResult {
  type: SearchResultType;
  label: string;
  sublabel: string;
  data: any;
}


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

  return `${diaTexto} de ${meses[date.getMonth()]} del ${date.getFullYear()}`;
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
    stats, getAirportStats,
    fase, contadores, progresoPct, warmupPct, simulationTime,
    collapseFailure, lastValidTick, config,
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

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    const results: SearchResult[] = [];

    // Aeropuertos desde BD (via aeropuertosBFF que tiene ciudad y país)
    for (const ap of aeropuertosBFF) {
      if (ap.iata.includes(q) || ap.ciudad.toUpperCase().includes(q)) {
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

    // Nota: búsqueda de envíos individuales pendiente de endpoint backend
    // TODO: fetch /api/envios?q=... cuando el BFF lo implemente
    return results.slice(0, 15);
  }, [query, aeropuertosBFF, vuelosBD, aeropuertosBackend]);

  const handleSelectResult = (result: SearchResult) => {
    setShowResults(false);
    setQuery('');
    if (result.type === 'aeropuerto') {
      const ap = result.data as typeof aeropuertosBackend[0];
      const frontAirport = airports.find(a => a.code === ap.iata);
      if (frontAirport) { setSelectedAirportId(frontAirport.id); setSelectedVuelo(null); }
    } else if (result.type === 'vuelo') {
      const v = result.data as Vuelo;
      setSelectedVuelo(v);
      const orig = getAeropuertoById(v.idOrigen);
      if (orig) { const fa = airports.find(a => a.code === orig.iata); if (fa) setSelectedAirportId(fa.id); }
    }
  };

  const selectedAirport = selectedAirportId ? airports.find(a => a.id === selectedAirportId) : null;
  const airportStats = selectedAirportId ? getAirportStats(selectedAirportId) : null;
  const selectedBackendAirport = selectedAirport ? aeropuertosBackend.find(a => a.iata === selectedAirport.code) : null;
  const airportVuelos = selectedBackendAirport ? getVuelosByAeropuerto(selectedBackendAirport.id) : [];
  const selectedBFF = selectedAirport ? aeropuertosBFF.find(a => a.iata === selectedAirport.code) : null;

  const statusData = [
    { name: 'Entregadas', value: stats.delivered, color: '#10b981' },
    { name: 'En Tránsito', value: stats.inTransit, color: '#3b82f6' },
    { name: 'Retrasadas', value: stats.delayed, color: '#ef4444' },
    { name: 'No Embarcadas', value: stats.notBoarded, color: '#f59e0b' },
  ].filter(item => item.value > 0);

  const typeIcons: Record<SearchResultType, React.ReactNode> = {
    aeropuerto: <MapPin className="h-3.5 w-3.5 text-blue-500" />,
    vuelo: <Plane className="h-3.5 w-3.5 text-indigo-500" />,
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
      <div className="flex items-center gap-4 border-b border-panel-border bg-panel-bg px-4 py-2 flex-shrink-0">
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
            {/* Fecha de inicio: en simulaciones de 3, 5 y 7 días se muestra como texto */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-panel-text-muted">Inicio:</span>
              <span className="text-xs font-semibold text-panel-text">{fechaInicioSim}</span>
            </div>
          </>
        )}
        <div className="h-4 w-px bg-panel-border" />
        {/* Tiempo simulado actual */}
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-panel-text-faint" />
          <span className="font-mono text-xs text-panel-text">
            {contadores.total > 0 ? format(simulationTime, 'dd/MM/yyyy HH:mm') : '—'}
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
        <div className="ml-auto flex items-center gap-1.5">
          {fase === 'ejecutando' && (
            <button
              onClick={pausarSimulacion}
              title="Pausar la simulación"
              className="flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-2.5 py-1.5 text-xs font-medium text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20 transition-colors"
            >
              <Pause className="h-3.5 w-3.5" /> Pausar
            </button>
          )}
          {fase === 'pausado' && (
            <button
              onClick={reanudarSimulacion}
              title="Reanudar la simulación"
              className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-2.5 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> Reanudar
            </button>
          )}
          {(fase === 'ejecutando' || fase === 'pausado' || fase === 'calentando') && (
            <button
              onClick={detenerSimulacion}
              title="Detener la simulación"
              className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Square className="h-3.5 w-3.5" /> Detener
            </button>
          )}
          {(fase === 'completado' || fase === 'error' || fase === 'idle') && (
            <button
              onClick={resetear}
              className="flex items-center gap-1.5 rounded-md bg-panel-section-bg px-2.5 py-1.5 text-xs font-medium text-panel-text-muted hover:bg-panel-hover transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Nueva simulación
            </button>
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
          <div className="border-b border-panel-border p-3" ref={searchRef}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-panel-text-faint" />
              <input
                type="text"
                placeholder="Buscar aeropuerto, vuelo o envío..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
                onFocus={() => query.length >= 2 && setShowResults(true)}
                className="w-full rounded-lg border border-panel-border bg-panel-section-bg py-2 pl-8 pr-8 text-xs text-panel-text placeholder:text-panel-text-faint focus:border-blue-400 focus:bg-panel-bg focus:outline-none focus:ring-1 focus:ring-blue-400/30 transition-colors"
              />
              {query && (
                <button onClick={() => { setQuery(''); setShowResults(false); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-panel-text-faint hover:text-panel-text-muted">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
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
                  <p className="text-xs text-panel-text-faint">Sin resultados para "{query}"</p>
                </div>
              )}
            </div>
            <div className="flex gap-1 mt-2">
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] text-blue-600 dark:text-blue-400">IATA: SKBO</span>
              <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[9px] text-indigo-600 dark:text-indigo-400">Ruta: SKBO-EDDI</span>
            </div>
          </div>

          {/* Airport Info */}
          <Section
            title={selectedAirport ? `${selectedAirport.code} — ${selectedAirport.city}` : 'Aeropuerto'}
            icon={<MapPin className="h-3.5 w-3.5" />}
            accentColor={selectedAirport ? 'text-blue-500' : undefined}
            badge={selectedBackendAirport ? `#${selectedBackendAirport.id}` : undefined}
          >
            {selectedAirport && airportStats && selectedBackendAirport ? (
              <div className="space-y-2">
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
                {airportVuelos.length > 0 && (
                  <div>
                    <p className="text-[10px] text-panel-text-faint mb-1">Vuelos conectados ({airportVuelos.length})</p>
                    <div className="max-h-24 overflow-y-auto space-y-0.5">
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
                <div className="space-y-2">
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
                  <button onClick={() => setSelectedVuelo(null)} className="w-full rounded bg-panel-section-bg px-2 py-1 text-[10px] text-panel-text-muted hover:bg-panel-hover transition-colors">
                    Cerrar vuelo
                  </button>
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
              <div className="space-y-1 flex-1">
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
            <div className="space-y-1">
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
          onAirportSelect={(id) => { setSelectedAirportId(id); setSelectedVuelo(null); }}
          onFlightSelect={handleFlightSelect}
          selectedFlightKey={selectedFlightKey}
        />
      </div>
      </div>{/* end flex-1 overflow-hidden */}
    </div>
  );
}
