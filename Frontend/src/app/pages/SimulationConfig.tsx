import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  X,
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

// ─── Time picker estilizado ───────────────────────────────────────────────────

function TimePickerField({
  value,
  onChange,
  disabled,
}: {
  value: string;          // "HH:MM"
  onChange: (t: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen]   = useState(false);
  const [draft, setDraft] = useState(value);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Sync draft when controlled value changes
  useEffect(() => { setDraft(value); }, [value]);

  // Scroll selected slot into view every time the popover opens
  useEffect(() => {
    if (open) {
      const id = setTimeout(() =>
        selectedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
      return () => clearTimeout(id);
    }
  }, [open]);

  // 96 slots: 00:00 → 23:45 in 15-min increments
  const slots = useMemo(() => {
    const r: string[] = [];
    for (let h = 0; h < 24; h++)
      for (let m = 0; m < 60; m += 15)
        r.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    return r;
  }, []);

  // Nearest slot for auto-scroll reference (rounds to closest 15-min)
  const nearestSlot = useMemo(() => {
    const [h = 0, m = 0] = value.split(':').map(Number);
    const rm = Math.round(m / 15) * 15;
    const rh = rm === 60 ? (h + 1) % 24 : h;
    return `${String(rh).padStart(2, '0')}:${String(rm === 60 ? 0 : rm).padStart(2, '0')}`;
  }, [value]);

  const handleDraft = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    if (/^\d{2}:\d{2}$/.test(e.target.value)) {
      const [h, m] = e.target.value.split(':').map(Number);
      if (h >= 0 && h < 24 && m >= 0 && m < 60) onChange(e.target.value);
    }
  };

  return (
    <Popover open={open && !disabled} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-9 w-28 items-center gap-2 rounded-md border border-panel-border',
            'bg-panel-section-bg px-3 py-1 text-sm shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            'disabled:cursor-not-allowed disabled:opacity-40',
            open && 'ring-2 ring-primary/40 border-primary/40',
          )}
        >
          <Clock className="h-4 w-4 text-panel-text-faint shrink-0" />
          <span className="font-semibold text-panel-text tabular-nums">{value || '00:00'}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-36 p-2" align="start" sideOffset={6}>
        {/* Manual input — type="time" gestiona teclado y validación nativa */}
        <input
          type="time"
          value={draft}
          onChange={handleDraft}
          className={cn(
            'mb-2 h-8 w-full rounded-md border border-panel-border bg-panel-section-bg',
            'px-2 text-sm font-mono tabular-nums text-panel-text shadow-sm',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40',
          )}
        />

        {/* Slots cada 15 min */}
        <div className="max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
          {slots.map(slot => {
            const isExact    = slot === value;
            const isNearest  = slot === nearestSlot && !isExact;
            return (
              <button
                key={slot}
                ref={slot === nearestSlot ? selectedRef : undefined}
                type="button"
                onClick={() => { onChange(slot); setOpen(false); }}
                className={cn(
                  'w-full rounded px-2 py-1 text-left text-xs font-mono tabular-nums transition-colors',
                  isExact
                    ? 'bg-primary/15 font-semibold text-primary'
                    : isNearest
                      ? 'bg-panel-hover text-panel-text'
                      : 'text-panel-text-muted hover:bg-panel-hover hover:text-panel-text',
                )}
              >
                {slot}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Date + Time picker estilizado ───────────────────────────────────────────

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

  // Al seleccionar un día preserva la hora vigente
  const handleDaySelect = (date: Date | undefined) => {
    if (!date) return;
    const prev = value ?? new Date();
    const merged = new Date(date);
    merged.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    onChange(merged);
    setOpen(false);
  };

  // Al cambiar la hora preserva la fecha vigente
  const handleTimeChange = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const next = new Date(value ?? new Date());
    next.setHours(h, m, 0, 0);
    onChange(next);
  };

  const timeValue = value && !isNaN(value.getTime())
    ? `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
    : '00:00';

  return (
    <div className="flex gap-2">
      {/* Selector de fecha */}
      <Popover open={open && !disabled} onOpenChange={(v) => !disabled && setOpen(v)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-9 flex-1 items-center gap-2.5 rounded-md border border-panel-border',
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
              {value && !isNaN(value.getTime()) ? format(value, 'EEE', { locale: es }) : ''}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" sideOffset={6}>
          <CalendarUI
            mode="single"
            selected={value ?? undefined}
            onSelect={handleDaySelect}
            fromDate={fromDate}
            toDate={toDate}
            defaultMonth={value ?? fromDate}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {/* Selector de hora */}
      <TimePickerField
        value={timeValue}
        onChange={handleTimeChange}
        disabled={disabled}
      />
    </div>
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
    iniciarPlanificacion, iniciarPeriodoProgramado, iniciarColapsoProgramado, iniciarSimulacion, pausarSimulacion,
    reanudarSimulacion, resetear,
    contadores,
    resetSimulation,
  } = useSimulation();

  const [localConfig, setLocalConfig] = useState(config);
  const [currentTime,    setCurrentTime]    = useState(new Date());
  const [history,        setHistory]        = useState<HistoryRecord[]>(loadHistory);

  // Velocidad del colapso: K = min-dato por minuto-real. avance = K/60 min-dato
  // por segundo real → fija cuántas horas simuladas pasan en 1 s. Solo afecta la
  // velocidad visible (no la lógica): 1h/s=3600, 5h/s=18000, 10h/s=36000.
  const VELOCIDADES_COLAPSO = [
    { k: 3600,  horas: 1,  label: '1 s = 1 h' },
    { k: 18000, horas: 5,  label: '1 s = 5 h' },
    { k: 36000, horas: 10, label: '1 s = 10 h' },
  ] as const;
  const SA_COLAPSO = 300; // s reales entre bloques (Sc = K·Sa/60 = días/bloque)
  const kColapso = localConfig.velocidadColapsoK ?? VELOCIDADES_COLAPSO[0].k;

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
        fechaInicio: config.scenario === 'period' ? (() => {
          const sd = config.startDate;
          const p = (n: number) => String(n).padStart(2, '0');
          const base = `${sd.getFullYear()}-${p(sd.getMonth()+1)}-${p(sd.getDate())}`;
          const hasTime = sd.getHours() !== 0 || sd.getMinutes() !== 0;
          return hasTime ? `${base}T${p(sd.getHours())}:${p(sd.getMinutes())}` : base;
        })() : undefined,
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
  const datosDisponibles  = backendTieneDatos;

  // ── Cálculos derivados (T03/T10/T12) ──
  const esPeriodo  = localConfig.scenario === 'period';
  const esRealtime = localConfig.scenario === 'realtime';
  // Ambos eligen una fecha de inicio; día a día (realtime) simula exactamente 1 día.
  const esConFecha = esPeriodo || esRealtime;
  const diasEfectivos = esRealtime ? 1 : localConfig.dias;
  // Velocidad efectiva (solo aplica a Periodo comprimido; realtime es tiempo real).
  const velocidad = (diasEfectivos * 1440) / (localConfig.duracionRealMin * 60);
  // La duración real ya está acotada por el slider a 30-90; validamos por seguridad.
  const duracionFueraDeRango = esPeriodo && (localConfig.duracionRealMin < 30 || localConfig.duracionRealMin > 90);
  // Validación de rango de fecha: la ventana [inicio, inicio+dias) debe caber en el dataset.
  const fechaMaxDataset = datasetInfo ? new Date(datasetInfo.fecha_max + 'T23:59:59') : null;
  const fechaFinSim     = new Date(localConfig.startDate.getTime() + diasEfectivos * 86_400_000);
  const fechaFueraDeRango = esConFecha
    && !!fechaMaxDataset && fechaFinSim > fechaMaxDataset;
  const puedeIniciar = !esConFecha
    || (!fechaFueraDeRango && !duracionFueraDeRango);

  // ── Handlers ──

  // Guarda la config actual; si nada fue seleccionado usa realtime por defecto
  const handleGuardar = () => {
    const toSave = { ...localConfig };
    if (!toSave.scenario) toSave.scenario = 'period';
    updateConfig(toSave);
    resetSimulation();
    toast.success('Configuración guardada');
  };

  const handleIniciarPlanificacion = () => {
    if (!puedeIniciar) {
      toast.error('Revisa la configuración', {
        description: fechaFueraDeRango
          ? 'La ventana de simulación excede el rango del dataset.'
          : 'La duración real debe estar entre 30 y 90 minutos.',
      });
      return;
    }
    updateConfig(localConfig);

    // Periodo → orquestador Sa/Sc: 30 bloques, Sa=120s, Sc=dias·48 (~60 min).
    if (esPeriodo) {
      iniciarPeriodoProgramado({
        startDate: localConfig.startDate,
        dias:      localConfig.dias,
        criterio:  localConfig.criterio,
        warmUp:    localConfig.warmUp,  // el usuario decide el estado inicial
      });
      return;
    }

    // Tiempo Real → orquestador con K=60 (1 min-dato/seg-real): 1 día en ~24 min.
    if (esRealtime) {
      iniciarPeriodoProgramado({
        startDate: localConfig.startDate,
        dias:      1,
        criterio:  localConfig.criterio,
        warmUp:    localConfig.warmUp,
        scMin:     60,   // Sc = 60 min de datos por bloque
        saSeg:     60,   // cada 60 s reales  → K = 60
      });
      return;
    }

    // Colapso → inicia el nuevo endpoint de colapso del BFF/Ejecutor.
    iniciarColapsoProgramado({
      startDate:              localConfig.startDate,
      criterio:               localConfig.criterio,
      warmUp:                 false,
      k:                      kColapso,
      saSeg:                  SA_COLAPSO,
      maxDias:                540,
      umbralColapso:          0.85,
      umbralRechazosPct:      0.30,
      bloquesRojoConsecutivos: 3,
    });
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
              <Button
                onClick={handleIniciarPlanificacion}
                size="sm"
                disabled={!puedeIniciar}
                title={!puedeIniciar ? 'Corrige la configuración antes de iniciar' : undefined}
                className="bg-green-600 hover:bg-green-700"
              >
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
                      disabled={!esConFecha}
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
                          Sin datos de dataset — sube archivos en Ingreso de datos
                        </span>
                      )}
                    </div>
                    {fechaFueraDeRango && (
                      <div className="flex items-start gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          La ventana ({diasEfectivos} {diasEfectivos === 1 ? 'día' : 'días'} desde el inicio) termina el{' '}
                          <span className="font-mono font-semibold">{format(fechaFinSim, 'dd/MM/yyyy')}</span>,
                          fuera del rango del dataset ({datasetInfo?.fecha_max}). Elige una fecha más temprana
                          o menos días.
                        </span>
                      </div>
                    )}
                    {localConfig.scenario === 'realtime' && (
                      <p className="text-xs text-panel-text-faint">Día a día: simula 1 día desde la fecha elegida</p>
                    )}
                    {localConfig.scenario === 'collapse' && (
                      <p className="text-xs text-panel-text-faint">Solo editable en Periodo y Día a día</p>
                    )}
                  </div>

                  {/* Día a día (tiempo real): sin configuración de duración */}
                  {esRealtime && (
                    <div className="flex items-start gap-2 rounded-xl border border-blue-400/40 bg-blue-500/10 p-3">
                      <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Operación en tiempo real</p>
                        <p className="text-[10px] text-blue-600 dark:text-blue-400">
                          Arranca en la fecha/hora elegida mostrando el estado real de la red
                          (aviones en vuelo y almacenes ocupados) y avanza 1:1 con el reloj.
                          Controla con <strong>Iniciar</strong>, <strong>Pausar</strong> y <strong>Detener</strong>.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Duración de la simulación */}
                  {esPeriodo && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Duración de la simulación</Label>
                      <div className="rounded-md border border-panel-border bg-panel-section-bg px-3 py-2.5 text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-panel-text-muted">Duración real</span>
                          <span className="font-semibold text-panel-text tabular-nums">{localConfig.duracionRealMin} min</span>
                        </div>
                        <p className="text-[10px] text-panel-text-faint pt-0.5">
                          {diasEfectivos} {diasEfectivos === 1 ? 'día se comprime' : 'días se comprimen'} en {localConfig.duracionRealMin} min reales.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Velocidad — Colapso */}
                  {localConfig.scenario === 'collapse' && (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-300/70 bg-panel-section-bg p-4 text-sm text-panel-text shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-panel-text">Velocidad de la simulación</p>
                            <p className="mt-1 text-xs text-panel-text-muted">
                              Cuántas horas simuladas avanzan por segundo real. Solo cambia la
                              velocidad visible; la lógica del colapso no se altera.
                            </p>
                          </div>
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                            Colapso
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          {VELOCIDADES_COLAPSO.map((v) => {
                            const activo = kColapso === v.k;
                            return (
                              <button
                                key={v.k}
                                type="button"
                                onClick={() => setLocalConfig({ ...localConfig, velocidadColapsoK: v.k })}
                                aria-pressed={activo}
                                className={`flex items-center justify-center rounded-2xl border-2 p-4 transition-all ${
                                  activo
                                    ? 'border-primary bg-primary/10 text-panel-text'
                                    : 'border-slate-300/70 bg-background text-panel-text-muted hover:border-primary/50'
                                }`}
                              >
                                <span className="text-sm font-semibold">{v.label}</span>
                              </button>
                            );
                          })}
                        </div>
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

                      {/* Estado inicial: warm-up on/off (T02) */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Estado inicial de la red</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setLocalConfig({ ...localConfig, warmUp: false })}
                            className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                              !localConfig.warmUp
                                ? 'border-primary bg-primary/5 shadow-sm'
                                : 'border-panel-border bg-panel-bg hover:border-primary/40'
                            }`}
                          >
                            <span className={`text-xs font-semibold ${!localConfig.warmUp ? 'text-primary' : 'text-panel-text'}`}>
                              Desde cero
                            </span>
                            <span className="text-[10px] text-panel-text-faint leading-tight">
                              Tiempo 0 = fecha elegida. Solo procesa maletas desde ese momento.
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setLocalConfig({ ...localConfig, warmUp: true })}
                            className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                              localConfig.warmUp
                                ? 'border-primary bg-primary/5 shadow-sm'
                                : 'border-panel-border bg-panel-bg hover:border-primary/40'
                            }`}
                          >
                            <span className={`text-xs font-semibold ${localConfig.warmUp ? 'text-primary' : 'text-panel-text'}`}>
                              Cargar estado previo
                            </span>
                            <span className="text-[10px] text-panel-text-faint leading-tight">
                              Siembra aviones en vuelo y almacenes ocupados al inicio (lookback rápido).
                            </span>
                          </button>
                        </div>
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
