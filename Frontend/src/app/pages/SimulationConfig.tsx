import React, { useState, useEffect } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { useSimulation } from '../context/SimulationContext';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { SimulationScenario } from '../types';
import {
  Settings,
  Save,
  Calendar,
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
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

// ─── Slider de umbrales con pista tricolor ────────────────────────────────────

function ThresholdSlider({
  label,
  green,
  yellow,
  onChange,
}: {
  label: string;
  green: number;
  yellow: number;
  onChange: (green: number, yellow: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-panel-text">{label}</span>
        <div className="flex gap-3 text-xs font-medium">
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            Verde ≤ {green}%
          </span>
          <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            Ámbar ≤ {yellow}%
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            Rojo &gt; {yellow}%
          </span>
        </div>
      </div>
      <SliderPrimitive.Root
        min={0}
        max={100}
        step={1}
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
            className="block h-5 w-5 rounded-full border-2 border-white bg-white shadow-md ring-black/10 transition-shadow hover:ring-4 focus-visible:ring-4 focus-visible:outline-none dark:border-neutral-800 dark:bg-neutral-100"
          />
        ))}
      </SliderPrimitive.Root>
      <div className="flex text-xs text-panel-text-faint">
        <span>0%</span>
        <span className="flex-1" />
        <span>100%</span>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

const SCENARIO_LABELS: Record<SimulationScenario, string> = {
  realtime: 'Tiempo Real',
  period: 'Periodo',
  collapse: 'Colapso',
};

export function SimulationConfig() {
  const { config, updateConfig, resetSimulation, isRunning, startSimulation, pauseSimulation } =
    useSimulation();

  const [localConfig, setLocalConfig] = useState(config);
  const [airportsFile, setAirportsFile] = useState<File | null>(null);
  const [flightsFile, setFlightsFile] = useState<File | null>(null);
  const [shipmentsFile, setShipmentsFile] = useState<File | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [periodDays, setPeriodDays] = useState<3 | 5 | 7>(3);
  const [periodDurationMin, setPeriodDurationMin] = useState(60);

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const allFilesSelected = !!airportsFile && !!flightsFile && !!shipmentsFile;

  const handleGuardar = () => {
    updateConfig(localConfig);
    resetSimulation();
    toast.success('Configuración guardada', {
      description: 'La simulación ha sido reiniciada con los nuevos parámetros',
    });
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'airports' | 'flights' | 'shipments',
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      toast.error('Formato no válido — use archivos .txt');
      return;
    }
    if (type === 'airports') setAirportsFile(file);
    else if (type === 'flights') setFlightsFile(file);
    else setShipmentsFile(file);
  };

  const handleLoadData = () => {
    if (!allFilesSelected) return;
    // TODO: POST /api/carga/upload/* via BFF
    toast.success('Datos cargados', {
      description: 'Aeropuertos, vuelos y envíos listos para simular',
    });
    setDataLoaded(true);
  };

  const handleDownloadTemplate = (_tipo: 'aeropuertos' | 'vuelos' | 'envios') => {
    // TODO: GET /api/carga/plantillas/{tipo}
    toast.info('Disponible cuando el backend esté operativo');
  };

  const showSpeed = localConfig.scenario === 'collapse';

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Encabezado unificado ───────────────────────────────────────────── */}
      <div className="border-b border-panel-border bg-panel-bg px-6 pt-4 pb-3 shadow-sm">
        {/* Fila 1: título + acciones */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-panel-text">Configuración de Simulación</h1>
            <p className="text-sm text-panel-text-muted">
              Parámetros operacionales del sistema GVNS
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Controles de simulación */}
            {isRunning ? (
              <Button onClick={pauseSimulation} variant="outline" size="sm">
                <Pause className="mr-2 h-4 w-4" />
                Pausar
              </Button>
            ) : (
              <Button
                onClick={startSimulation}
                size="sm"
                disabled={!dataLoaded}
                title={!dataLoaded ? 'Carga los datos primero' : undefined}
                className="bg-green-600 hover:bg-green-700 disabled:bg-muted"
              >
                <Play className="mr-2 h-4 w-4" />
                Iniciar
              </Button>
            )}
            <Button onClick={resetSimulation} variant="outline" size="sm">
              <RotateCcw className="h-4 w-4" />
            </Button>

            <div className="mx-1 h-6 w-px bg-panel-border" />

            {/* Guardar / Descartar */}
            <Button variant="ghost" size="sm" onClick={() => setLocalConfig(config)}>
              <X className="mr-1.5 h-4 w-4" />
              Descartar
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="mr-2 h-4 w-4" />
              Guardar
            </Button>
          </div>
        </div>

        {/* Fila 2: información de estado */}
        <div className="mt-3 flex items-center gap-5 text-sm">
          <div className="flex items-center gap-1.5 text-panel-text-muted">
            <Clock className="h-4 w-4" />
            <span className="font-mono font-medium text-panel-text">
              {format(currentTime, 'dd/MM/yyyy HH:mm:ss')}
            </span>
          </div>
          <span className="text-panel-border">·</span>
          <div className="flex items-center gap-1.5 text-panel-text-muted">
            <span>Escenario:</span>
            <span className="font-medium text-panel-text">
              {SCENARIO_LABELS[localConfig.scenario]}
            </span>
          </div>
          {showSpeed && (
            <>
              <span className="text-panel-border">·</span>
              <div className="flex items-center gap-1.5 text-panel-text-muted">
                <Zap className="h-4 w-4" />
                <span className="font-medium text-panel-text">{localConfig.speed}x</span>
              </div>
            </>
          )}
          {localConfig.scenario === 'period' && (
            <>
              <span className="text-panel-border">·</span>
              <div className="flex items-center gap-1.5 text-panel-text-muted">
                <Timer className="h-4 w-4" />
                <span className="font-medium text-panel-text">
                  {periodDays} días · {periodDurationMin} min
                </span>
              </div>
            </>
          )}
          {!dataLoaded && (
            <>
              <span className="text-panel-border">·</span>
              <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                <AlertCircle className="h-3.5 w-3.5" />
                Sin datos cargados
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden p-6">
        <Tabs defaultValue="general" className="h-full">
          <TabsList className="mb-5">
            <TabsTrigger value="general">
              <Settings className="mr-1 h-4 w-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="thresholds">
              <Sliders className="mr-1 h-4 w-4" />
              Umbrales
            </TabsTrigger>
            <TabsTrigger value="history">
              <Calendar className="mr-1 h-4 w-4" />
              Historial
            </TabsTrigger>
          </TabsList>

          <div className="h-[calc(100%-3rem)] overflow-y-auto pr-1">
            {/* ── Tab: General ────────────────────────────────────────────── */}
            <TabsContent value="general" className="m-0">
              <div className="grid max-w-4xl grid-cols-2 gap-6">
                {/* Escenario */}
                <div className="col-span-2">
                  <Label htmlFor="scenario" className="text-sm font-medium">
                    Escenario de Simulación
                  </Label>
                  <Select
                    value={localConfig.scenario}
                    onValueChange={(v) =>
                      setLocalConfig({ ...localConfig, scenario: v as SimulationScenario })
                    }
                  >
                    <SelectTrigger id="scenario" className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="realtime">Día a Día (Tiempo Real)</SelectItem>
                      <SelectItem value="period">Simulación de Periodo (3–7 días)</SelectItem>
                      <SelectItem value="collapse">Simulación hasta Colapso</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-panel-text-muted">
                    {localConfig.scenario === 'realtime' &&
                      'Simulación continua para monitoreo día a día'}
                    {localConfig.scenario === 'period' &&
                      'Simula 3–7 días en 30–90 minutos reales usando GVNS'}
                    {localConfig.scenario === 'collapse' &&
                      'Incrementa la carga hasta alcanzar colapso operativo'}
                  </p>
                </div>

                {/* Fecha de inicio */}
                <div>
                  <Label htmlFor="startDate" className="text-sm font-medium">
                    Fecha de inicio
                  </Label>
                  <input
                    id="startDate"
                    type="date"
                    value={localConfig.startDate.toISOString().slice(0, 10)}
                    onChange={(e) =>
                      setLocalConfig({ ...localConfig, startDate: new Date(e.target.value) })
                    }
                    disabled={localConfig.scenario !== 'period'}
                    className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {localConfig.scenario !== 'period' && (
                    <p className="mt-1 text-xs text-panel-text-faint">
                      Solo editable en escenario Periodo
                    </p>
                  )}
                </div>

                {/* Parámetros de Periodo */}
                {localConfig.scenario === 'period' && (
                  <div className="col-span-2 rounded-xl border border-panel-border bg-panel-section-bg p-5">
                    <p className="mb-4 text-sm font-semibold text-panel-text">
                      Parámetros de Periodo
                    </p>

                    <div className="grid grid-cols-2 gap-8">
                      {/* Duración en minutos reales */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Duración real</Label>
                          <span className="rounded-md bg-panel-bg px-2 py-0.5 text-sm font-semibold tabular-nums text-panel-text">
                            {periodDurationMin} min
                          </span>
                        </div>
                        <SliderPrimitive.Root
                          min={30}
                          max={90}
                          step={5}
                          value={[periodDurationMin]}
                          onValueChange={([v]) => setPeriodDurationMin(v)}
                          className="relative flex w-full touch-none select-none items-center"
                        >
                          <SliderPrimitive.Track className="bg-muted relative h-2 w-full grow overflow-hidden rounded-full">
                            <SliderPrimitive.Range className="bg-primary absolute h-full" />
                          </SliderPrimitive.Track>
                          <SliderPrimitive.Thumb className="border-primary bg-background ring-ring/50 block h-4 w-4 rounded-full border shadow-sm transition-shadow hover:ring-4 focus-visible:ring-4 focus-visible:outline-none" />
                        </SliderPrimitive.Root>
                        <div className="flex justify-between text-xs text-panel-text-faint">
                          <span>30 min</span>
                          <span>90 min</span>
                        </div>
                      </div>

                      {/* Días a simular — cards */}
                      <div className="space-y-2">
                        <Label className="text-sm">Días a simular</Label>
                        <RadioGroup
                          value={String(periodDays)}
                          onValueChange={(v) => setPeriodDays(Number(v) as 3 | 5 | 7)}
                          className="grid grid-cols-3 gap-3"
                        >
                          {([3, 5, 7] as const).map((d) => (
                            <label
                              key={d}
                              htmlFor={`days-${d}`}
                              className={`flex cursor-pointer flex-col items-center rounded-lg border-2 px-3 py-3 transition-all ${
                                periodDays === d
                                  ? 'border-primary bg-primary/5 shadow-sm'
                                  : 'border-panel-border bg-panel-bg hover:border-primary/40'
                              }`}
                            >
                              <RadioGroupItem
                                value={String(d)}
                                id={`days-${d}`}
                                className="sr-only"
                              />
                              <span
                                className={`text-2xl font-bold ${periodDays === d ? 'text-primary' : 'text-panel-text'}`}
                              >
                                {d}
                              </span>
                              <span className="text-xs text-panel-text-muted">días</span>
                            </label>
                          ))}
                        </RadioGroup>
                      </div>
                    </div>
                  </div>
                )}

                {/* Velocidad — solo en Colapso */}
                {localConfig.scenario === 'collapse' && (
                  <div className="col-span-2 rounded-xl border border-panel-border bg-panel-section-bg p-5">
                    <p className="mb-4 text-sm font-semibold text-panel-text">
                      Velocidad de Simulación
                    </p>
                    <div className="max-w-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Velocidad</Label>
                        <span className="rounded-md bg-panel-bg px-2 py-0.5 text-sm font-semibold tabular-nums text-panel-text">
                          {localConfig.speed}x
                        </span>
                      </div>
                      <SliderPrimitive.Root
                        min={1}
                        max={200}
                        step={1}
                        value={[localConfig.speed]}
                        onValueChange={([v]) => setLocalConfig({ ...localConfig, speed: v })}
                        className="relative flex w-full touch-none select-none items-center"
                      >
                        <SliderPrimitive.Track className="bg-muted relative h-2 w-full grow overflow-hidden rounded-full">
                          <SliderPrimitive.Range className="bg-primary absolute h-full" />
                        </SliderPrimitive.Track>
                        <SliderPrimitive.Thumb className="border-primary bg-background ring-ring/50 block h-4 w-4 rounded-full border shadow-sm transition-shadow hover:ring-4 focus-visible:ring-4 focus-visible:outline-none" />
                      </SliderPrimitive.Root>
                      <div className="flex justify-between text-xs text-panel-text-faint">
                        <span>1x (real)</span>
                        <span>200x (máximo)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Tab: Planes de Vuelo ─────────────────────────────────────── */}
            <TabsContent value="files" className="m-0">
              <div className="max-w-4xl space-y-6">
                {!dataLoaded && (
                  <div className="flex items-start gap-3 rounded-lg border border-yellow-400/40 bg-yellow-500/10 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Selecciona los tres archivos y haz clic en{' '}
                      <strong>Cargar datos</strong> antes de iniciar la simulación.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  {(
                    [
                      {
                        id: 'airports-upload',
                        type: 'airports' as const,
                        label: 'Aeropuertos',
                        hint: 'aeropuertos.txt',
                        tpl: 'aeropuertos' as const,
                        file: airportsFile,
                      },
                      {
                        id: 'flights-upload',
                        type: 'flights' as const,
                        label: 'Vuelos',
                        hint: 'vuelos.txt',
                        tpl: 'vuelos' as const,
                        file: flightsFile,
                      },
                      {
                        id: 'shipments-upload',
                        type: 'shipments' as const,
                        label: 'Envíos',
                        hint: '_envios_XXXX_.txt',
                        tpl: 'envios' as const,
                        file: shipmentsFile,
                      },
                    ] as const
                  ).map(({ id, type, label, hint, tpl, file }) => (
                    <div key={id}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <Label>{label}</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleDownloadTemplate(tpl)}
                        >
                          <Download className="mr-1 h-3 w-3" />
                          Plantilla
                        </Button>
                      </div>
                      <input
                        id={id}
                        type="file"
                        accept=".txt"
                        onChange={(e) => handleFileUpload(e, type)}
                        className="hidden"
                      />
                      <label htmlFor={id}>
                        <div
                          className={`flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                            file
                              ? 'border-green-400 bg-green-500/10'
                              : 'border-panel-border bg-panel-section-bg hover:border-green-400 hover:bg-green-500/10'
                          }`}
                        >
                          <FileSpreadsheet
                            className={`h-8 w-8 ${file ? 'text-green-500' : 'text-panel-text-faint'}`}
                          />
                          <p className="mt-2 px-2 text-center text-xs text-panel-text-muted">
                            {file ? file.name : 'Seleccionar archivo'}
                          </p>
                          <p className="text-xs text-panel-text-faint">{hint}</p>
                        </div>
                      </label>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-4">
                  <Button onClick={handleLoadData} disabled={!allFilesSelected} className="gap-2">
                    <Upload className="h-4 w-4" />
                    Cargar datos
                  </Button>
                  {dataLoaded ? (
                    <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Datos cargados correctamente
                    </span>
                  ) : (
                    !allFilesSelected && (
                      <span className="text-xs text-panel-text-muted">
                        Selecciona los 3 archivos para habilitar la carga
                      </span>
                    )
                  )}
                </div>

                {/* Botón iniciar planificación */}
                {(fase === 'idle' || fase === 'error' || fase === 'completado') && (
                  <div className="pt-2">
                    <Button
                      onClick={handleIniciarPlanificacion}
                      className="w-full sm:w-auto"
                      size="lg"
                    >
                      <Play className="mr-2 h-5 w-5" />
                      Iniciar Planificación GVNS
                    </Button>
                    <p className="mt-2 text-xs text-panel-text-muted">
                      Ejecutará warm-up + GVNS para {localConfig.dias} días desde{' '}
                      <span className="font-medium">
                        {localConfig.startDate.toISOString().slice(0, 10)}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Tab: Umbrales ────────────────────────────────────────────── */}
            <TabsContent value="thresholds" className="m-0">
              <div className="max-w-2xl space-y-8">
                <p className="text-sm text-panel-text-muted">
                  Arrastra los controles para definir los límites de semaforización. El color del
                  mapa se actualiza en tiempo real según estos umbrales.
                </p>

                <div className="rounded-xl border border-panel-border bg-panel-section-bg p-5">
                  <ThresholdSlider
                    label="Ocupación de Almacenes"
                    green={localConfig.thresholds.warehouse.green}
                    yellow={localConfig.thresholds.warehouse.yellow}
                    onChange={(g, y) =>
                      setLocalConfig({
                        ...localConfig,
                        thresholds: {
                          ...localConfig.thresholds,
                          warehouse: { green: g, yellow: y, red: y },
                        },
                      })
                    }
                  />
                </div>

                <div className="rounded-xl border border-panel-border bg-panel-section-bg p-5">
                  <ThresholdSlider
                    label="Ocupación de Vuelos"
                    green={localConfig.thresholds.flight.green}
                    yellow={localConfig.thresholds.flight.yellow}
                    onChange={(g, y) =>
                      setLocalConfig({
                        ...localConfig,
                        thresholds: {
                          ...localConfig.thresholds,
                          flight: { green: g, yellow: y, red: y },
                        },
                      })
                    }
                  />
                </div>
              </div>
            </TabsContent>

            {/* ── Tab: Historial ───────────────────────────────────────────── */}
            <TabsContent value="history" className="m-0">
              <div className="max-w-5xl space-y-4">
                <p className="text-sm text-panel-text-muted">
                  Comparativa de simulaciones anteriores bajo diferentes configuraciones.
                </p>

                <div className="overflow-hidden rounded-xl border border-panel-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-panel-border bg-panel-section-bg">
                        <th className="px-4 py-3 text-left font-medium text-panel-text">Fecha</th>
                        <th className="px-4 py-3 text-left font-medium text-panel-text">
                          Escenario
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-panel-text">
                          Maletas
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-panel-text">
                          Tasa Éxito
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-panel-text">
                          Retrasadas
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-panel-text">
                          Duración
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          date: '01/04/2026 15:45',
                          scenario: 'Periodo',
                          bags: '2,890',
                          rate: 91.2,
                          delayed: 254,
                          duration: '45 min',
                        },
                        {
                          date: '31/03/2026 09:00',
                          scenario: 'Colapso',
                          bags: '4,567',
                          rate: 78.3,
                          delayed: 991,
                          duration: '1h 20min',
                        },
                        {
                          date: '28/03/2026 11:20',
                          scenario: 'Tiempo Real',
                          bags: '1,203',
                          rate: 95.8,
                          delayed: 51,
                          duration: '30 min',
                        },
                      ].map((row, i) => (
                        <tr
                          key={i}
                          className="border-t border-panel-border transition-colors hover:bg-panel-section-bg"
                        >
                          <td className="px-4 py-3 text-panel-text-muted">{row.date}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                row.scenario === 'Colapso'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  : row.scenario === 'Periodo'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              }`}
                            >
                              {row.scenario === 'Colapso' ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : row.scenario === 'Periodo' ? (
                                <Timer className="h-3 w-3" />
                              ) : (
                                <Clock className="h-3 w-3" />
                              )}
                              {row.scenario}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-panel-text">
                            {row.bags}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`font-semibold ${
                                row.rate >= 90
                                  ? 'text-green-600 dark:text-green-400'
                                  : row.rate >= 80
                                    ? 'text-yellow-600 dark:text-yellow-400'
                                    : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {row.rate}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                            {row.delayed.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-panel-text-muted">
                            {row.duration}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
