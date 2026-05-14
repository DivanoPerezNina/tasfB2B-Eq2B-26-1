import React, { useState, useEffect } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { useSimulation } from '../context/SimulationContext';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Calendar as CalendarUI } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { cn } from '../components/ui/utils';
import { SimulationScenario } from '../types';
import {
  Settings,
  Save,
  CalendarDays,
  Sliders,
  Play,
  Pause,
  RotateCcw,
  Clock,
  Upload,
  FileSpreadsheet,
  X,
  Download,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  Timer,
  Zap,
  Database,
  Trash2,
  Activity,
  Warehouse,
  Plane,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ─── Tipos de historial ───────────────────────────────────────────────────────

interface HistoryRecord {
  id: string;
  date: string;
  scenario: SimulationScenario;
  dias?: number;
  duracionMin?: number;
  fechaInicio?: string;
  total: number;
  exitosos: number;
  rechazados: number;
  tasaExito: number;
}

const HISTORY_KEY = 'tasf_simulation_history';
function loadHistory(): HistoryRecord[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); }
  catch { return []; }
}

// ─── Slider de umbrales tricolor ──────────────────────────────────────────────

function ThresholdSlider({
  label,
  icon,
  green,
  yellow,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  green: number;
  yellow: number;
  onChange: (green: number, yellow: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-panel-text">
          {icon}
          {label}
        </span>
        <div className="flex gap-3 text-xs font-medium">
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            ≤ {green}%
          </span>
          <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            ≤ {yellow}%
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            &gt; {yellow}%
          </span>
        </div>
      </div>
      <SliderPrimitive.Root
        min={0} max={100} step={1}
        value={[green, yellow]}
        onValueChange={([g, y]) => onChange(g, y)}
        className="relative flex w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track
          className="relative h-4 w-full grow overflow-hidden rounded-full"
          style={{
            background: `linear-gradient(to right,
              #22c55e 0% ${green}%,
              #eab308 ${green}% ${yellow}%,
              #ef4444 ${yellow}% 100%)`,
          }}
        >
          <SliderPrimitive.Range className="absolute h-full opacity-0" />
        </SliderPrimitive.Track>
        {[0, 1].map((i) => (
          <SliderPrimitive.Thumb
            key={i}
            className="block h-5 w-5 rounded-full border-2 border-white bg-white shadow-md
                       ring-black/10 transition-shadow hover:ring-4 focus-visible:ring-4
                       focus-visible:outline-none
                       dark:border-neutral-600 dark:bg-neutral-800 dark:ring-white/10"
          />
        ))}
      </SliderPrimitive.Root>
      <div className="flex text-xs text-panel-text-faint">
        <span>0%</span><span className="flex-1" /><span>100%</span>
      </div>
    </div>
  );
}

// ─── Date picker estilizado ───────────────────────────────────────────────────

function DatePickerField({
  value,
  onChange,
  disabled,
  fromDate,
  toDate,
}: {
  value: Date | null;
  onChange: (date: Date) => void;
  disabled?: boolean;
  fromDate?: Date;
  toDate?: Date;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open && !disabled} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center gap-2.5 rounded-md border border-panel-border',
            'bg-panel-section-bg px-3 py-1 text-sm shadow-sm transition-colors text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            'disabled:cursor-not-allowed disabled:opacity-40',
            open && 'ring-2 ring-primary/40 border-primary/40',
          )}
        >
          <CalendarDays className="h-4 w-4 text-panel-text-faint shrink-0" />
          {value && !isNaN(value.getTime()) ? (
            <span className="font-semibold text-panel-text tabular-nums">
              {format(value, 'dd / MM / yyyy')}
            </span>
          ) : (
            <span className="text-panel-text-faint">Seleccionar fecha…</span>
          )}
          <span className="ml-auto text-xs text-panel-text-faint">
            {value && !isNaN(value.getTime()) ? format(value, 'EEEE', { locale: es }) : ''}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={6}>
        <CalendarUI
          mode="single"
          selected={value ?? undefined}
          onSelect={(date) => { if (date) { onChange(date); setOpen(false); } }}
          fromDate={fromDate}
          toDate={toDate}
          defaultMonth={value ?? fromDate}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Opciones de escenario ────────────────────────────────────────────────────

const SCENARIO_OPTIONS: {
  value: SimulationScenario;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  { value: 'realtime', label: 'Tiempo Real',  desc: 'Monitoreo día a día',       icon: <Activity   className="h-4 w-4" /> },
  { value: 'period',   label: 'Periodo',       desc: 'Comprime días en minutos',  icon: <Timer      className="h-4 w-4" /> },
  { value: 'collapse', label: 'Colapso',       desc: 'Prueba de estrés',          icon: <TrendingUp className="h-4 w-4" /> },
];

const SCENARIO_LABELS: Record<SimulationScenario, string> = {
  realtime: 'Tiempo Real',
  period:   'Periodo',
  collapse: 'Colapso',
};

// ─── Componente principal ─────────────────────────────────────────────────────

export function SimulationConfig() {
  const {
    config, updateConfig, datasetInfo,
    fase, planProgreso, planMensaje,
    iniciarPlanificacion, iniciarSimulacion, pausarSimulacion,
    reanudarSimulacion, resetear,
    contadores,
    resetSimulation,
  } = useSimulation();

  const [localConfig, setLocalConfig] = useState(config);
  const [airportsFile,   setAirportsFile]   = useState<File | null>(null);
  const [flightsFile,    setFlightsFile]    = useState<File | null>(null);
  const [shipmentsFile,  setShipmentsFile]  = useState<File | null>(null);
  const [dataLoaded,     setDataLoaded]     = useState(false);
  const [currentTime,    setCurrentTime]    = useState(new Date());
  const [history,        setHistory]        = useState<HistoryRecord[]>(loadHistory);

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Sincronizar startDate cuando el dataset llega del backend
  useEffect(() => {
    setLocalConfig(prev => ({ ...prev, startDate: config.startDate }));
  }, [config.startDate]);

  // Registrar en historial al completar
  useEffect(() => {
    if (fase === 'completado' && contadores.total > 0) {
      const record: HistoryRecord = {
        id:          Date.now().toString(),
        date:        new Date().toISOString(),
        scenario:    config.scenario,
        dias:        config.scenario === 'period' ? config.dias : undefined,
        duracionMin: config.scenario === 'period' ? config.duracionRealMin : undefined,
        fechaInicio: config.scenario === 'period'
          ? config.startDate.toISOString().slice(0, 10)
          : undefined,
        total:      contadores.total,
        exitosos:   contadores.entregado,
        rechazados: contadores.rechazado,
        tasaExito:  contadores.total > 0
          ? (contadores.entregado / contadores.total) * 100
          : 0,
      };
      setHistory(prev => {
        const updated = [record, ...prev].slice(0, 30);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
        return updated;
      });
      toast.success('Simulación guardada en el historial');
    }
  }, [fase]); // eslint-disable-line

  const backendTieneDatos = !!datasetInfo;
  const datosDisponibles  = dataLoaded || backendTieneDatos;
  const allFilesSelected  = !!airportsFile && !!flightsFile && !!shipmentsFile;

  // ── Handlers ──

  // Guarda la config actual; si nada fue seleccionado usa realtime por defecto
  const handleGuardar = () => {
    const toSave = { ...localConfig };
    if (!toSave.scenario) toSave.scenario = 'realtime';
    updateConfig(toSave);
    resetSimulation();
    toast.success('Configuración guardada');
  };

  const handleIniciarPlanificacion = () => {
    updateConfig(localConfig);
    iniciarPlanificacion({
      startDate:       localConfig.startDate,
      dias:            localConfig.dias,
      criterio:        'EDF',
      duracionRealMin: localConfig.duracionRealMin,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'airports' | 'flights' | 'shipments') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) { toast.error('Formato no válido — use archivos .txt'); return; }
    if (type === 'airports') setAirportsFile(file);
    else if (type === 'flights') setFlightsFile(file);
    else setShipmentsFile(file);
  };

  const handleLoadData = () => {
    if (!allFilesSelected) return;
    toast.success('Datos cargados', { description: 'Aeropuertos, vuelos y envíos listos para simular' });
    setDataLoaded(true);
  };

  const handleDownloadTemplate = (_tipo: 'aeropuertos' | 'vuelos' | 'envios') => {
    toast.info('Disponible cuando el backend esté operativo');
  };

  const handleClearHistory = () => {
    setHistory([]); localStorage.removeItem(HISTORY_KEY);
    toast.success('Historial borrado');
  };

  return (
    <div className="flex h-full flex-col bg-background">

      {/* ── Header compacto ─────────────────────────────────────────────────── */}
      <div className="border-b border-panel-border bg-panel-bg px-6 py-2.5 shadow-sm">
        <div className="flex items-center justify-between gap-4">

          <div className="flex items-center gap-3 min-w-0 text-xs">
            <span className="text-sm font-bold text-panel-text whitespace-nowrap">Configuración</span>
            <span className="text-panel-border">·</span>
            <span className="flex items-center gap-1.5 text-panel-text-muted">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono font-medium text-panel-text">
                {format(currentTime, 'dd/MM/yyyy HH:mm:ss')}
              </span>
            </span>
            <span className="text-panel-border hidden md:block">·</span>
            <span className="hidden md:font-medium md:block text-panel-text">
              {SCENARIO_LABELS[localConfig.scenario]}
            </span>
            {localConfig.scenario === 'period' && (
              <>
                <span className="text-panel-border hidden md:block">·</span>
                <span className="hidden md:flex items-center gap-1 text-panel-text-muted">
                  <Timer className="h-3.5 w-3.5" />
                  <span className="font-medium text-panel-text">
                    {localConfig.dias} días · {localConfig.duracionRealMin} min
                  </span>
                </span>
              </>
            )}
            {localConfig.scenario === 'collapse' && (
              <>
                <span className="text-panel-border hidden md:block">·</span>
                <span className="hidden md:flex items-center gap-1 text-panel-text-muted">
                  <Zap className="h-3.5 w-3.5" />
                  <span className="font-medium text-panel-text">{localConfig.speed}×</span>
                </span>
              </>
            )}
            {backendTieneDatos ? (
              <>
                <span className="text-panel-border hidden md:block">·</span>
                <span className="hidden md:flex items-center gap-1 text-green-600 dark:text-green-400">
                  <Database className="h-3.5 w-3.5" />
                  {Number(datasetInfo!.total_envios).toLocaleString()} envíos
                </span>
              </>
            ) : !datosDisponibles ? (
              <>
                <span className="text-panel-border hidden md:block">·</span>
                <span className="hidden md:flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                  <AlertCircle className="h-3.5 w-3.5" />Sin datos
                </span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {fase === 'ejecutando' ? (
              <Button onClick={() => pausarSimulacion()} variant="outline" size="sm">
                <Pause className="mr-1.5 h-3.5 w-3.5" />Pausar
              </Button>
            ) : fase === 'pausado' ? (
              <Button onClick={() => reanudarSimulacion()} size="sm" className="bg-yellow-600 hover:bg-yellow-700">
                <Play className="mr-1.5 h-3.5 w-3.5" />Reanudar
              </Button>
            ) : fase === 'listo' ? (
              <Button onClick={() => iniciarSimulacion()} size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Play className="mr-1.5 h-3.5 w-3.5" />Ejecutar
              </Button>
            ) : fase === 'planificando' ? (
              <Button disabled size="sm">
                <Clock className="mr-1.5 h-3.5 w-3.5 animate-spin" />{planProgreso}%
              </Button>
            ) : fase === 'completado' ? (
              <Button onClick={() => resetear()} variant="outline" size="sm">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Nueva
              </Button>
            ) : (
              <Button onClick={handleIniciarPlanificacion} size="sm" className="bg-green-600 hover:bg-green-700">
                <Play className="mr-1.5 h-3.5 w-3.5" />Iniciar
              </Button>
            )}
            <Button onClick={() => resetear()} variant="outline" size="sm" title="Reiniciar">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <div className="mx-1 h-5 w-px bg-panel-border" />
            <Button variant="ghost" size="sm" onClick={() => setLocalConfig(config)}>
              <X className="mr-1 h-3.5 w-3.5" />Descartar
            </Button>
            <Button size="sm" onClick={handleGuardar}>
              <Save className="mr-1.5 h-3.5 w-3.5" />Guardar
            </Button>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden p-5">
        <Tabs defaultValue="general" className="h-full">
          <TabsList className="mb-4">
            <TabsTrigger value="general"><Settings className="mr-1.5 h-3.5 w-3.5" />General</TabsTrigger>
            <TabsTrigger value="thresholds"><Sliders className="mr-1.5 h-3.5 w-3.5" />Umbrales</TabsTrigger>
            <TabsTrigger value="upload"><Upload className="mr-1.5 h-3.5 w-3.5" />Carga Masiva</TabsTrigger>
            <TabsTrigger value="history">
              <Calendar className="mr-1.5 h-3.5 w-3.5" />Historial
              {history.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                  {history.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="h-[calc(100%-2.75rem)] overflow-y-auto pr-1">

            {/* ── Tab: General ──────────────────────────────────────────────── */}
            <TabsContent value="general" className="m-0">
              <div className="grid grid-cols-3 gap-5 max-w-5xl">

                {/* Col 1 — Escenario */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Escenario</Label>
                  <div className="space-y-2 mt-1.5">
                    {SCENARIO_OPTIONS.map((opt) => {
                      const active = localConfig.scenario === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setLocalConfig({ ...localConfig, scenario: opt.value })}
                          className={`w-full flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                            active
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-panel-border bg-panel-bg hover:border-primary/40 hover:bg-panel-section-bg'
                          }`}
                        >
                          <span className={`shrink-0 rounded-lg p-1.5 transition-colors ${
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-panel-section-bg text-panel-text-muted'
                          }`}>
                            {opt.icon}
                          </span>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${active ? 'text-primary' : 'text-panel-text'}`}>
                              {opt.label}
                            </p>
                            <p className="text-xs text-panel-text-faint truncate">{opt.desc}</p>
                          </div>
                          {active && (
                            <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Col 2 — Fecha + Duración/Velocidad */}
                <div className="space-y-4">
                  {/* Fecha de inicio */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Fecha de inicio</Label>
                    <DatePickerField
                      value={localConfig.startDate}
                      onChange={(d) => setLocalConfig({ ...localConfig, startDate: d })}
                      disabled={localConfig.scenario !== 'period'}
                      fromDate={datasetInfo ? new Date(datasetInfo.fecha_min + 'T00:00:00') : undefined}
                      toDate={datasetInfo   ? new Date(datasetInfo.fecha_max + 'T00:00:00') : undefined}
                    />
                    {/* Rango siempre visible */}
                    <div className={cn(
                      'rounded-md border px-3 py-2 text-xs',
                      datasetInfo
                        ? 'border-panel-border bg-panel-section-bg'
                        : 'border-yellow-400/40 bg-yellow-500/10',
                    )}>
                      {datasetInfo ? (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="text-panel-text-faint">Rango disponible: </span>
                            <span className="font-mono font-semibold text-panel-text">{datasetInfo.fecha_min}</span>
                            <span className="mx-1 text-panel-text-faint">→</span>
                            <span className="font-mono font-semibold text-panel-text">{datasetInfo.fecha_max}</span>
                          </div>
                          <Database className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 text-yellow-700 dark:text-yellow-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          Backend no conectado — inicia el BFF para ver el rango
                        </span>
                      )}
                    </div>
                    {localConfig.scenario !== 'period' && (
                      <p className="text-xs text-panel-text-faint">Solo editable en escenario Periodo</p>
                    )}
                  </div>

                  {/* Duración real — Periodo */}
                  {localConfig.scenario === 'period' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Duración real</Label>
                        <span className="rounded-md border border-panel-border bg-panel-section-bg px-2 py-0.5 text-sm font-semibold tabular-nums text-panel-text">
                          {localConfig.duracionRealMin} min
                        </span>
                      </div>
                      <SliderPrimitive.Root
                        min={30} max={90} step={5}
                        value={[localConfig.duracionRealMin]}
                        onValueChange={([v]) => setLocalConfig({ ...localConfig, duracionRealMin: v })}
                        className="relative flex w-full touch-none select-none items-center"
                      >
                        <SliderPrimitive.Track className="bg-muted relative h-2 w-full grow overflow-hidden rounded-full">
                          <SliderPrimitive.Range className="bg-primary absolute h-full" />
                        </SliderPrimitive.Track>
                        <SliderPrimitive.Thumb className="border-primary bg-background ring-ring/50 block h-4 w-4 rounded-full border shadow-sm transition-shadow hover:ring-4 focus-visible:ring-4 focus-visible:outline-none dark:bg-neutral-800" />
                      </SliderPrimitive.Root>
                      <div className="flex justify-between text-xs text-panel-text-faint">
                        <span>30 min</span><span>90 min</span>
                      </div>
                      <p className="text-xs text-panel-text-muted">
                        Velocidad:{' '}
                        <span className="font-semibold text-panel-text">
                          {((localConfig.dias * 1440) / (localConfig.duracionRealMin * 60)).toFixed(2)}×
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Velocidad — Colapso */}
                  {localConfig.scenario === 'collapse' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Velocidad</Label>
                        <span className="rounded-md border border-panel-border bg-panel-section-bg px-2 py-0.5 text-sm font-semibold tabular-nums text-panel-text">
                          {localConfig.speed}×
                        </span>
                      </div>
                      <SliderPrimitive.Root
                        min={1} max={200} step={1}
                        value={[localConfig.speed]}
                        onValueChange={([v]) => setLocalConfig({ ...localConfig, speed: v })}
                        className="relative flex w-full touch-none select-none items-center"
                      >
                        <SliderPrimitive.Track className="bg-muted relative h-2 w-full grow overflow-hidden rounded-full">
                          <SliderPrimitive.Range className="bg-primary absolute h-full" />
                        </SliderPrimitive.Track>
                        <SliderPrimitive.Thumb className="border-primary bg-background ring-ring/50 block h-4 w-4 rounded-full border shadow-sm transition-shadow hover:ring-4 focus-visible:ring-4 focus-visible:outline-none dark:bg-neutral-800" />
                      </SliderPrimitive.Root>
                      <div className="flex justify-between text-xs text-panel-text-faint">
                        <span>1× (real)</span><span>200× (máximo)</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Col 3 — Días (Periodo) / vacío (otros) */}
                <div>
                  {localConfig.scenario === 'period' && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Días a simular</Label>
                        <RadioGroup
                          value={String(localConfig.dias)}
                          onValueChange={(v) => setLocalConfig({ ...localConfig, dias: Number(v) as 3 | 5 | 7 })}
                          className="grid grid-cols-3 gap-2 mt-1.5"
                        >
                          {([3, 5, 7] as const).map((d) => (
                            <label
                              key={d}
                              htmlFor={`days-${d}`}
                              className={`flex cursor-pointer flex-col items-center rounded-xl border-2 px-3 py-4 transition-all ${
                                localConfig.dias === d
                                  ? 'border-primary bg-primary/5 shadow-sm'
                                  : 'border-panel-border bg-panel-bg hover:border-primary/40'
                              }`}
                            >
                              <RadioGroupItem value={String(d)} id={`days-${d}`} className="sr-only" />
                              <span className={`text-3xl font-bold leading-none ${localConfig.dias === d ? 'text-primary' : 'text-panel-text'}`}>
                                {d}
                              </span>
                              <span className="mt-1 text-xs text-panel-text-muted">días</span>
                            </label>
                          ))}
                        </RadioGroup>
                      </div>

                      {/* Estados de planificación */}
                      {fase === 'planificando' && (
                        <div className="rounded-xl border border-blue-400/40 bg-blue-500/10 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Calculando rutas…</span>
                            <span className="text-xs font-bold tabular-nums text-blue-700 dark:text-blue-300">{planProgreso}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-blue-200 dark:bg-blue-900">
                            <div className="h-1.5 rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${planProgreso}%` }} />
                          </div>
                          <p className="mt-1.5 text-[10px] text-blue-600 dark:text-blue-400 truncate">{planMensaje}</p>
                        </div>
                      )}
                      {fase === 'listo' && (
                        <div className="flex items-start gap-2 rounded-xl border border-green-400/40 bg-green-500/10 p-3">
                          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold text-green-700 dark:text-green-300">Plan listo</p>
                            <p className="text-[10px] text-green-600 dark:text-green-400">
                              Pulsa <strong>Ejecutar</strong> para iniciar
                            </p>
                          </div>
                        </div>
                      )}
                      {fase === 'completado' && (
                        <div className="flex items-start gap-2 rounded-xl border border-panel-border bg-panel-section-bg p-3">
                          <CheckCircle2 className="h-4 w-4 text-panel-text-muted shrink-0 mt-0.5" />
                          <p className="text-xs text-panel-text-muted">
                            Simulación completada. Pulsa <strong>Nueva</strong> para reiniciar.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </TabsContent>

            {/* ── Tab: Umbrales ──────────────────────────────────────────────── */}
            <TabsContent value="thresholds" className="m-0">
              <div className="max-w-5xl">
                <p className="mb-4 text-xs text-panel-text-muted">
                  Define los límites de semaforización. Los colores del mapa se actualizan en tiempo real.
                </p>
                <div className="grid grid-cols-2 gap-5">
                  <div className="rounded-xl border border-panel-border bg-panel-section-bg p-5">
                    <ThresholdSlider
                      label="Almacenes"
                      icon={<Warehouse className="h-4 w-4 text-panel-text-muted" />}
                      green={localConfig.thresholds.warehouse.green}
                      yellow={localConfig.thresholds.warehouse.yellow}
                      onChange={(g, y) =>
                        setLocalConfig({ ...localConfig, thresholds: { ...localConfig.thresholds, warehouse: { green: g, yellow: y, red: y } } })
                      }
                    />
                  </div>
                  <div className="rounded-xl border border-panel-border bg-panel-section-bg p-5">
                    <ThresholdSlider
                      label="Vuelos"
                      icon={<Plane className="h-4 w-4 text-panel-text-muted" />}
                      green={localConfig.thresholds.flight.green}
                      yellow={localConfig.thresholds.flight.yellow}
                      onChange={(g, y) =>
                        setLocalConfig({ ...localConfig, thresholds: { ...localConfig.thresholds, flight: { green: g, yellow: y, red: y } } })
                      }
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Tab: Carga Masiva ─────────────────────────────────────────── */}
            <TabsContent value="upload" className="m-0">
              <div className="max-w-4xl space-y-5">
                {backendTieneDatos ? (
                  <div className="flex items-start gap-3 rounded-xl border border-green-400/40 bg-green-500/10 p-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-green-700 dark:text-green-300">Datos disponibles en el servidor</p>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        {Number(datasetInfo!.total_envios).toLocaleString()} envíos ·
                        Rango: {datasetInfo!.fecha_min} → {datasetInfo!.fecha_max}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border border-yellow-400/40 bg-yellow-500/10 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Selecciona los tres archivos y haz clic en <strong>Cargar datos</strong>.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  {(
                    [
                      { id: 'airports-upload',  type: 'airports'  as const, label: 'Aeropuertos', hint: 'aeropuertos.txt',    tpl: 'aeropuertos' as const, file: airportsFile  },
                      { id: 'flights-upload',   type: 'flights'   as const, label: 'Vuelos',      hint: 'vuelos.txt',        tpl: 'vuelos'      as const, file: flightsFile   },
                      { id: 'shipments-upload', type: 'shipments' as const, label: 'Envíos',      hint: '_envios_XXXX_.txt', tpl: 'envios'      as const, file: shipmentsFile },
                    ] as const
                  ).map(({ id, type, label, hint, tpl, file }) => (
                    <div key={id}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <Label>{label}</Label>
                        <button type="button" className="flex items-center gap-1 text-xs text-panel-text-muted hover:text-panel-text transition-colors" onClick={() => handleDownloadTemplate(tpl)}>
                          <Download className="h-3 w-3" />Plantilla
                        </button>
                      </div>
                      <input id={id} type="file" accept=".txt" onChange={(e) => handleFileUpload(e, type)} className="hidden" />
                      <label htmlFor={id}>
                        <div className={`flex h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
                          file ? 'border-green-400 bg-green-500/10' : 'border-panel-border bg-panel-section-bg hover:border-primary/40 hover:bg-primary/5'
                        }`}>
                          <FileSpreadsheet className={`h-7 w-7 ${file ? 'text-green-500' : 'text-panel-text-faint'}`} />
                          <p className="mt-1.5 px-2 text-center text-xs text-panel-text-muted">{file ? file.name : 'Seleccionar archivo'}</p>
                          <p className="text-[10px] text-panel-text-faint">{hint}</p>
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <Button onClick={handleLoadData} disabled={!allFilesSelected} className="gap-2">
                    <Upload className="h-4 w-4" />Cargar datos
                  </Button>
                  {dataLoaded ? (
                    <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" />Carga completada
                    </span>
                  ) : !allFilesSelected ? (
                    <span className="text-xs text-panel-text-muted">Selecciona los 3 archivos para habilitar la carga</span>
                  ) : null}
                </div>
              </div>
            </TabsContent>

            {/* ── Tab: Historial ────────────────────────────────────────────── */}
            <TabsContent value="history" className="m-0">
              <div className="max-w-5xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-panel-text-muted">
                    {history.length === 0
                      ? 'Las simulaciones completadas se registrarán aquí automáticamente.'
                      : `${history.length} simulación${history.length !== 1 ? 'es' : ''} registrada${history.length !== 1 ? 's' : ''}`}
                  </p>
                  {history.length > 0 && (
                    <button type="button" onClick={handleClearHistory} className="flex items-center gap-1.5 text-xs text-panel-text-muted hover:text-red-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />Borrar historial
                    </button>
                  )}
                </div>

                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-panel-border py-16 text-center">
                    <Calendar className="h-10 w-10 text-panel-text-faint mb-3" />
                    <p className="text-sm font-medium text-panel-text-muted">Sin registros aún</p>
                    <p className="text-xs text-panel-text-faint mt-1">Completa una simulación para ver el historial aquí</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((rec) => {
                      const pct = Math.round(rec.tasaExito);
                      const color    = pct >= 90 ? 'text-green-600 dark:text-green-400' : pct >= 75 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';
                      const barColor = pct >= 90 ? 'bg-green-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-red-500';
                      const scColor  = rec.scenario === 'collapse' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : rec.scenario === 'period' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
                      const scIcon   = rec.scenario === 'collapse' ? <TrendingUp className="h-3 w-3" /> : rec.scenario === 'period' ? <Timer className="h-3 w-3" /> : <Activity className="h-3 w-3" />;
                      return (
                        <div key={rec.id} className="flex items-center gap-4 rounded-xl border border-panel-border bg-panel-bg px-4 py-3 hover:bg-panel-section-bg transition-colors">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shrink-0 ${scColor}`}>
                            {scIcon}{SCENARIO_LABELS[rec.scenario]}
                          </span>
                          {rec.fechaInicio && (
                            <span className="text-xs text-panel-text-muted shrink-0">
                              desde <span className="font-mono font-medium text-panel-text">{rec.fechaInicio}</span>
                            </span>
                          )}
                          {rec.dias != null && (
                            <span className="flex items-center gap-1 text-xs text-panel-text-muted shrink-0">
                              <Timer className="h-3 w-3" />{rec.dias} días · {rec.duracionMin} min
                            </span>
                          )}
                          <span className="text-xs text-panel-text-muted shrink-0">
                            <span className="font-semibold text-panel-text tabular-nums">{rec.total.toLocaleString()}</span> envíos
                          </span>
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <div className="flex-1 h-1.5 rounded-full bg-panel-border overflow-hidden">
                              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`text-xs font-bold tabular-nums shrink-0 ${color}`}>{pct}%</span>
                          </div>
                          {rec.rechazados > 0 && (
                            <span className="text-xs text-red-500 dark:text-red-400 shrink-0 tabular-nums">
                              −{rec.rechazados.toLocaleString()}
                            </span>
                          )}
                          <span className="text-[10px] text-panel-text-faint shrink-0 ml-auto">
                            {format(new Date(rec.date), 'dd/MM HH:mm', { locale: es })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

          </div>
        </Tabs>
      </div>
    </div>
  );
}
