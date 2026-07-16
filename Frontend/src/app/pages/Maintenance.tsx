import React, { useEffect, useMemo, useState } from 'react';
import { Button, InlineNotification, Tag } from '@carbon/react';
import { Add, Edit, TrashCan, Renew } from '@carbon/icons-react';
import { useNavigate, useParams } from 'react-router';
import { AeroBFF, VueloBFF, useDomain } from '../context/DomainContext';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

type MaintenanceSection = 'aeropuertos' | 'vuelos' | 'tramos';

type AirportForm = {
  iata: string;
  ciudad: string;
  pais: string;
  continente: string;
  gmt_offset: string;
  capacidad_almacen: string;
  lat: string;
  lng: string;
};

type FlightForm = {
  origen_iata: string;
  destino_iata: string;
  salida: string;
  llegada: string;
  capacidad_max: string;
};

const EMPTY_AIRPORT: AirportForm = {
  iata: '', ciudad: '', pais: '', continente: '1', gmt_offset: '0',
  capacidad_almacen: '500', lat: '0', lng: '0',
};

const EMPTY_FLIGHT: FlightForm = {
  origen_iata: '', destino_iata: '', salida: '08:00', llegada: '10:00', capacidad_max: '150',
};

function minutesToTime(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function continentName(value: number) {
  return value === 1 ? 'América del Sur' : value === 2 ? 'Europa' : value === 3 ? 'Asia' : 'Sin definir';
}

async function apiRequest(path: string, options: RequestInit) {
  const response = await fetch(`${BFF}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.mensaje ?? body.message ?? `Error HTTP ${response.status}`);
  }
  return body.data ?? body;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm text-panel-text">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'h-10 w-full border border-panel-border bg-panel-bg px-3 text-sm text-panel-text outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

export function Maintenance() {
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();
  const section = (['aeropuertos', 'vuelos', 'tramos'].includes(params.section ?? '')
    ? params.section
    : undefined) as MaintenanceSection | undefined;
  const { aeropuertosBFF, vuelosBFF, reloadDomain, isLoading } = useDomain();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAirport, setEditingAirport] = useState<AeroBFF | null>(null);
  const [editingFlight, setEditingFlight] = useState<VueloBFF | null>(null);
  const [airportForm, setAirportForm] = useState<AirportForm>(EMPTY_AIRPORT);
  const [flightForm, setFlightForm] = useState<FlightForm>(EMPTY_FLIGHT);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; title: string; detail: string } | null>(null);
  const pageSize = 25;

  useEffect(() => {
    setSearch('');
    setPage(1);
    setModalOpen(false);
  }, [section]);

  const filteredAirports = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return aeropuertosBFF;
    return aeropuertosBFF.filter((a) => `${a.iata} ${a.ciudad} ${a.pais}`.toUpperCase().includes(q));
  }, [aeropuertosBFF, search]);

  const filteredFlights = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return vuelosBFF;
    return vuelosBFF.filter((v) => `${v.id} ${v.origen_iata} ${v.destino_iata}`.toUpperCase().includes(q));
  }, [vuelosBFF, search]);

  const totalItems = section === 'aeropuertos' ? filteredAirports.length : filteredFlights.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleAirports = filteredAirports.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visibleFlights = filteredFlights.slice((safePage - 1) * pageSize, safePage * pageSize);

  const openCreate = () => {
    setEditingAirport(null);
    setEditingFlight(null);
    if (section === 'aeropuertos') {
      setAirportForm(EMPTY_AIRPORT);
    } else {
      setFlightForm({
        ...EMPTY_FLIGHT,
        origen_iata: aeropuertosBFF[0]?.iata ?? '',
        destino_iata: aeropuertosBFF[1]?.iata ?? '',
      });
    }
    setModalOpen(true);
  };

  const openEditAirport = (airport: AeroBFF) => {
    setEditingAirport(airport);
    setEditingFlight(null);
    setAirportForm({
      iata: airport.iata,
      ciudad: airport.ciudad,
      pais: airport.pais,
      continente: String(airport.continente),
      gmt_offset: String(airport.gmt_offset),
      capacidad_almacen: String(airport.capacidad_almacen),
      lat: String(airport.lat),
      lng: String(airport.lng),
    });
    setModalOpen(true);
  };

  const openEditFlight = (flight: VueloBFF) => {
    setEditingFlight(flight);
    setEditingAirport(null);
    setFlightForm({
      origen_iata: flight.origen_iata,
      destino_iata: flight.destino_iata,
      salida: minutesToTime(flight.salida_minutos),
      llegada: minutesToTime(flight.llegada_minutos),
      capacidad_max: String(flight.capacidad_max),
    });
    setModalOpen(true);
  };

  const submitAirport = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const payload = {
        ...airportForm,
        continente: Number(airportForm.continente),
        gmt_offset: Number(airportForm.gmt_offset),
        capacidad_almacen: Number(airportForm.capacidad_almacen),
        lat: Number(airportForm.lat),
        lng: Number(airportForm.lng),
      };
      if (editingAirport) {
        await apiRequest(`/api/mantenimiento/aeropuertos/${editingAirport.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/api/mantenimiento/aeropuertos', { method: 'POST', body: JSON.stringify(payload) });
      }
      await reloadDomain();
      setModalOpen(false);
      setFeedback({ kind: 'success', title: 'Mantenimiento completado', detail: editingAirport ? 'Aeropuerto actualizado.' : 'Aeropuerto creado.' });
    } catch (error: any) {
      setFeedback({ kind: 'error', title: 'No se pudo guardar', detail: error.message });
    } finally {
      setBusy(false);
    }
  };

  const submitFlight = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const payload = {
        origen_iata: flightForm.origen_iata,
        destino_iata: flightForm.destino_iata,
        salida_minutos: timeToMinutes(flightForm.salida),
        llegada_minutos: timeToMinutes(flightForm.llegada),
        capacidad_max: Number(flightForm.capacidad_max),
      };
      const resource = section === 'tramos' ? 'tramos' : 'vuelos';
      if (editingFlight) {
        await apiRequest(`/api/mantenimiento/${resource}/${editingFlight.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest(`/api/mantenimiento/${resource}`, { method: 'POST', body: JSON.stringify(payload) });
      }
      await reloadDomain();
      setModalOpen(false);
      setFeedback({ kind: 'success', title: 'Mantenimiento completado', detail: editingFlight ? 'Registro actualizado.' : 'Registro creado.' });
    } catch (error: any) {
      setFeedback({ kind: 'error', title: 'No se pudo guardar', detail: error.message });
    } finally {
      setBusy(false);
    }
  };

  const removeAirport = async (airport: AeroBFF) => {
    if (!window.confirm(`¿Eliminar el aeropuerto ${airport.iata}? Solo será posible si no tiene vuelos o envíos relacionados.`)) return;
    setBusy(true);
    try {
      await apiRequest(`/api/mantenimiento/aeropuertos/${airport.id}`, { method: 'DELETE' });
      await reloadDomain();
      setFeedback({ kind: 'success', title: 'Aeropuerto eliminado', detail: `${airport.iata} fue eliminado.` });
    } catch (error: any) {
      setFeedback({ kind: 'error', title: 'No se pudo eliminar', detail: error.message });
    } finally {
      setBusy(false);
    }
  };

  const removeFlight = async (flight: VueloBFF) => {
    const label = section === 'tramos' ? 'tramo' : 'vuelo';
    if (!window.confirm(`¿Eliminar el ${label} ${flight.origen_iata} → ${flight.destino_iata} (${flight.id})?`)) return;
    setBusy(true);
    try {
      const resource = section === 'tramos' ? 'tramos' : 'vuelos';
      await apiRequest(`/api/mantenimiento/${resource}/${flight.id}`, { method: 'DELETE' });
      await reloadDomain();
      setFeedback({ kind: 'success', title: 'Registro eliminado', detail: `El ${label} fue eliminado.` });
    } catch (error: any) {
      setFeedback({ kind: 'error', title: 'No se pudo eliminar', detail: error.message });
    } finally {
      setBusy(false);
    }
  };

  const cards: Array<{ id: MaintenanceSection; title: string; description: string; code: string }> = [
    { id: 'aeropuertos', title: 'Aeropuertos y almacenes', description: 'Alta, consulta, edición y eliminación de ubicación, zona horaria y capacidad.', code: 'B03' },
    { id: 'vuelos', title: 'Unidades de transporte', description: 'CRUD individual de vuelos, rutas y capacidad máxima.', code: 'B04' },
    { id: 'tramos', title: 'Tramos y horarios', description: 'CRUD de origen, destino, salida, llegada y capacidad del tramo.', code: 'B11' },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel-bg text-panel-text">
      <header className="flex-shrink-0 border-b border-panel-border px-6 py-5">
        <div className="mx-auto w-full max-w-[1760px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Mantenimiento</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-panel-text-faint">
                Administración individual de los datos maestros utilizados por el planificador. Realiza cambios fuera de una simulación activa.
              </p>
            </div>
            {section && <Button kind="ghost" onClick={() => navigate('/mantenimiento')}>Volver al menú</Button>}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto w-full max-w-[1760px]">
          <div className="grid gap-4 md:grid-cols-3">
            {cards.map((card) => (
              <button
                type="button"
                key={card.id}
                onClick={() => navigate(`/mantenimiento/${card.id}`)}
                className={`border p-5 text-left transition hover:border-blue-500 hover:bg-panel-hover ${section === card.id ? 'border-blue-500 bg-blue-500/10' : 'border-panel-border bg-panel-bg-subtle'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">{card.title}</h2>
                  <Tag type="blue">{card.code}</Tag>
                </div>
                <p className="mt-2 text-sm leading-5 text-panel-text-faint">{card.description}</p>
              </button>
            ))}
          </div>

          {!section ? (
            <section className="mt-6 border border-panel-border bg-panel-bg-subtle p-8 text-center">
              <h2 className="text-xl font-semibold">Selecciona un mantenimiento</h2>
              <p className="mt-2 text-sm text-panel-text-faint">Cada opción abre su tabla y las acciones Crear, Editar y Eliminar.</p>
            </section>
          ) : (
            <section className="mt-6 border border-panel-border bg-panel-bg-subtle">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-panel-border p-5">
                <div>
                  <p className="text-xs uppercase tracking-wide text-panel-text-faint">Módulo activo</p>
                  <h2 className="mt-1 text-2xl font-semibold">{cards.find((card) => card.id === section)?.title}</h2>
                  {section === 'tramos' && (
                    <p className="mt-1 text-sm text-panel-text-faint">Los tramos comparten el catálogo operativo de vuelos; aquí se administran específicamente ruta y horarios.</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputClass} min-w-[260px]`}
                    value={search}
                    onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                    placeholder={section === 'aeropuertos' ? 'Buscar IATA, ciudad o país' : 'Buscar ID, origen o destino'}
                  />
                  <Button kind="secondary" renderIcon={Renew} disabled={isLoading || busy} onClick={() => reloadDomain().catch((error) => setFeedback({ kind: 'error', title: 'Error de recarga', detail: error.message }))}>Actualizar</Button>
                  <Button renderIcon={Add} onClick={openCreate}>Crear</Button>
                </div>
              </div>

              {feedback && (
                <div className="p-4 pb-0">
                  <InlineNotification kind={feedback.kind} lowContrast title={feedback.title} subtitle={feedback.detail} onCloseButtonClick={() => setFeedback(null)} />
                </div>
              )}

              <div className="overflow-auto">
                {section === 'aeropuertos' ? (
                  <table className="w-full min-w-[1160px] border-collapse text-sm">
                    <thead className="bg-panel-bg text-left text-xs uppercase tracking-wide text-panel-text-faint">
                      <tr>
                        <th className="border-b border-panel-border px-4 py-3">IATA</th>
                        <th className="border-b border-panel-border px-4 py-3">Ciudad</th>
                        <th className="border-b border-panel-border px-4 py-3">País</th>
                        <th className="border-b border-panel-border px-4 py-3">Continente</th>
                        <th className="border-b border-panel-border px-4 py-3">GMT</th>
                        <th className="border-b border-panel-border px-4 py-3 text-right">Capacidad almacén</th>
                        <th className="border-b border-panel-border px-4 py-3">Coordenadas</th>
                        <th className="border-b border-panel-border px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAirports.map((airport) => (
                        <tr key={airport.id} className="hover:bg-panel-hover">
                          <td className="border-b border-panel-border px-4 py-3 font-mono font-semibold">{airport.iata}</td>
                          <td className="border-b border-panel-border px-4 py-3">{airport.ciudad}</td>
                          <td className="border-b border-panel-border px-4 py-3">{airport.pais}</td>
                          <td className="border-b border-panel-border px-4 py-3">{continentName(airport.continente)}</td>
                          <td className="border-b border-panel-border px-4 py-3">UTC{airport.gmt_offset >= 0 ? '+' : ''}{airport.gmt_offset}</td>
                          <td className="border-b border-panel-border px-4 py-3 text-right">{airport.capacidad_almacen}</td>
                          <td className="border-b border-panel-border px-4 py-3 font-mono text-xs">{airport.lat.toFixed(4)}, {airport.lng.toFixed(4)}</td>
                          <td className="border-b border-panel-border px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" kind="secondary" renderIcon={Edit} onClick={() => openEditAirport(airport)}>Editar</Button>
                              <Button size="sm" kind="danger--tertiary" renderIcon={TrashCan} disabled={busy} onClick={() => removeAirport(airport)}>Eliminar</Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full min-w-[1100px] border-collapse text-sm">
                    <thead className="bg-panel-bg text-left text-xs uppercase tracking-wide text-panel-text-faint">
                      <tr>
                        <th className="border-b border-panel-border px-4 py-3">ID</th>
                        <th className="border-b border-panel-border px-4 py-3">Origen</th>
                        <th className="border-b border-panel-border px-4 py-3">Destino</th>
                        <th className="border-b border-panel-border px-4 py-3">Salida</th>
                        <th className="border-b border-panel-border px-4 py-3">Llegada</th>
                        <th className="border-b border-panel-border px-4 py-3 text-right">Capacidad</th>
                        <th className="border-b border-panel-border px-4 py-3">Tipo</th>
                        <th className="border-b border-panel-border px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFlights.map((flight) => (
                        <tr key={flight.id} className="hover:bg-panel-hover">
                          <td className="border-b border-panel-border px-4 py-3 font-mono">{flight.id}</td>
                          <td className="border-b border-panel-border px-4 py-3 font-mono font-semibold">{flight.origen_iata}</td>
                          <td className="border-b border-panel-border px-4 py-3 font-mono font-semibold">{flight.destino_iata}</td>
                          <td className="border-b border-panel-border px-4 py-3 font-mono">{minutesToTime(flight.salida_minutos)}</td>
                          <td className="border-b border-panel-border px-4 py-3 font-mono">{minutesToTime(flight.llegada_minutos)}</td>
                          <td className="border-b border-panel-border px-4 py-3 text-right">{flight.capacidad_max}</td>
                          <td className="border-b border-panel-border px-4 py-3"><Tag type={flight.mismo_continente ? 'blue' : 'purple'}>{flight.mismo_continente ? 'Continental' : 'Intercontinental'}</Tag></td>
                          <td className="border-b border-panel-border px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" kind="secondary" renderIcon={Edit} onClick={() => openEditFlight(flight)}>Editar</Button>
                              <Button size="sm" kind="danger--tertiary" renderIcon={TrashCan} disabled={busy} onClick={() => removeFlight(flight)}>Eliminar</Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border px-5 py-4 text-sm">
                <span className="text-panel-text-faint">{totalItems} registros · Página {safePage} de {totalPages}</span>
                <div className="flex gap-2">
                  <Button kind="secondary" size="sm" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</Button>
                  <Button kind="secondary" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Siguiente</Button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {modalOpen && section && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto border border-panel-border bg-panel-bg p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-panel-border pb-4">
              <div>
                <h2 className="text-2xl font-semibold">{editingAirport || editingFlight ? 'Editar' : 'Crear'} {section === 'aeropuertos' ? 'aeropuerto' : section === 'tramos' ? 'tramo' : 'vuelo'}</h2>
                <p className="mt-1 text-sm text-panel-text-faint">Los cambios se guardan directamente en MySQL y se recargan en el mapa.</p>
              </div>
              <button type="button" className="text-2xl text-panel-text-faint hover:text-panel-text" onClick={() => setModalOpen(false)}>×</button>
            </div>

            {section === 'aeropuertos' ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Código IATA">
                  <input className={inputClass} maxLength={4} disabled={Boolean(editingAirport)} value={airportForm.iata} onChange={(event) => setAirportForm((form) => ({ ...form, iata: event.target.value.toUpperCase() }))} />
                </Field>
                <Field label="Ciudad"><input className={inputClass} value={airportForm.ciudad} onChange={(event) => setAirportForm((form) => ({ ...form, ciudad: event.target.value }))} /></Field>
                <Field label="País"><input className={inputClass} value={airportForm.pais} onChange={(event) => setAirportForm((form) => ({ ...form, pais: event.target.value }))} /></Field>
                <Field label="Continente">
                  <select className={inputClass} value={airportForm.continente} onChange={(event) => setAirportForm((form) => ({ ...form, continente: event.target.value }))}>
                    <option value="1">América del Sur</option><option value="2">Europa</option><option value="3">Asia</option>
                  </select>
                </Field>
                <Field label="Zona horaria GMT"><input className={inputClass} type="number" min={-12} max={14} value={airportForm.gmt_offset} onChange={(event) => setAirportForm((form) => ({ ...form, gmt_offset: event.target.value }))} /></Field>
                <Field label="Capacidad del almacén"><input className={inputClass} type="number" min={1} value={airportForm.capacidad_almacen} onChange={(event) => setAirportForm((form) => ({ ...form, capacidad_almacen: event.target.value }))} /></Field>
                <Field label="Latitud"><input className={inputClass} type="number" step="0.0000001" min={-90} max={90} value={airportForm.lat} onChange={(event) => setAirportForm((form) => ({ ...form, lat: event.target.value }))} /></Field>
                <Field label="Longitud"><input className={inputClass} type="number" step="0.0000001" min={-180} max={180} value={airportForm.lng} onChange={(event) => setAirportForm((form) => ({ ...form, lng: event.target.value }))} /></Field>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Aeropuerto de origen">
                  <select className={inputClass} value={flightForm.origen_iata} onChange={(event) => setFlightForm((form) => ({ ...form, origen_iata: event.target.value }))}>
                    {aeropuertosBFF.map((airport) => <option key={airport.iata} value={airport.iata}>{airport.iata} — {airport.ciudad}, {airport.pais}</option>)}
                  </select>
                </Field>
                <Field label="Aeropuerto de destino">
                  <select className={inputClass} value={flightForm.destino_iata} onChange={(event) => setFlightForm((form) => ({ ...form, destino_iata: event.target.value }))}>
                    {aeropuertosBFF.map((airport) => <option key={airport.iata} value={airport.iata}>{airport.iata} — {airport.ciudad}, {airport.pais}</option>)}
                  </select>
                </Field>
                <Field label="Hora de salida"><input className={inputClass} type="time" value={flightForm.salida} onChange={(event) => setFlightForm((form) => ({ ...form, salida: event.target.value }))} /></Field>
                <Field label="Hora de llegada"><input className={inputClass} type="time" value={flightForm.llegada} onChange={(event) => setFlightForm((form) => ({ ...form, llegada: event.target.value }))} /></Field>
                <Field label="Capacidad máxima"><input className={inputClass} type="number" min={1} value={flightForm.capacidad_max} onChange={(event) => setFlightForm((form) => ({ ...form, capacidad_max: event.target.value }))} /></Field>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3 border-t border-panel-border pt-4">
              <Button kind="secondary" disabled={busy} onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button disabled={busy} onClick={section === 'aeropuertos' ? submitAirport : submitFlight}>{busy ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
