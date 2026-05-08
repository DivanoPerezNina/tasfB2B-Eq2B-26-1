import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { airports } from '../data/airports';
import {
  aeropuertosBackend,
  vuelosBackend,
  envios,
  getAeropuertoById,
  getVuelosByAeropuerto,
  getEnviosByAeropuerto,
  formatMinutesUTC,
  getContinentLabel,
} from '../data/envios';
import { Map } from '../components/Map';
import { Envio, Vuelo } from '../types';
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
  Sparkles,
  XCircle,
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
type SearchResultType = 'aeropuerto' | 'vuelo' | 'envio';
interface SearchResult {
  type: SearchResultType;
  label: string;
  sublabel: string;
  data: any;
}

// ─── Estado badge ───
function EstadoBadge({ estado }: { estado: Envio['estado'] }) {
  const styles = {
    Exitoso: 'bg-green-500/15 text-green-600 dark:text-green-400',
    Rechazado: 'bg-red-500/15 text-red-600 dark:text-red-400',
    SalvadoGVNS: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  };
  const icons = {
    Exitoso: <CheckCircle className="h-3 w-3" />,
    Rechazado: <XCircle className="h-3 w-3" />,
    SalvadoGVNS: <Sparkles className="h-3 w-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[estado]}`}>
      {icons[estado]}
      {estado === 'SalvadoGVNS' ? 'GVNS' : estado}
    </span>
  );
}

export function UnifiedDashboard() {
  const { stats, baggages, getAirportStats } = useSimulation();
  const [selectedAirportId, setSelectedAirportId] = useState<string | undefined>();
  const [selectedVuelo, setSelectedVuelo] = useState<Vuelo | null>(null);
  const [selectedEnvio, setSelectedEnvio] = useState<Envio | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

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
    for (const ap of aeropuertosBackend) {
      if (ap.iata.includes(q)) {
        results.push({ type: 'aeropuerto', label: ap.iata, sublabel: `Aeropuerto · ${getContinentLabel(ap.continente)} · Cap: ${ap.capacidadAlmacen}`, data: ap });
      }
    }
    for (const v of vuelosBackend) {
      const orig = getAeropuertoById(v.idOrigen);
      const dest = getAeropuertoById(v.idDestino);
      if (!orig || !dest) continue;
      const routeStr = `${orig.iata}-${dest.iata}`;
      const routeStr2 = `${orig.iata} ${dest.iata}`;
      if (routeStr.includes(q) || routeStr2.includes(q) || orig.iata.includes(q) || dest.iata.includes(q)) {
        if (!(orig.iata === q || dest.iata === q)) {
          results.push({ type: 'vuelo', label: `${orig.iata} → ${dest.iata}`, sublabel: `Vuelo · ${formatMinutesUTC(v.salidaUTC)} - ${formatMinutesUTC(v.llegadaUTC)} · Cap: ${v.capacidadMaxima}`, data: v });
        }
      }
    }
    for (const e of envios) {
      if (e.id.toUpperCase().includes(q)) {
        const orig = getAeropuertoById(e.idOrigen);
        const dest = getAeropuertoById(e.idDestino);
        results.push({ type: 'envio', label: e.id, sublabel: `Envío · ${orig?.iata || '?'} → ${dest?.iata || '?'} · ${e.cantidadMaletas} maleta(s) · ${e.estado}`, data: e });
      }
    }
    return results.slice(0, 15);
  }, [query]);

  const handleSelectResult = (result: SearchResult) => {
    setShowResults(false);
    setQuery('');
    if (result.type === 'aeropuerto') {
      const ap = result.data as typeof aeropuertosBackend[0];
      const frontAirport = airports.find(a => a.code === ap.iata);
      if (frontAirport) { setSelectedAirportId(frontAirport.id); setSelectedVuelo(null); setSelectedEnvio(null); }
    } else if (result.type === 'vuelo') {
      const v = result.data as Vuelo;
      setSelectedVuelo(v);
      const orig = getAeropuertoById(v.idOrigen);
      if (orig) { const fa = airports.find(a => a.code === orig.iata); if (fa) setSelectedAirportId(fa.id); }
      setSelectedEnvio(null);
    } else if (result.type === 'envio') {
      const e = result.data as Envio;
      setSelectedEnvio(e);
      const orig = getAeropuertoById(e.idOrigen);
      if (orig) { const fa = airports.find(a => a.code === orig.iata); if (fa) setSelectedAirportId(fa.id); }
      if (e.rutaAsignada && e.rutaAsignada.length >= 2) {
        const firstFlight = vuelosBackend.find(v => v.idOrigen === e.rutaAsignada![0] && v.idDestino === e.rutaAsignada![1]);
        if (firstFlight) setSelectedVuelo(firstFlight);
      }
    }
  };

  const selectedAirport = selectedAirportId ? airports.find(a => a.id === selectedAirportId) : null;
  const airportStats = selectedAirportId ? getAirportStats(selectedAirportId) : null;
  const selectedBackendAirport = selectedAirport ? aeropuertosBackend.find(a => a.iata === selectedAirport.code) : null;
  const airportVuelos = selectedBackendAirport ? getVuelosByAeropuerto(selectedBackendAirport.id) : [];

  const statusData = [
    { name: 'Entregadas', value: stats.delivered, color: '#10b981' },
    { name: 'En Tránsito', value: stats.inTransit, color: '#3b82f6' },
    { name: 'Retrasadas', value: stats.delayed, color: '#ef4444' },
    { name: 'No Embarcadas', value: stats.notBoarded, color: '#f59e0b' },
  ].filter(item => item.value > 0);

  const typeIcons: Record<SearchResultType, React.ReactNode> = {
    aeropuerto: <MapPin className="h-3.5 w-3.5 text-blue-500" />,
    vuelo: <Plane className="h-3.5 w-3.5 text-indigo-500" />,
    envio: <Package className="h-3.5 w-3.5 text-amber-500" />,
  };

  return (
    <div className="flex h-full bg-background">
      {/* Left panel */}
      <div className={`relative flex-shrink-0 border-r border-panel-border bg-panel-bg transition-all duration-300 ${panelOpen ? 'w-80' : 'w-0'} overflow-hidden`}>
        <div className="flex h-full w-80 flex-col overflow-y-auto">
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
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-600 dark:text-amber-400">Envío: ENV-0001</span>
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
                <p className="text-[11px] text-panel-text-faint">{selectedAirport.name}</p>
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
              const occ = selectedVuelo.ocupacionActual ?? 0;
              const pct = selectedVuelo.capacidadMaxima > 0 ? (occ / selectedVuelo.capacidadMaxima) * 100 : 0;
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
                      <span className="text-panel-text-muted">Ocupación</span>
                      <span className="font-semibold text-panel-text">
                        {occ}/{selectedVuelo.capacidadMaxima}
                        <span className="ml-1 text-panel-text-faint">({pct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-panel-section-bg overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
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

          {/* Envio info */}
          {selectedEnvio && (
            <Section
              title={`Envío ${selectedEnvio.id}`}
              icon={<Package className="h-3.5 w-3.5" />}
              accentColor="text-amber-500"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <EstadoBadge estado={selectedEnvio.estado} />
                  <span className="text-[10px] text-panel-text-faint">{selectedEnvio.cantidadMaletas} maleta(s)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="text-center">
                    <p className="font-bold text-panel-text">{getAeropuertoById(selectedEnvio.idOrigen)?.iata}</p>
                    <p className="text-[9px] text-panel-text-faint">Origen</p>
                  </div>
                  <ArrowRight className="h-3 w-3 text-panel-text-faint" />
                  <div className="text-center">
                    <p className="font-bold text-panel-text">{getAeropuertoById(selectedEnvio.idDestino)?.iata}</p>
                    <p className="text-[9px] text-panel-text-faint">Destino</p>
                  </div>
                </div>
                {selectedEnvio.rutaAsignada && (
                  <div>
                    <p className="text-[10px] text-panel-text-faint mb-1">Ruta asignada</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {selectedEnvio.rutaAsignada.map((apId, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <ArrowRight className="h-2.5 w-2.5 text-panel-text-faint" />}
                          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                            {getAeropuertoById(apId)?.iata || apId}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded bg-panel-section-bg px-2 py-1.5">
                    <p className="text-[9px] text-panel-text-faint">Registro</p>
                    <p className="text-[10px] font-medium text-panel-text">Min {selectedEnvio.registroUTC}</p>
                  </div>
                  <div className="rounded bg-panel-section-bg px-2 py-1.5">
                    <p className="text-[9px] text-panel-text-faint">Deadline</p>
                    <p className="text-[10px] font-medium text-panel-text">Min {selectedEnvio.deadlineUTC}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedEnvio(null)} className="w-full rounded bg-panel-section-bg px-2 py-1 text-[10px] text-panel-text-muted hover:bg-panel-hover transition-colors">
                  Cerrar envío
                </button>
              </div>
            </Section>
          )}

          {/* Cumplimiento */}
          <Section title="Cumplimiento de Plazos" icon={<Clock className="h-3.5 w-3.5" />}>
            <div className="flex items-center gap-4">
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
              <div className="space-y-1 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-text-muted">Continental (24h)</span>
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400">96%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-text-muted">Intercontinental (48h)</span>
                  <span className="text-[10px] font-medium text-yellow-600 dark:text-yellow-400">88%</span>
                </div>
                <div className="h-px bg-panel-border my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-text-muted">Envíos totales</span>
                  <span className="text-[10px] font-medium text-panel-text">{envios.length}</span>
                </div>
                <div className="flex gap-1.5 mt-1">
                  <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[9px] text-green-600 dark:text-green-400">
                    {envios.filter(e => e.estado === 'Exitoso').length} exitosos
                  </span>
                  <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] text-purple-600 dark:text-purple-400">
                    {envios.filter(e => e.estado === 'SalvadoGVNS').length} GVNS
                  </span>
                  <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] text-red-600 dark:text-red-400">
                    {envios.filter(e => e.estado === 'Rechazado').length} rech.
                  </span>
                </div>
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
            {stats.totalBaggage > 0 && (
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
        <Map selectedAirportId={selectedAirportId} onAirportSelect={(id) => { setSelectedAirportId(id); setSelectedVuelo(null); setSelectedEnvio(null); }} />
      </div>
    </div>
  );
}
