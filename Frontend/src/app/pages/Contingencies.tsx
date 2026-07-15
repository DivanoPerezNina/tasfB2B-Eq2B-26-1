import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  DatePickerInput,
  InlineNotification,
  Pagination,
  Select,
  SelectItem,
  Tag,
  TextInput,
} from '@carbon/react';
import { useDomain } from '../context/DomainContext';
import { useSimulation } from '../context/SimulationContext';

type FlightStatus = 'PREPARADO' | 'EN VUELO' | 'FINALIZADO' | 'CANCELADO';
type ViewMode = 'continents' | 'airport' | 'search';
type DetailTableFilter = 'ALL' | 'PREPARADO' | 'FINALIZADO' | 'CANCELADO';


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

interface SearchFilters {
  continent: 'todos' | 1 | 2 | 3;
  originCountry: string;
  originAirport: string;
  destinationAirport: string;
  codeOrRoute: string;
  departureTimeFrom: string;
  departureTimeTo: string;
  status: 'todos' | 'PREPARADO' | 'EN VUELO' | 'FINALIZADO' | 'CANCELADO';
}

const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  continent: 'todos',
  originCountry: '',
  originAirport: '',
  destinationAirport: '',
  codeOrRoute: '',
  departureTimeFrom: '',
  departureTimeTo: '',
  status: 'todos',
};

function parseHHMMToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
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

const FLIGHT_STATUS_ORDER: Record<FlightStatus, number> = {
  PREPARADO: 0,
  'EN VUELO': 1,
  FINALIZADO: 2,
  CANCELADO: 3,
};

function compareOccurrencesForAction(a: FlightOccurrence, b: FlightOccurrence) {
  const byStatus = FLIGHT_STATUS_ORDER[a.estado] - FLIGHT_STATUS_ORDER[b.estado];
  return byStatus !== 0 ? byStatus : a.salidaUTC - b.salidaUTC;
}

function formatSimulationMoment(epochMinutes: number) {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(epochMinutes * 60 * 1000));
}

function formatUtcTableValue(epochMinutes: number) {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(epochMinutes * 60 * 1000));
}

function formatUtcDate(epochMinutes: number) {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(epochMinutes * 60 * 1000));
}

function formatUtcTime(epochMinutes: number) {
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(epochMinutes * 60 * 1000));
}

export function Contingencies() {
  const { vuelosBFF, aeropuertosBFF, isLoading, error } = useDomain();
  const {
    fase,
    tiempoSimUTC,
    simulationTime,
    cancelarVuelo,
    registrarCancelacionVisual,
    visualCancellations,
    config,
    lastValidTick,
  } = useSimulation();

  const hasActiveSimulation = fase === 'ejecutando' || fase === 'pausado' || fase === 'calentando';
  const hasCancelablePeriodSimulation =
    config.scenario === 'period' && (fase === 'ejecutando' || fase === 'pausado');
  const lastValidSimulationMinute = lastValidTick?.tiempo_sim_utc;
  const referenceTimeMinutes =
    typeof lastValidSimulationMinute === 'number' &&
    Number.isFinite(lastValidSimulationMinute) &&
    lastValidSimulationMinute > 0
      ? lastValidSimulationMinute
      : tiempoSimUTC > 0
        ? tiempoSimUTC
        : Math.floor(simulationTime.getTime() / 60000);
  const hasValidSimulationTime = Number.isFinite(referenceTimeMinutes) && referenceTimeMinutes > 0;

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
  const [viewMode, setViewMode] = useState<ViewMode>('continents');
  const [detailFilter, setDetailFilter] = useState<DetailTableFilter>('ALL');

  const [searchPage, setSearchPage] = useState(1);
  const [searchPageSize, setSearchPageSize] = useState(25);
  const [pendingCancellationKey, setPendingCancellationKey] = useState<string | null>(null);
  const [cancelledKeys, setCancelledKeys] = useState<Set<string>>(new Set());
  const [confirmationRow, setConfirmationRow] = useState<FlightOccurrence | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; title: string; detail: string } | null>(null);
  const [isDateFilterApplied, setIsDateFilterApplied] = useState(false);

  // Search modal state
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<SearchFilters>({ ...DEFAULT_SEARCH_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState<SearchFilters>({ ...DEFAULT_SEARCH_FILTERS });

  useEffect(() => {
    setPage(1);
  }, [selectedDate, flightCodeFilter, originFilter, destinationFilter, statusFilter, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [selectedAirportIata]);

  useEffect(() => {
    setPage(1);
  }, [detailFilter]);


  useEffect(() => {
    setSearchPage(1);
  }, [appliedFilters, searchPageSize]);

  useEffect(() => {
    if (isDateFilterApplied || !hasActiveSimulation || !simulationTime) {
      return;
    }

    const next = new Date(simulationTime);
    next.setHours(12, 0, 0, 0);
    setSelectedDate((current) => {
      const currentKey = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`;
      const nextKey = `${next.getFullYear()}-${next.getMonth()}-${next.getDate()}`;
      return currentKey === nextKey ? current : next;
    });
  }, [hasActiveSimulation, isDateFilterApplied, simulationTime]);

  const clearDateFilter = () => {
    const base = hasActiveSimulation && simulationTime && !Number.isNaN(simulationTime.getTime())
      ? simulationTime
      : initialDate;
    const next = new Date(base);
    next.setHours(12, 0, 0, 0);
    setIsDateFilterApplied(false);
    setSelectedDate(next);
    setSelectedAirportIata(null);
    setViewMode('continents');
    setDetailFilter('ALL');
    setPage(1);
    setSearchPage(1);
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
      const isCancelled = cancelledKeys.has(key) || visualCancellations.some((item) => (
        item.origen === vuelo.origen_iata
        && item.destino === vuelo.destino_iata
        && item.salidaUTC === salidaUTC
      ));
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
  }, [aeropuertosBFF, cancelledKeys, referenceTimeMinutes, selectedDate, visualCancellations, vuelosBFF]);

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

  // Search modal computed values
  const availableCountries = useMemo(() => {
    const countriesSet = new Set<string>();
    aeropuertosBFF.forEach((airport) => {
      if (draftFilters.continent === 'todos' || airport.continente === draftFilters.continent) {
        countriesSet.add(airport.pais);
      }
    });
    return Array.from(countriesSet).sort();
  }, [aeropuertosBFF, draftFilters.continent]);

  const availableOriginAirports = useMemo(() => {
    const airportsArray = aeropuertosBFF.filter((airport) => {
      const continentMatch = draftFilters.continent === 'todos' || airport.continente === draftFilters.continent;
      const countryMatch = !draftFilters.originCountry || airport.pais === draftFilters.originCountry;
      return continentMatch && countryMatch;
    });
    return airportsArray.sort((a, b) => a.iata.localeCompare(b.iata));
  }, [aeropuertosBFF, draftFilters.continent, draftFilters.originCountry]);

  const availableDestinationAirports = useMemo(
    () => [...aeropuertosBFF].sort((a, b) => a.iata.localeCompare(b.iata)),
    [aeropuertosBFF],
  );

  const airportByIata = useMemo(
    () => new Map(aeropuertosBFF.map((airport) => [airport.iata, airport] as const)),
    [aeropuertosBFF],
  );

  const searchResults = useMemo(() => {
    const normalizedQuery = appliedFilters.codeOrRoute.trim().toUpperCase();
    const fromMinutes = appliedFilters.departureTimeFrom
      ? parseHHMMToMinutes(appliedFilters.departureTimeFrom)
      : null;
    const toMinutes = appliedFilters.departureTimeTo
      ? parseHHMMToMinutes(appliedFilters.departureTimeTo)
      : null;

    return occurrences
      .filter((occurrence) => {
        const originAirport = airportByIata.get(occurrence.origen);
        if (!originAirport) {
          return false;
        }

        const byContinent = appliedFilters.continent === 'todos'
          || originAirport.continente === appliedFilters.continent;
        const byCountry = !appliedFilters.originCountry
          || originAirport.pais === appliedFilters.originCountry;
        const byOrigin = !appliedFilters.originAirport
          || occurrence.origen === appliedFilters.originAirport;
        const byDestination = !appliedFilters.destinationAirport
          || occurrence.destino === appliedFilters.destinationAirport;
        const byStatus = appliedFilters.status === 'todos'
          || occurrence.estado === appliedFilters.status;

        const searchableText = [
          occurrence.code,
          occurrence.origen,
          occurrence.destino,
          `${occurrence.origen}-${occurrence.destino}`,
        ].join(' ').toUpperCase();
        const byCodeOrRoute = !normalizedQuery || searchableText.includes(normalizedQuery);

        const departureMinutes = parseHHMMToMinutes(occurrence.salidaLocal);
        let byTime = true;
        if (fromMinutes !== null && toMinutes !== null) {
          byTime = fromMinutes <= toMinutes
            ? departureMinutes >= fromMinutes && departureMinutes <= toMinutes
            : departureMinutes >= fromMinutes || departureMinutes <= toMinutes;
        } else if (fromMinutes !== null) {
          byTime = departureMinutes >= fromMinutes;
        } else if (toMinutes !== null) {
          byTime = departureMinutes <= toMinutes;
        }

        return byContinent
          && byCountry
          && byOrigin
          && byDestination
          && byStatus
          && byCodeOrRoute
          && byTime;
      })
      .sort(compareOccurrencesForAction);
  }, [airportByIata, appliedFilters, occurrences]);

  const searchTotalPages = Math.max(1, Math.ceil(searchResults.length / searchPageSize));
  const searchSafePage = Math.min(searchPage, searchTotalPages);
  const paginatedSearchResults = useMemo(() => {
    const start = (searchSafePage - 1) * searchPageSize;
    return searchResults.slice(start, start + searchPageSize);
  }, [searchPageSize, searchResults, searchSafePage]);


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
      .sort((a, b) => a.continent - b.continent)
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
      .sort(compareOccurrencesForAction);
  }, [filteredOccurrences, selectedAirportIata]);

  const airportDetailSummary = useMemo(() => ({
    preparado: airportDetailOccurrences.filter((row) => row.estado === 'PREPARADO').length,
    finalizado: airportDetailOccurrences.filter((row) => row.estado === 'FINALIZADO').length,
    cancelado: airportDetailOccurrences.filter((row) => row.estado === 'CANCELADO').length,
  }), [airportDetailOccurrences]);

  const airportFilteredDetailOccurrences = useMemo(() => {
    switch (detailFilter) {
      case 'PREPARADO':
        return airportDetailOccurrences.filter((row) => row.estado === 'PREPARADO');
      case 'FINALIZADO':
        return airportDetailOccurrences.filter((row) => row.estado === 'FINALIZADO');
      case 'CANCELADO':
        return airportDetailOccurrences.filter((row) => row.estado === 'CANCELADO');
      default:
        return airportDetailOccurrences;
    }
  }, [airportDetailOccurrences, detailFilter]);

  const airportDetailTotalPages = Math.max(1, Math.ceil(airportFilteredDetailOccurrences.length / pageSize));
  const airportDetailSafePage = Math.min(page, airportDetailTotalPages);
  const paginatedAirportDetailOccurrences = useMemo(() => {
    const start = (airportDetailSafePage - 1) * pageSize;
    return airportFilteredDetailOccurrences.slice(start, start + pageSize);
  }, [airportFilteredDetailOccurrences, airportDetailSafePage, pageSize]);


  const handleSelectAirport = (iata: string) => {
    setSelectedAirportIata(iata);
    setViewMode('airport');
    setDetailFilter('ALL');
    setPage(1);
  };


  const handleBackToContinents = () => {
    setSelectedAirportIata(null);
    setViewMode('continents');
    setDetailFilter('ALL');
    setPage(1);
    setSearchPage(1);
  };


  const openSearchModal = () => {
    setDraftFilters({ ...appliedFilters });
    setIsSearchModalOpen(true);
  };


  const applySearchFilters = () => {
    setAppliedFilters({ ...draftFilters });
    setSelectedAirportIata(null);
    setSearchPage(1);
    setViewMode('search');
    setIsSearchModalOpen(false);
  };

  const clearSearchFilters = () => {
    setDraftFilters({ ...DEFAULT_SEARCH_FILTERS });
  };

  const clearAppliedSearch = () => {
    setAppliedFilters({ ...DEFAULT_SEARCH_FILTERS });
    setDraftFilters({ ...DEFAULT_SEARCH_FILTERS });
    setSelectedAirportIata(null);
    setSearchPage(1);
    setViewMode('continents');
  };

  const cancelSearchModal = () => {
    setDraftFilters({ ...appliedFilters });
    setIsSearchModalOpen(false);
  };

  const canCancelOccurrence = (row: FlightOccurrence) =>
    hasCancelablePeriodSimulation &&
    hasValidSimulationTime &&
    row.estado === 'PREPARADO' &&
    row.salidaUTC > referenceTimeMinutes &&
    !cancelledKeys.has(row.key) &&
    pendingCancellationKey === null;

  const handleCancelConfirm = async () => {
    if (!confirmationRow || !canCancelOccurrence(confirmationRow)) {
      setFeedback({
        kind: 'info',
        title: 'Cancelación no disponible',
        detail: 'El vuelo ya no está preparado o no existe una simulación de Periodo ejecutándose o pausada.',
      });
      setConfirmationRow(null);
      return;
    }

    setPendingCancellationKey(confirmationRow.key);
    setFeedback(null);

    const ok = await cancelarVuelo(confirmationRow.origenIata, confirmationRow.destinoIata, confirmationRow.salidaUTC);

    if (ok) {
      setCancelledKeys((prev) => new Set(prev).add(confirmationRow.key));
      registrarCancelacionVisual({
        id: confirmationRow.key,
        origen: confirmationRow.origenIata,
        destino: confirmationRow.destinoIata,
        salidaUTC: confirmationRow.salidaUTC,
        llegadaUTC: confirmationRow.llegadaUTC,
        createdAtUTC: referenceTimeMinutes,
      });
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
      <header className="flex-shrink-0 border-b border-panel-border bg-panel-bg px-6 py-5">
        <div className="mx-auto w-full max-w-[1760px]">
          <h1 className="text-3xl font-semibold tracking-tight text-panel-text">Vuelos y cancelaciones</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-panel-text-faint">
            Consulta la programación por continente y cancela ocurrencias futuras antes de su salida.
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="mx-auto flex h-full w-full max-w-[1760px] flex-col gap-5 overflow-hidden">
          {viewMode !== 'airport' && (
            <section className="flex-shrink-0 rounded-xl border border-panel-border bg-panel-bg-subtle p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full min-w-[280px] max-w-[340px]">
                    <DatePicker datePickerType="single" value={formatDateValue(selectedDate)} onChange={(dates) => {
                      const nextDate = dates[0];
                      if (nextDate) {
                        setIsDateFilterApplied(true);
                        setSelectedDate(new Date(nextDate));
                        setSelectedAirportIata(null);
                        setViewMode('continents');
                        setPage(1);
                        setSearchPage(1);
                      }
                    }}>
                      <DatePickerInput id="selected-date" labelText="Filtrar por fecha" />
                    </DatePicker>
                  </div>

                  {isDateFilterApplied && (
                    <div className="inline-flex h-10 items-center gap-2 rounded-full border border-blue-500/50 bg-blue-500/10 px-4 text-sm text-panel-text">
                      <span>Filtro aplicado: <strong>{formatDateLabel(selectedDate)}</strong></span>
                      <button
                        type="button"
                        aria-label="Quitar filtro de fecha"
                        title="Quitar filtro de fecha"
                        className="flex h-6 w-6 items-center justify-center rounded-full text-lg leading-none text-panel-text-faint transition-colors hover:bg-panel-hover hover:text-panel-text"
                        onClick={clearDateFilter}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                <Button
                  type="button"
                  kind="secondary"
                  size="sm"
                  aria-label="Abrir búsqueda especializada"
                  aria-expanded={isSearchModalOpen}
                  onClick={openSearchModal}
                >
                  Búsqueda especializada
                </Button>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-panel-border pt-5">
                <Tag type="gray">Total: {summary.total}</Tag>
                <Tag type="green">Preparados: {summary.preparado}</Tag>
                <Tag type="blue">En vuelo: {summary.enVuelo}</Tag>
                <Tag type="purple">Finalizados: {summary.finalizado}</Tag>
                <Tag type="red">Cancelados: {summary.cancelado}</Tag>
                {hasValidSimulationTime && (
                  <span className="ml-auto text-xs text-panel-text-faint">
                    Hora simulada global: <strong className="font-medium text-panel-text">{formatSimulationMoment(referenceTimeMinutes)} UTC</strong>
                  </span>
                )}
              </div>
            </section>
          )}


          {viewMode !== 'airport' && !hasCancelablePeriodSimulation && (
            <div className="max-w-3xl flex-shrink-0">
              <InlineNotification
                kind="info"
                lowContrast
                title="Cancelación no disponible"
                subtitle={
                  config.scenario !== 'period'
                    ? 'Inicia una simulación de Periodo (3D, 5D o 7D) para cancelar vuelos.'
                    : fase === 'calentando'
                      ? 'Espera a que termine el calentamiento de la simulación de Periodo.'
                      : 'Ejecuta o pausa la simulación de Periodo para cancelar vuelos preparados.'
                }
              />
            </div>
          )}

          {isLoading && (
            <InlineNotification kind="info" lowContrast title="Cargando vuelos" subtitle="Se están consultando los vuelos reales del BFF." />
          )}

          {error && (
            <InlineNotification kind="error" lowContrast title="No se pudieron cargar los vuelos" subtitle={error} />
          )}

          <div className="flex-1 overflow-auto rounded-lg border border-panel-border bg-panel-bg">
            {viewMode === 'search' ? (
              <div className="flex h-full flex-col p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-panel-border pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-panel-text">Resultados de búsqueda</h2>
                    <p className="mt-1 text-sm text-panel-text-faint">
                      {searchResults.length} coincidencia{searchResults.length === 1 ? '' : 's'} para la fecha seleccionada.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button kind="secondary" size="sm" onClick={handleBackToContinents}>
                      Volver a continentes
                    </Button>
                    <Button kind="secondary" size="sm" onClick={openSearchModal}>
                      Modificar búsqueda
                    </Button>
                    <Button kind="ghost" size="sm" onClick={clearAppliedSearch}>
                      Limpiar búsqueda
                    </Button>
                  </div>
                </div>

                {searchResults.length === 0 ? (
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle p-6 text-center text-sm text-panel-text-faint">
                    No se encontraron vuelos con los filtros aplicados.
                  </div>
                ) : (
                  <>
                    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-panel-border bg-panel-bg">
                      <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm">
                        <thead className="sticky top-0 z-10 bg-panel-bg-subtle text-left text-xs uppercase tracking-wide text-panel-text-faint">
                          <tr>
                            <th className="border-b border-panel-border px-4 py-3">Código</th>
                            <th className="border-b border-panel-border px-4 py-3">Fecha</th>
                            <th className="border-b border-panel-border px-4 py-3">Origen</th>
                            <th className="border-b border-panel-border px-4 py-3">Destino</th>
                            <th className="border-b border-panel-border px-4 py-3">Salida UTC</th>
                            <th className="border-b border-panel-border px-4 py-3">Llegada UTC</th>
                            <th className="border-b border-panel-border px-4 py-3">Capacidad</th>
                            <th className="border-b border-panel-border px-4 py-3">Estado</th>
                            <th className="border-b border-panel-border px-4 py-3">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedSearchResults.map((row) => {
                            const canCancel = canCancelOccurrence(row);
                            const destinationAirport = airportByIata.get(row.destino);
                            return (
                              <tr key={row.key} className="border-b border-panel-border last:border-b-0 hover:bg-panel-hover">
                                <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs font-semibold tracking-wide">{row.code}</td>
                                <td className="whitespace-nowrap px-5 py-3.5">{formatDateLabel(selectedDate)}</td>
                                <td className="whitespace-nowrap px-5 py-3.5">{row.origen}</td>
                                <td className="whitespace-nowrap px-5 py-3.5">{row.destino} - {destinationAirport?.pais ?? 'Sin país'}</td>
                                <td className="whitespace-nowrap px-5 py-3.5">{formatUtcTableValue(row.salidaUTC)}</td>
                                <td className="whitespace-nowrap px-5 py-3.5">{formatUtcTableValue(row.llegadaUTC)}</td>
                                <td className="whitespace-nowrap px-5 py-3.5">{row.capacidad}</td>
                                <td className="whitespace-nowrap px-5 py-3.5">
                                  <Tag type={row.estado === 'CANCELADO' ? 'red' : row.estado === 'EN VUELO' ? 'blue' : row.estado === 'FINALIZADO' ? 'purple' : 'green'}>
                                    {statusLabel(row.estado)}
                                  </Tag>
                                </td>
                                <td className="whitespace-nowrap px-5 py-3.5">
                                  <Button
                                    type="button"
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
                          })}
                        </tbody>
                      </table>

                    </div>

                    <div className="mt-4 flex justify-end">
                      <Pagination
                        totalItems={searchResults.length}
                        page={searchSafePage}
                        pageSize={searchPageSize}
                        pageSizes={[25, 50, 100]}
                        itemsPerPageText="Registros por página"
                        pageRangeText={(current, total) => `${current}–${total}`}
                        pageText={(pageNumber) => `Página ${pageNumber}`}
                        onChange={(event) => {
                          setSearchPage(event.page);
                          setSearchPageSize(event.pageSize);
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            ) : selectedAirportIata && selectedAirportDetails ? (
              <div className="flex h-full flex-col p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-panel-border pb-4">
                  <div className="min-w-0">
                    <nav aria-label="Breadcrumb" className="mb-2 text-sm text-panel-text-faint">
                      <button type="button" className="font-medium text-panel-text hover:underline" onClick={handleBackToContinents}>
                        Continentes
                      </button>
                      <span className="mx-2">/</span>
                      <span>{getContinentLabel(selectedAirportDetails.continente)}</span>
                      <span className="mx-2">/</span>
                      <span className="font-medium text-panel-text">{selectedAirportDetails.iata}</span>
                    </nav>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="font-mono text-3xl font-semibold tracking-wide text-panel-text">{selectedAirportDetails.iata}</h2>
                      <span className="text-base text-panel-text-faint">{selectedAirportDetails.ciudad}, {selectedAirportDetails.pais}</span>
                    </div>
                  </div>
                  <Button type="button" kind="secondary" size="sm" onClick={handleBackToContinents}>Volver a continentes</Button>
                </div>

                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[0.8fr,1.1fr,0.7fr,1fr,2.1fr]">
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">Código IATA</p>
                    <p className="mt-1 font-mono text-lg font-semibold tracking-wide text-panel-text">{selectedAirportDetails.iata}</p>
                  </div>
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">Ubicación</p>
                    <p className="mt-1 font-semibold text-panel-text">{selectedAirportDetails.ciudad}, {selectedAirportDetails.pais}</p>
                  </div>
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">Vuelos</p>
                    <p className="mt-1 text-lg font-semibold text-panel-text">{airportDetailOccurrences.length}</p>
                  </div>
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">Hora simulada global</p>
                    <p className="mt-1 text-lg font-semibold text-panel-text">
                      {hasValidSimulationTime ? `${formatSimulationMoment(referenceTimeMinutes)} UTC` : 'No disponible'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-panel-border bg-panel-bg-subtle px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-panel-text-faint">Vista de tabla</p>
                    <div className="mt-2 grid gap-2 xl:grid-cols-4">
                      <Button type="button" size="sm" kind={detailFilter === 'ALL' ? 'primary' : 'secondary'} onClick={() => setDetailFilter('ALL')}>Tabla maestra</Button>
                      <Button type="button" size="sm" kind={detailFilter === 'PREPARADO' ? 'primary' : 'secondary'} onClick={() => setDetailFilter('PREPARADO')}>Programados ({airportDetailSummary.preparado})</Button>
                      <Button type="button" size="sm" kind={detailFilter === 'FINALIZADO' ? 'primary' : 'secondary'} onClick={() => setDetailFilter('FINALIZADO')}>Finalizados ({airportDetailSummary.finalizado})</Button>
                      <Button type="button" size="sm" kind={detailFilter === 'CANCELADO' ? 'primary' : 'secondary'} onClick={() => setDetailFilter('CANCELADO')}>Cancelados ({airportDetailSummary.cancelado})</Button>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto border border-panel-border bg-panel-bg shadow-sm">
                  <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10 bg-panel-bg-subtle text-left text-xs uppercase tracking-wide text-panel-text-faint">
                      <tr>
                        <th className="border-b border-panel-border px-5 py-3.5">Código</th>
                        <th className="border-b border-panel-border px-5 py-3.5">Fecha UTC</th>
                        <th className="border-b border-panel-border px-5 py-3.5">Destino</th>
                        <th className="border-b border-panel-border px-5 py-3.5">Salida UTC</th>
                        <th className="border-b border-panel-border px-5 py-3.5">Llegada UTC</th>
                        <th className="border-b border-panel-border px-5 py-3.5">Capacidad</th>
                        <th className="border-b border-panel-border px-5 py-3.5">Estado</th>
                        <th className="border-b border-panel-border px-5 py-3.5 text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedAirportDetailOccurrences.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-5 py-10 text-center text-panel-text-faint">
                            No hay vuelos para la vista seleccionada en este aeropuerto y fecha.
                          </td>
                        </tr>
                      ) : (
                        paginatedAirportDetailOccurrences.map((row) => {
                          const canCancel = canCancelOccurrence(row);
                          const destinationAirport = airportByIata.get(row.destino);
                          return (
                            <tr key={row.key} className="border-b border-panel-border transition-colors last:border-b-0 hover:bg-panel-hover">
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5 font-mono text-xs font-semibold tracking-wide">{row.code}</td>
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5">{formatUtcDate(row.salidaUTC)}</td>
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5 font-medium">{row.destino} - {destinationAirport?.pais ?? 'Sin país'}</td>
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5 font-mono">{formatUtcTime(row.salidaUTC)}</td>
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5 font-mono">{formatUtcTime(row.llegadaUTC)}</td>
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5">{row.capacidad}</td>
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5">
                                <Tag type={row.estado === 'CANCELADO' ? 'red' : row.estado === 'EN VUELO' ? 'blue' : row.estado === 'FINALIZADO' ? 'purple' : 'green'}>
                                  {statusLabel(row.estado)}
                                </Tag>
                              </td>
                              <td className="whitespace-nowrap border-b border-panel-border px-5 py-3.5 text-center">
                                <Button
                                  type="button"
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

                <div className="mt-3 flex justify-end">
                  <Pagination
                    totalItems={airportFilteredDetailOccurrences.length}
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

              <div className="grid h-full min-h-0 grid-cols-1 gap-5 overflow-auto p-5 xl:grid-cols-3">
                {continentGroups.length === 0 ? (
                  <div className="col-span-full rounded-xl border border-panel-border bg-panel-bg-subtle p-8 text-center text-sm text-panel-text-faint">
                    No hay aeropuertos con datos disponibles para este día.
                  </div>
                ) : (
                  continentGroups.map((group) => (
                    <section
                      key={group.continent}
                      className="flex min-h-[430px] min-w-0 flex-col border border-panel-border bg-panel-bg-subtle shadow-sm"
                    >
                      <header className="border-b border-panel-border px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="text-2xl font-semibold tracking-tight text-panel-text">{group.label}</h2>
                          <Tag type="gray">{group.airports.length} aeropuertos</Tag>
                        </div>
                      </header>


                      <div className="min-h-0 flex-1 overflow-auto">
                        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                          <colgroup>
                            <col className="w-[30%]" />
                            <col className="w-[42%]" />
                            <col className="w-[28%]" />
                          </colgroup>
                          <thead className="sticky top-0 z-10 bg-panel-bg text-left text-xs uppercase tracking-wide text-panel-text-faint">
                            <tr>
                              <th className="border-b border-panel-border px-4 py-3">Código</th>
                              <th className="border-b border-panel-border px-4 py-3">País</th>
                              <th className="border-b border-panel-border px-4 py-3 text-right">Vuelos preparados</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.airports.map((airport) => (
                              <tr
                                key={airport.iata}
                                tabIndex={0}
                                role="button"
                                aria-label={`Ver vuelos programados de ${airport.iata}, ${airport.pais}`}
                                className="cursor-pointer transition-colors hover:bg-panel-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                                onClick={() => handleSelectAirport(airport.iata)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    handleSelectAirport(airport.iata);
                                  }
                                }}
                              >
                                <td className="border-b border-panel-border px-4 py-3.5">
                                  <span className="inline-flex min-w-[4.5rem] items-center justify-center rounded-md border border-panel-border bg-panel-bg px-2.5 py-1 font-mono text-sm font-semibold tracking-[0.08em] text-panel-text">
                                    {airport.iata}
                                  </span>
                                </td>
                                <td className="border-b border-panel-border px-4 py-3.5 font-medium text-panel-text" title={airport.pais}>
                                  <span className="block truncate">{airport.pais}</span>
                                </td>
                                <td className="border-b border-panel-border px-4 py-3.5 text-right">
                                  <Tag type={airport.preparado > 0 ? 'green' : 'gray'}>{airport.preparado}</Tag>
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
      </main>

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
                <div><span className="text-panel-text-faint">Salida UTC:</span> {formatUtcTableValue(confirmationRow.salidaUTC)}</div>
                <div><span className="text-panel-text-faint">Llegada UTC:</span> {formatUtcTableValue(confirmationRow.llegadaUTC)}</div>

              </div>
              <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">
                La cancelación provocará la replanificación de las maletas asignadas.
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button kind="secondary" onClick={() => setConfirmationRow(null)}>Cancelar</Button>
              <Button
                kind="danger"
                onClick={handleCancelConfirm}
                disabled={!canCancelOccurrence(confirmationRow)}
              >
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

      {isSearchModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={cancelSearchModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="special-search-title"
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-panel-border px-6 py-4">
              <div>
                <h2 id="special-search-title" className="text-xl font-semibold text-panel-text">Búsqueda especializada</h2>
                <p className="mt-1 text-sm text-panel-text-faint">Configura los criterios y aplica la búsqueda sobre la fecha seleccionada.</p>
              </div>
              <button
                type="button"
                aria-label="Cerrar búsqueda especializada"
                className="flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-panel-text-faint transition-colors hover:bg-panel-hover hover:text-panel-text"
                onClick={cancelSearchModal}
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Select
                  id="search-continent"
                  labelText="Continente"
                  value={draftFilters.continent === 'todos' ? 'todos' : String(draftFilters.continent)}
                  onChange={(e) => {
                    const strValue = e.target.value;
                    setDraftFilters((prev) => ({
                      ...prev,
                      continent: strValue === 'todos' ? 'todos' : (parseInt(strValue) as 1 | 2 | 3),
                      originCountry: '',
                      originAirport: '',
                    }));
                  }}
                >
                  <SelectItem value="todos" text="Todos" />
                  <SelectItem value="1" text="América del Sur" />
                  <SelectItem value="2" text="Europa" />
                  <SelectItem value="3" text="Asia" />
                </Select>

                <Select
                  id="search-status"
                  labelText="Estado"
                  value={draftFilters.status}
                  onChange={(e) => setDraftFilters((prev) => ({
                    ...prev,
                    status: e.target.value as SearchFilters['status'],
                  }))}
                >
                  <SelectItem value="todos" text="Todos" />
                  <SelectItem value="PREPARADO" text="Preparado" />
                  <SelectItem value="EN VUELO" text="En vuelo" />
                  <SelectItem value="FINALIZADO" text="Finalizado" />
                  <SelectItem value="CANCELADO" text="Cancelado" />
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Select
                  id="search-origin-country"
                  labelText="País de origen"
                  value={draftFilters.originCountry}
                  onChange={(e) => setDraftFilters((prev) => ({
                    ...prev,
                    originCountry: e.target.value,
                    originAirport: '',
                  }))}
                >
                  <SelectItem value="" text="Todos" />
                  {availableCountries.map((country) => (
                    <SelectItem key={country} value={country} text={country} />
                  ))}
                </Select>

                <Select
                  id="search-origin-airport"
                  labelText="Aeropuerto de origen"
                  value={draftFilters.originAirport}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, originAirport: e.target.value }))}
                >
                  <SelectItem value="" text="Todos" />
                  {availableOriginAirports.map((airport) => (
                    <SelectItem key={airport.iata} value={airport.iata} text={`${airport.iata} — ${airport.ciudad}`} />
                  ))}
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Select
                  id="search-destination-airport"
                  labelText="Aeropuerto de destino"
                  value={draftFilters.destinationAirport}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, destinationAirport: e.target.value }))}
                >
                  <SelectItem value="" text="Todos" />
                  {availableDestinationAirports.map((airport) => (
                    <SelectItem key={airport.iata} value={airport.iata} text={`${airport.iata} — ${airport.ciudad}`} />
                  ))}
                </Select>

                <TextInput
                  id="search-code-route"
                  labelText="Código o ruta"
                  placeholder="Ej: SLLP, OJAI o SLLP-OJAI"
                  value={draftFilters.codeOrRoute}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, codeOrRoute: e.target.value }))}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <TextInput
                  id="search-time-from"
                  labelText="Hora de salida desde"
                  type="time"
                  value={draftFilters.departureTimeFrom}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, departureTimeFrom: e.target.value }))}
                />
                <TextInput
                  id="search-time-to"
                  labelText="Hora de salida hasta"
                  type="time"
                  value={draftFilters.departureTimeTo}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, departureTimeTo: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border px-6 py-4">
              <Button type="button" kind="ghost" onClick={clearSearchFilters}>Limpiar filtros</Button>
              <div className="flex gap-2">
                <Button type="button" kind="secondary" onClick={cancelSearchModal}>Cancelar</Button>
                <Button type="button" kind="primary" onClick={applySearchFilters}>Aplicar filtros</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
