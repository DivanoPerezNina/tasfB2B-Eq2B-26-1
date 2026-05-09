import React, { useState, useEffect } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Slider } from '../components/ui/slider';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

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
      <h3 className="text-base font-semibold text-panel-text">{label}</h3>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[green, yellow]}
        onValueChange={([g, y]) => onChange(g, y)}
      />
      <div className="flex h-3 overflow-hidden rounded-full">
        <div className="bg-green-500 transition-all" style={{ width: `${green}%` }} />
        <div className="bg-yellow-500 transition-all" style={{ width: `${yellow - green}%` }} />
        <div className="flex-1 bg-red-500" />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-panel-text-faint">0%</span>
        <span className="text-green-600 dark:text-green-400">Verde ≤ {green}%</span>
        <span className="text-yellow-600 dark:text-yellow-400">Ámbar ≤ {yellow}%</span>
        <span className="text-red-600 dark:text-red-400">Rojo &gt; {yellow}%</span>
        <span className="text-panel-text-faint">100%</span>
      </div>
    </div>
  );
}

export function SimulationConfig() {
  const {
    config,
    updateConfig,
    resetSimulation,
    isRunning,
    startSimulation,
    pauseSimulation,
  } = useSimulation();

  const [localConfig, setLocalConfig] = useState(config);
  const [airportsFile, setAirportsFile] = useState<File | null>(null);
  const [flightsFile, setFlightsFile] = useState<File | null>(null);
  const [shipmentsFile, setShipmentsFile] = useState<File | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [periodDays, setPeriodDays] = useState<3 | 5 | 7>(3);
  const [periodDurationMin, setPeriodDurationMin] = useState(60);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const allFilesSelected = airportsFile !== null && flightsFile !== null && shipmentsFile !== null;

  const handleSave = () => {
    updateConfig(localConfig);
    resetSimulation();
    toast.success('Configuración guardada exitosamente', {
      description: 'La simulación ha sido reiniciada con los nuevos parámetros',
    });
  };

  const handleFileUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
    fileType: 'airports' | 'flights' | 'shipments',
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.txt') {
      toast.error('Formato no válido. Use archivos .txt');
      return;
    }
    if (fileType === 'airports') setAirportsFile(file);
    else if (fileType === 'flights') setFlightsFile(file);
    else setShipmentsFile(file);
  };

  const handleLoadData = () => {
    if (!allFilesSelected) return;
    // TODO: enviar archivos al BFF → /api/carga/upload/*
    toast.success('Datos cargados correctamente', {
      description: 'Aeropuertos, vuelos y envíos listos para simular',
    });
    setDataLoaded(true);
  };

  const handleDownloadTemplate = (_tipo: 'aeropuertos' | 'vuelos' | 'envios') => {
    // TODO: llamar GET /api/carga/plantillas/{tipo} cuando el BFF esté operativo
    toast.info('Plantillas disponibles cuando el backend esté operativo');
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="border-b border-panel-border bg-panel-bg px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-panel-text">Configuración de Simulación</h1>
            <p className="text-sm text-panel-text-muted">Parámetros operacionales del sistema GVNS</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLocalConfig(config)} size="sm">
              <X className="mr-2 h-4 w-4" />
              Descartar
            </Button>
            <Button onClick={handleSave} size="sm">
              <Save className="mr-2 h-4 w-4" />
              Guardar y Aplicar
            </Button>
          </div>
        </div>
      </div>

      {/* Barra de controles */}
      <div className="border-b border-panel-border bg-panel-bg px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-panel-text-muted" />
            <div>
              <p className="text-xs text-panel-text-faint">Tiempo actual</p>
              <p className="font-mono text-sm font-medium text-panel-text">
                {format(currentTime, 'dd/MM/yyyy HH:mm:ss')}
              </p>
            </div>
          </div>

          <div className="h-10 w-px bg-panel-border" />

          <div>
            <p className="text-xs text-panel-text-faint">Escenario</p>
            <p className="text-sm font-medium text-panel-text">
              {config.scenario === 'realtime'
                ? 'Tiempo Real'
                : config.scenario === 'period'
                  ? 'Periodo'
                  : 'Colapso'}
            </p>
          </div>

          <div className="h-10 w-px bg-panel-border" />

          <div>
            <p className="text-xs text-panel-text-faint">Velocidad</p>
            <p className="text-sm font-medium text-panel-text">{config.speed}x</p>
          </div>

          <div className="ml-auto flex gap-2">
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
                title={!dataLoaded ? 'Carga los datos antes de iniciar' : undefined}
              >
                <Play className="mr-2 h-4 w-4" />
                Iniciar
              </Button>
            )}
            <Button onClick={resetSimulation} variant="outline" size="sm">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reiniciar
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden p-6">
        <Tabs defaultValue="general" className="h-full">
          <TabsList className="mb-4">
            <TabsTrigger value="general">
              <Settings className="h-4 w-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="files">
              <Upload className="h-4 w-4" />
              Planes de Vuelo
            </TabsTrigger>
            <TabsTrigger value="thresholds">
              <Sliders className="h-4 w-4" />
              Umbrales
            </TabsTrigger>
            <TabsTrigger value="history">
              <Calendar className="h-4 w-4" />
              Historial
            </TabsTrigger>
          </TabsList>

          <div className="h-[calc(100%-3rem)] overflow-y-auto">
            {/* Tab: General */}
            <TabsContent value="general" className="m-0">
              <div className="max-w-2xl space-y-6">
                {/* Escenario */}
                <div>
                  <Label htmlFor="scenario">Escenario de Simulación</Label>
                  <Select
                    value={localConfig.scenario}
                    onValueChange={(v) =>
                      setLocalConfig({ ...localConfig, scenario: v as SimulationScenario })
                    }
                  >
                    <SelectTrigger id="scenario" className="mt-1.5 max-w-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="realtime">Día a Día (Tiempo Real)</SelectItem>
                      <SelectItem value="period">Simulación de Periodo (3–7 días)</SelectItem>
                      <SelectItem value="collapse">Simulación hasta Colapso</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-panel-text-muted">
                    {localConfig.scenario === 'realtime' &&
                      'Simulación en tiempo real para monitoreo continuo'}
                    {localConfig.scenario === 'period' &&
                      'Simula 3–7 días en 30–90 minutos reales'}
                    {localConfig.scenario === 'collapse' &&
                      'Simula hasta alcanzar colapso operativo'}
                  </p>
                </div>

                {/* Fecha de inicio — solo editable en Periodo */}
                <div className="max-w-xs">
                  <Label htmlFor="startDate">Fecha de inicio</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={localConfig.startDate.toISOString().slice(0, 10)}
                    onChange={(e) =>
                      setLocalConfig({ ...localConfig, startDate: new Date(e.target.value) })
                    }
                    disabled={localConfig.scenario !== 'period'}
                    className="mt-1.5"
                  />
                  {localConfig.scenario !== 'period' && (
                    <p className="mt-1 text-xs text-panel-text-faint">
                      Solo editable en escenario Periodo
                    </p>
                  )}
                </div>

                {/* Parámetros exclusivos de Periodo */}
                {localConfig.scenario === 'period' && (
                  <div className="space-y-5 rounded-lg border border-panel-border bg-panel-section-bg p-4">
                    <h3 className="text-sm font-semibold text-panel-text">Parámetros de Periodo</h3>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label>Duración de simulación</Label>
                        <span className="text-sm font-medium text-panel-text">
                          {periodDurationMin} min
                        </span>
                      </div>
                      <Slider
                        min={30}
                        max={90}
                        step={5}
                        value={[periodDurationMin]}
                        onValueChange={([v]) => setPeriodDurationMin(v)}
                      />
                      <p className="mt-1.5 text-xs text-panel-text-muted">
                        Tiempo real que tomará la simulación (30–90 minutos)
                      </p>
                    </div>

                    <div>
                      <Label className="mb-2 block">Días a simular</Label>
                      <RadioGroup
                        value={String(periodDays)}
                        onValueChange={(v) => setPeriodDays(Number(v) as 3 | 5 | 7)}
                        className="flex gap-6"
                      >
                        {([3, 5, 7] as const).map((d) => (
                          <div key={d} className="flex items-center gap-2">
                            <RadioGroupItem value={String(d)} id={`days-${d}`} />
                            <Label htmlFor={`days-${d}`} className="cursor-pointer font-normal">
                              {d} días
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>
                  </div>
                )}

                {/* Velocidad — solo en Colapso */}
                {localConfig.scenario === 'collapse' && (
                  <div className="space-y-3 rounded-lg border border-panel-border bg-panel-section-bg p-4">
                    <h3 className="text-sm font-semibold text-panel-text">Velocidad de Simulación</h3>
                    <div className="flex items-center justify-between">
                      <Label>Velocidad</Label>
                      <span className="text-sm font-medium text-panel-text">
                        {localConfig.speed}x
                      </span>
                    </div>
                    <Slider
                      min={1}
                      max={200}
                      step={1}
                      value={[localConfig.speed]}
                      onValueChange={([v]) => setLocalConfig({ ...localConfig, speed: v })}
                    />
                    <p className="text-xs text-panel-text-muted">
                      1x = tiempo real · 60x = 1 hora/minuto · 200x = máximo
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab: Planes de Vuelo */}
            <TabsContent value="files" className="m-0">
              <div className="max-w-4xl space-y-6">
                {!dataLoaded && (
                  <div className="flex items-start gap-3 rounded-lg border border-yellow-400/40 bg-yellow-500/10 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Debes cargar los datos antes de iniciar la simulación. Selecciona los tres
                      archivos y haz clic en <strong>Cargar datos</strong>.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  {/* Aeropuertos */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <Label htmlFor="airports-upload">Aeropuertos</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleDownloadTemplate('aeropuertos')}
                      >
                        <Download className="mr-1 h-3 w-3" />
                        Plantilla
                      </Button>
                    </div>
                    <input
                      id="airports-upload"
                      type="file"
                      accept=".txt"
                      onChange={(e) => handleFileUpload(e, 'airports')}
                      className="hidden"
                    />
                    <label htmlFor="airports-upload">
                      <div
                        className={`flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                          airportsFile
                            ? 'border-green-400 bg-green-500/10'
                            : 'border-panel-border bg-panel-section-bg hover:border-green-400 hover:bg-green-500/10'
                        }`}
                      >
                        <FileSpreadsheet
                          className={`h-8 w-8 ${airportsFile ? 'text-green-500' : 'text-panel-text-faint'}`}
                        />
                        <p className="mt-2 px-2 text-center text-xs text-panel-text-muted">
                          {airportsFile ? airportsFile.name : 'Seleccionar archivo'}
                        </p>
                        <p className="text-xs text-panel-text-faint">aeropuertos.txt</p>
                      </div>
                    </label>
                  </div>

                  {/* Vuelos */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <Label htmlFor="flights-upload">Vuelos</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleDownloadTemplate('vuelos')}
                      >
                        <Download className="mr-1 h-3 w-3" />
                        Plantilla
                      </Button>
                    </div>
                    <input
                      id="flights-upload"
                      type="file"
                      accept=".txt"
                      onChange={(e) => handleFileUpload(e, 'flights')}
                      className="hidden"
                    />
                    <label htmlFor="flights-upload">
                      <div
                        className={`flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                          flightsFile
                            ? 'border-green-400 bg-green-500/10'
                            : 'border-panel-border bg-panel-section-bg hover:border-green-400 hover:bg-green-500/10'
                        }`}
                      >
                        <FileSpreadsheet
                          className={`h-8 w-8 ${flightsFile ? 'text-green-500' : 'text-panel-text-faint'}`}
                        />
                        <p className="mt-2 px-2 text-center text-xs text-panel-text-muted">
                          {flightsFile ? flightsFile.name : 'Seleccionar archivo'}
                        </p>
                        <p className="text-xs text-panel-text-faint">vuelos.txt</p>
                      </div>
                    </label>
                  </div>

                  {/* Envíos */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <Label htmlFor="shipments-upload">Envíos</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleDownloadTemplate('envios')}
                      >
                        <Download className="mr-1 h-3 w-3" />
                        Plantilla
                      </Button>
                    </div>
                    <input
                      id="shipments-upload"
                      type="file"
                      accept=".txt"
                      onChange={(e) => handleFileUpload(e, 'shipments')}
                      className="hidden"
                    />
                    <label htmlFor="shipments-upload">
                      <div
                        className={`flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                          shipmentsFile
                            ? 'border-green-400 bg-green-500/10'
                            : 'border-panel-border bg-panel-section-bg hover:border-green-400 hover:bg-green-500/10'
                        }`}
                      >
                        <FileSpreadsheet
                          className={`h-8 w-8 ${shipmentsFile ? 'text-green-500' : 'text-panel-text-faint'}`}
                        />
                        <p className="mt-2 px-2 text-center text-xs text-panel-text-muted">
                          {shipmentsFile ? shipmentsFile.name : 'Seleccionar archivo'}
                        </p>
                        <p className="text-xs text-panel-text-faint">_envios_XXXX_.txt</p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Button onClick={handleLoadData} disabled={!allFilesSelected} className="gap-2">
                    <Upload className="h-4 w-4" />
                    Cargar datos
                  </Button>
                  {dataLoaded ? (
                    <span className="text-sm text-green-600 dark:text-green-400">
                      ✓ Datos cargados correctamente
                    </span>
                  ) : (
                    !allFilesSelected && (
                      <span className="text-xs text-panel-text-muted">
                        Selecciona los 3 archivos para habilitar la carga
                      </span>
                    )
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Tab: Umbrales */}
            <TabsContent value="thresholds" className="m-0">
              <div className="max-w-2xl space-y-10">
                <ThresholdSlider
                  label="Almacenes"
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
                <ThresholdSlider
                  label="Vuelos"
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
            </TabsContent>

            {/* Tab: Historial */}
            <TabsContent value="history" className="m-0">
              <div className="max-w-5xl">
                <div className="rounded-lg border border-panel-border bg-panel-bg">
                  <table className="w-full">
                    <thead className="bg-panel-section-bg">
                      <tr>
                        <th className="p-3 text-left text-sm font-medium">Fecha</th>
                        <th className="p-3 text-left text-sm font-medium">Escenario</th>
                        <th className="p-3 text-left text-sm font-medium">Maletas</th>
                        <th className="p-3 text-left text-sm font-medium">Tasa Éxito</th>
                        <th className="p-3 text-left text-sm font-medium">Retrasadas</th>
                        <th className="p-3 text-left text-sm font-medium">Duración</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t bg-panel-section-bg">
                        <td className="p-3 text-sm">01/04/2026 15:45</td>
                        <td className="p-3 text-sm">Periodo</td>
                        <td className="p-3 text-sm">2,890</td>
                        <td className="p-3 text-sm text-green-600">91.2%</td>
                        <td className="p-3 text-sm text-red-600">254</td>
                        <td className="p-3 text-sm">45 min</td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3 text-sm">31/03/2026 09:00</td>
                        <td className="p-3 text-sm">Colapso</td>
                        <td className="p-3 text-sm">4,567</td>
                        <td className="p-3 text-sm text-yellow-600">78.3%</td>
                        <td className="p-3 text-sm text-red-600">991</td>
                        <td className="p-3 text-sm">1h 20min</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-sm text-panel-text-muted">
                  Los datos históricos permiten comparar el rendimiento del sistema bajo diferentes
                  configuraciones y escenarios de estrés.
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
