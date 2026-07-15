import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
  DatePickerInput,
  InlineNotification,
  Pagination,
  Select,
  SelectItem,
  Tag,
} from '@carbon/react';
import { useDomain } from '../context/DomainContext';
import { useSimulation } from '../context/SimulationContext';

type FlightStatus = 'PREPARADO' | 'EN VUELO' | 'FINALIZADO' | 'CANCELADO';

interface FlightOccurrence {
  key: string;
  code: string;
  fecha: string;
  origen: string;
  destino: string;
  salidaLocal: string;
  llegadaLocal: string;
  llegadaLocalDayOffset: number;
  capacidad: number;
  estado: FlightStatus;
  origenIata: string;
  destinoIata: string;
  salidaUTC: number;
  llegadaUTC: number;
}

function formatMinutesAsHHMM(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function getContinentLabel(continent: number | undefined) {
  switch (continent) {
    case 1:
      return 'América del Sur';
    case 2:
      return 'Europa';
    case 3:
      return 'Asia';
    default:
      return 'Sin continente';
  }
}

export function Contingencies() {
  const { vuelosBFF, aeropuertosBFF, isLoading, error } = useDomain();
  const { fase, tiempoSimUTC, simulationTime, cancelarVuelo } = useSimulation();

  const hasActiveSimulation = fase === 'ejecutando' || fase === 'pausado' || fase === 'calentando';
  const referenceTimeMinutes = tiempoSimUTC > 0 ? tiempoSimUTC : Math.floor((simulationTime?.getTime() ?? Date.now()) / 60000);

  const initialDate = useMemo(() => {
    const base = simulationTime && !Number.isNaN(simulationTime.getTime()) && hasActiveSimulation
      ? simulationTime
      : new Date();
    const next = new Date(base);
    next.setHours(12, 0, 0, 0);
    return next;
  }, [hasActiveSimulation, simulationTime]);

  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [flightCodeFilter, setFlightCodeFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('todos');
  const [destinationFilter, setDestinationFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedAirportIata, setSelectedAirportIata] = useState<string | null>(null);
  const [pendingCancellationKey, setPendingCancellationKey] = useState<string | null>(null);
  const [cancelledKeys, setCancelledKeys] = useState<Set<string>>(new Set());
  const [confirmationRow, setConfirmationRow] = useState<FlightOccurrence | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; title: string; detail: string } | null>(null);
  const hasManualDateSelectionRef = useRef(false);
  const wasActiveRef = useRef(hasActiveSimulation);

  useEffect(() => {
    setPage(1);
  }, [selectedDate, flightCodeFilter, originFilter, destinationFilter, statusFilter, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [selectedAirportIata]);

  useEffect(() => {
    if (hasManualDateSelectionRef.current || !hasActiveSimulation || !simulationTime) {
      wasActiveRef.current = hasActiveSimulation;
      return;
    }

    if (!wasActiveRef.current) {
      const next = new Date(simulationTime);
      next.setHours(12, 0, 0, 0);
      setSelectedDate((current) => {
        const currentKey = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`;
        const nextKey = `${next.getFullYear()}-${next.getMonth()}-${next.getDate()}`;
        return currentKey === nextKey ? current : next;
      });
    }

    wasActiveRef.current = hasActiveSimulation;
  }, [hasActiveSimulation, simulationTime]);

  const resetToToday = () => {
    hasManualDateSelectionRef.current = true;
    const next = new Date(initialDate);
    next.setHours(12, 0, 0, 0);
    setSelectedDate(next);
  };

  const occurrences = useMemo<FlightOccurrence[]>(() => {
    const selectedDateValue = formatDateValue(selectedDate);
    const selectedDateMinutes = Math.floor(Date.UTC(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      0,
      0,
      0,
    ) / 60000);

    return vuelosBFF.flatMap((vuelo) => {
      const origin = aeropuertosBFF.find((item) => item.iata === vuelo.origen_iata);
      const destination = aeropuertosBFF.find((item) => item.iata === vuelo.destino_iata);

      if (!origin || !destination) {
        return [];
      }

      const salidaUTC = selectedDateMinutes + vuelo.salida_minutos - origin.gmt_offset * 60;
      let llegadaUTC = selectedDateMinutes + vuelo.llegada_minutos - destination.gmt_offset * 60;
      while (llegadaUTC <= salidaUTC) {
        llegadaUTC += 1440;
      }

      const key = `${vuelo.id}-${selectedDateValue}-${salidaUTC}`;
      const isCancelled = cancelledKeys.has(key);
      let estado: FlightStatus = 'PREPARADO';

      if (isCancelled) {
        estado = 'CANCELADO';
      } else if (referenceTimeMinutes < salidaUTC) {
        estado = 'PREPARADO';
      } else if (referenceTimeMinutes < llegadaUTC) {
        estado = 'EN VUELO';
      } else {
        estado = 'FINALIZADO';
      }

      const departureLocalDate = new Date((salidaUTC + origin.gmt_offset * 60) * 60000);
      const arrivalLocalDate = new Date((llegadaUTC + destination.gmt_offset * 60) * 60000);

      const departureCalendarDate = new Date(Date.UTC(
        departureLocalDate.getUTCFullYear(),
        departureLocalDate.getUTCMonth(),
        departureLocalDate.getUTCDate(),
      ));
      const arrivalCalendarDate = new Date(Date.UTC(
        arrivalLocalDate.getUTCFullYear(),
        arrivalLocalDate.getUTCMonth(),
        arrivalLocalDate.getUTCDate(),
      ));
      const dayOffset = Math.floor((arrivalCalendarDate.getTime() - departureCalendarDate.getTime()) / 86400000);

      return [{
        key,
        code: `${vuelo.origen_iata}-${vuelo.destino_iata}-${formatMinutesAsHHMM(vuelo.salida_minutos).replace(':', '')}`,
        fecha: selectedDateValue,
        origen: vuelo.origen_iata,
        destino: vuelo.destino_iata,
        salidaLocal: formatMinutesAsHHMM(vuelo.salida_minutos),
        llegadaLocal: formatMinutesAsHHMM(vuelo.llegada_minutos),
        llegadaLocalDayOffset: dayOffset,
        capacidad: vuelo.capacidad_max,
        estado,
        origenIata: vuelo.origen_iata,
        destinoIata: vuelo.destino_iata,
        salidaUTC,
        llegadaUTC,
      }];
    });
  }, [aeropuertosBFF, cancelledKeys, referenceTimeMinutes, selectedDate, vuelosBFF]);

  const filteredOccurrences = useMemo(() => {
    const normalizedCode = flightCodeFilter.trim().toUpperCase();

    return occurrences.filter((row) => {
      const byCode = !normalizedCode || `${row.code} ${row.origen} ${row.destino}`.toUpperCase().includes(normalizedCode);
      const byOrigin = originFilter === 'todos' || row.origen === originFilter;
      const byDestination = destinationFilter === 'todos' || row.destino === destinationFilter;
      const byStatus = statusFilter === 'todos' || row.estado === statusFilter.toUpperCase();
      return byCode && byOrigin && byDestination && byStatus;
    }).sort((a, b) => a.salidaUTC - b.salidaUTC);
  }, [flightCodeFilter, originFilter, destinationFilter, occurrences, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOccurrences.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedOccurrences = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredOccurrences.slice(start, start + pageSize);
  }, [filteredOccurrences, pageSize, safePage]);

  const summary = useMemo(() => {
    return {
      total: filteredOccurrences.length,
      preparado: filteredOccurrences.filter((item) => item.estado === 'PREPARADO').length,
      enVuelo: filteredOccurrences.filter((item) => item.estado === 'EN VUELO').length,
      finalizado: filteredOccurrences.filter((item) => item.estado === 'FINALIZADO').length,
      cancelado: filteredOccurrences.filter((item) => item.estado === 'CANCELADO').length,
    };
  }, [filteredOccurrences]);

  const continentGroups = useMemo(() => {
    const airportStats = new Map<string, {
      iata: string;
      ciudad: string;
      pais: string;
      continente: number;
      vuelos: number;
      preparado: number;
      enVuelo: number;
      finalizado: number;
      cancelado: number;
    }>();

    aeropuertosBFF.forEach((airport) => {
      airportStats.set(airport.iata, {
        iata: airport.iata,
        ciudad: airport.ciudad,
        pais: airport.pais,
        continente: airport.continente,
        vuelos: 0,
        preparado: 0,
        enVuelo: 0,
        finalizado: 0,
        cancelado: 0,
      });
    });

    filteredOccurrences.forEach((occurrence) => {
      const stats = airportStats.get(occurrence.origen);
      if (!stats) {
        return;
      }

      stats.vuelos += 1;

      if (occurrence.estado === 'PREPARADO') {
        stats.preparado += 1;
      } else if (occurrence.estado === 'EN VUELO') {
        stats.enVuelo += 1;
      } else if (occurrence.estado === 'FINALIZADO') {
        stats.finalizado += 1;
      } else if (occurrence.estado === 'CANCELADO') {
        stats.cancelado += 1;
      }
    });

    const groups = new Map<number, {
      continent: number;
      label: string;
      airports: typeof airportStats extends Map<string, infer T> ? T[] : never;
    }>();

    airportStats.forEach((stats) => {
      const group = groups.get(stats.continente) ?? {
        continent: stats.continente,
        label: getContinentLabel(stats.continente),
        airports: [],
      };
      group.airports.push(stats);
      groups.set(stats.continente, group);
    });

    return Array.from(groups.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((group) => ({
        ...group,
        airports: group.airports.sort((a, b) => a.iata.localeCompare(b.iata)),
      }));
  }, [aeropuertosBFF, filteredOccurrences]);

  const selectedAirportDetails = useMemo(() => {
    if (!selectedAirportIata) {
      return null;
    }

    return aeropuertosBFF.find((airport) => airport.iata === selectedAirportIata) ?? null;
  }, [aeropuertosBFF, selectedAirportIata]);

  const airportDetailOccurrences = useMemo(() => {
    if (!selectedAirportIata) {
      return [];
    }

    return [...filteredOccurrences]
      .filter((occurrence) => occurrence.origen === selectedAirportIata)
      .sort((a, b) => a.salidaUTC - b.salidaUTC);
  }, [filteredOccurrences, selectedAirportIata]);

  const airportDetailTotalPages = Math.max(1, Math.ceil(airportDetailOccurrences.length / pageSize));
  const airportDetailSafePage = Math.min(page, airportDetailTotalPages);
  const paginatedAirportDetailOccurrences = useMemo(() => {
    const start = (airportDetailSafePage - 1) * pageSize;
    return airportDetailOccurrences.slice(start, start + pageSize);
  }, [airportDetailOccurrences, airportDetailSafePage, pageSize]);

  const handleSelectAirport = (iata: string) => {
    setSelectedAirportIata(iata);
    setPage(1);
  };

  const handleBackToContinents = () => {
    setSelectedAirportIata(null);
    setPage(1);
  };

  const handleCancelConfirm = async () => {
    if (!confirmationRow || !hasActiveSimulation) {
      return;
    }

    setPendingCancellationKey(confirmationRow.key);
    setFeedback(null);

    const ok = await cancelarVuelo(confirmationRow.origenIata, confirmationRow.destinoIata, confirmationRow.salidaUTC);

    if (ok) {
      setCancelledKeys((prev) => new Set(prev).add(confirmationRow.key));
      setFeedback({
        kind: 'success',
        title: 'Cancelación confirmada',
        detail: `${confirmationRow.code} quedó marcada como cancelada.`,
      });
    } else {
      setFeedback({
        kind: 'error',
        title: 'No se pudo cancelar',
        detail: 'La operación no fue confirmada por el backend.',
      });
    }

    setPendingCancellationKey(null);
    setConfirmationRow(null);
  };

  const statusLabel = (status: FlightStatus) => {
    switch (status) {
      case 'PREPARADO': return 'Preparado';
      case 'EN VUELO': return 'En vuelo';
      case 'FINALIZADO': return 'Finalizado';
      case 'CANCELADO': return 'Cancelado';
      default: return status;
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel-bg text-panel-text">
      <div className="flex-shrink-0 border-b border-panel-border bg-panel-bg p-6">
        <h1 className="text-2xl font-semibold text-panel-text">Vuelos y cancelaciones</h1>
        <p className="mt-1 text-sm text-panel-text-faint">
          Consulta las ocurrencias programadas y cancela vuelos antes de su salida.
        </p>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <div className="flex h-full flex-col gap-4 overflow-hidden rounded-lg border border-panel-border bg-panel-bg-subtle p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <div>
              <DatePicker datePickerType="single" value={formatDateValue(selectedDate)} onChange={(dates) => {
                const nextDate = dates[0];
                if (nextDate) {
                  hasManualDateSelectionRef.current = true;
                  setSelectedDate(new Date(nextDate));
                }
              }}>
                <DatePickerInput id="selected-date" labelText="Fecha" />
              </DatePicker>
            </div>
            <div className="flex items-end">
              <Button kind="secondary" onClick={resetToToday}>Hoy simulado</Button>
            </div>
            <div className="flex items-end">
              <Button kind="secondary" aria-label="Búsqueda especializada" disabled>
                Búsqueda especializada
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Tag type="gray">Total: {summary.total}</Tag>
            <Tag type="green">Preparados: {summary.preparado}</Tag>
            <Tag type="blue">En vuelo: {summary.enVuelo}</Tag>
            <Tag type="purple">Finalizados: {summary.finalizado}</Tag>
            <Tag type="red">Cancelados: {summary.cancelado}</Tag>
          </div>

          {!hasActiveSimulation && (
            <InlineNotification
              kind="info"
              lowContrast
              title="No hay una simulación activa"
              subtitle="Inicia Periodo o Colapso para cancelar vuelos."
            />
          )}

          {isLoading && (
            <InlineNotification kind="info" lowContrast title="Cargando vuelos" subtitle="Se están consultando los vuelos reales del BFF." />
          )}

          {error && (
            <InlineNotification kind="error" lowContrast title="No se pudieron cargar los vuelos" subtitle={error} />
          )}

          <div className="flex-1 overflow-auto rounded-lg border border-panel-border bg-panel-bg">
            {selectedAirportIata && selectedAirportDetails ? (
              <div className="flex h-full flex-col p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-panel-border pb-4">
                  <div className="min-w-0">
                    <nav aria-label="Breadcrumb" className="mb-2 text-sm text-panel-text-faint">
                      <span className="font-medium text-panel-text">Continentes</span>
                      <span className="mx-2">/</span>
                      <span>{getContinentLabel(selectedAirportDetails.continente)}</span>
                      <span className="mx-2">/</span>
                      <span className="font-medium text-panel-text">{selectedAirportDetails.iata}</span>
                    </nav>
                    <h2 className="text-lg font-semibold text-panel-text">{selectedAirportDetails.iata}</h2>
                    <p className="mt-1 text-sm text-panel-text-faint">
                      {selectedAirportDetails.ciudad} · {selectedAirportDetails.pais} · {getContinentLabel(selectedAirportDetails.continente)}
                    </p>
                  </div>
                  <Button kind="secondary" size="sm" onClick={handleBackToContinents}>Volver a continentes</Button>
                </div>

                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle p-4">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">IATA</p>
                    <p className="mt-1 font-semibold text-panel-text">{selectedAirportDetails.iata}</p>
                  </div>
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle p-4">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">Ciudad</p>
                    <p className="mt-1 font-semibold text-panel-text">{selectedAirportDetails.ciudad}</p>
                  </div>
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle p-4">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">País</p>
                    <p className="mt-1 font-semibold text-panel-text">{selectedAirportDetails.pais}</p>
                  </div>
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle p-4">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">Vuelos de salida</p>
                    <p className="mt-1 font-semibold text-panel-text">{airportDetailOccurrences.length}</p>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-panel-border bg-panel-bg">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-panel-bg-subtle text-left text-xs uppercase tracking-wide text-panel-text-faint">
                      <tr>
                        <th className="border-b border-panel-border px-4 py-3">Código</th>
                        <th className="border-b border-panel-border px-4 py-3">Fecha</th>
                        <th className="border-b border-panel-border px-4 py-3">Origen</th>
                        <th className="border-b border-panel-border px-4 py-3">Destino</th>
                        <th className="border-b border-panel-border px-4 py-3">Salida local</th>
                        <th className="border-b border-panel-border px-4 py-3">Llegada local</th>
                        <th className="border-b border-panel-border px-4 py-3">Capacidad</th>
                        <th className="border-b border-panel-border px-4 py-3">Estado</th>
                        <th className="border-b border-panel-border px-4 py-3">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedAirportDetailOccurrences.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-panel-text-faint">
                            No hay vuelos de salida para este aeropuerto en la fecha seleccionada.
                          </td>
                        </tr>
                      ) : (
                        paginatedAirportDetailOccurrences.map((row) => {
                          const canCancel = hasActiveSimulation && row.estado === 'PREPARADO' && !pendingCancellationKey;
                          return (
                            <tr key={row.key} className="border-b border-panel-border last:border-b-0 hover:bg-panel-hover">
                              <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                              <td className="px-4 py-3">{formatDateLabel(selectedDate)}</td>
                              <td className="px-4 py-3">{row.origen}</td>
                              <td className="px-4 py-3">{row.destino}</td>
                              <td className="px-4 py-3">{row.salidaLocal}</td>
                              <td className="px-4 py-3">
                                {row.llegadaLocal}
                                {row.llegadaLocalDayOffset > 0 ? ` (+${row.llegadaLocalDayOffset} día${row.llegadaLocalDayOffset > 1 ? 's' : ''})` : ''}
                              </td>
                              <td className="px-4 py-3">{row.capacidad}</td>
                              <td className="px-4 py-3"><Tag type={row.estado === 'CANCELADO' ? 'red' : row.estado === 'EN VUELO' ? 'blue' : row.estado === 'FINALIZADO' ? 'purple' : 'green'}>{statusLabel(row.estado)}</Tag></td>
                              <td className="px-4 py-3">
                                <Button
                                  size="sm"
                                  kind="danger"
                                  disabled={!canCancel}
                                  onClick={() => setConfirmationRow(row)}
                                >
                                  Cancelar
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex justify-end">
                  <Pagination
                    totalItems={airportDetailOccurrences.length}
                    page={airportDetailSafePage}
                    pageSize={pageSize}
                    pageSizes={[25, 50, 100]}
                    itemsPerPageText="Registros por página"
                    pageRangeText={(current, total) => `${current}–${total}`}
                    pageText={(pageNumber) => `Página ${pageNumber}`}
                    onChange={(event) => {
                      setPage(event.page);
                      setPageSize(event.pageSize);
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-4 p-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,680px),1fr))]">
                {continentGroups.length === 0 ? (
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle p-6 text-center text-sm text-panel-text-faint">
                    No hay aeropuertos con datos disponibles para este día.
                  </div>
                ) : (
                  continentGroups.map((group) => (
                    <section key={group.continent} className="min-w-0 overflow-hidden rounded-lg border border-panel-border bg-panel-bg-subtle">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-border px-4 py-3">
                        <div>
                          <h2 className="text-base font-semibold text-panel-text">{group.label}</h2>
                          <p className="text-xs uppercase tracking-wide text-panel-text-faint">
                            {group.airports.length} aeropuertos
                          </p>
                        </div>
                        <Tag type="gray">{group.airports.length} aeropuertos</Tag>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse text-sm">
                          <thead className="bg-panel-bg text-left text-xs uppercase tracking-wide text-panel-text-faint">
                            <tr>
                              <th className="border-b border-panel-border px-4 py-3">IATA</th>
                              <th className="border-b border-panel-border px-4 py-3">Ciudad</th>
                              <th className="border-b border-panel-border px-4 py-3">País</th>
                              <th className="border-b border-panel-border px-4 py-3">Vuelos</th>
                              <th className="border-b border-panel-border px-4 py-3">Preparados</th>
                              <th className="border-b border-panel-border px-4 py-3">En vuelo</th>
                              <th className="border-b border-panel-border px-4 py-3">Finalizados</th>
                              <th className="border-b border-panel-border px-4 py-3">Cancelados</th>
                              <th className="border-b border-panel-border px-4 py-3">Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.airports.map((airport) => (
                              <tr
                                key={airport.iata}
                                tabIndex={0}
                                role="button"
                                className="cursor-pointer border-b border-panel-border last:border-b-0 hover:bg-panel-hover"
                                onClick={() => handleSelectAirport(airport.iata)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    handleSelectAirport(airport.iata);
                                  }
                                }}
                              >
                                <td className="px-4 py-3 font-mono text-xs">{airport.iata}</td>
                                <td className="px-4 py-3">{airport.ciudad}</td>
                                <td className="px-4 py-3">{airport.pais}</td>
                                <td className="px-4 py-3">{airport.vuelos}</td>
                                <td className="px-4 py-3">{airport.preparado}</td>
                                <td className="px-4 py-3">{airport.enVuelo}</td>
                                <td className="px-4 py-3">{airport.finalizado}</td>
                                <td className="px-4 py-3">{airport.cancelado}</td>
                                <td className="px-4 py-3">
                                  <Button
                                    size="sm"
                                    kind="secondary"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleSelectAirport(airport.iata);
                                    }}
                                  >
                                    Ver vuelos
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmationRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg border border-panel-border bg-panel-bg p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-panel-text">Confirmar cancelación</h2>
            <p className="mt-2 text-sm text-panel-text-faint">Se cancelará la ocurrencia seleccionada antes de su salida.</p>
            <div className="mt-4 rounded-lg border border-panel-border bg-panel-bg-subtle p-4 text-sm">
              <div className="grid gap-2 md:grid-cols-2">
                <div><span className="text-panel-text-faint">Código:</span> {confirmationRow.code}</div>
                <div><span className="text-panel-text-faint">Fecha:</span> {confirmationRow.fecha}</div>
                <div><span className="text-panel-text-faint">Origen:</span> {confirmationRow.origen}</div>
                <div><span className="text-panel-text-faint">Destino:</span> {confirmationRow.destino}</div>
                <div><span className="text-panel-text-faint">Salida local:</span> {confirmationRow.salidaLocal}</div>
                <div><span className="text-panel-text-faint">Salida UTC:</span> {confirmationRow.salidaUTC}</div>
              </div>
              <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">
                La cancelación provocará la replanificación de las maletas asignadas.
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button kind="secondary" onClick={() => setConfirmationRow(null)}>Cancelar</Button>
              <Button kind="danger" onClick={handleCancelConfirm} disabled={pendingCancellationKey === confirmationRow.key}>
                {pendingCancellationKey === confirmationRow.key ? 'Cancelando…' : 'Confirmar cancelación'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div className="fixed bottom-4 right-4 z-[110] max-w-md">
          <InlineNotification kind={feedback.kind} lowContrast title={feedback.title} subtitle={feedback.detail} />
        </div>
      )}
    </div>
  );
}
