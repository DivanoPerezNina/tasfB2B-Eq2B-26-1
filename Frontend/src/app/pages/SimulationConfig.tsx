import React, { useState } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { SimulationScenario } from '../types';
import { Settings, Save, Calendar, Sliders, Play, Pause, RotateCcw, Clock, Upload, FileSpreadsheet, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function SimulationConfig() {
  const {
    config,
    updateConfig,
    resetSimulation,
    isRunning,
    startSimulation,
    pauseSimulation,
    simulationTime
  } = useSimulation();

  const [localConfig, setLocalConfig] = useState(config);
  const [airportsFile, setAirportsFile] = useState<File | null>(null);
  const [flightsFile, setFlightsFile] = useState<File | null>(null);
  const [shipmentsFile, setShipmentsFile] = useState<File | null>(null);

  const handleSave = () => {
    updateConfig(localConfig);
    resetSimulation();
    toast.success('Configuración guardada exitosamente', {
      description: 'La simulación ha sido reiniciada con los nuevos parámetros'
    });
  };

  const handleFileUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
    fileType: 'airports' | 'flights' | 'shipments'
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ['.txt'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!validTypes.some(type => type === fileExtension)) {
      toast.error('Formato no válido. Use archivos .txt');
      return;
    }

    const fileLabels = {
      airports: 'Aeropuertos',
      flights: 'Vuelos',
      shipments: 'Envíos'
    };

    if (fileType === 'airports') setAirportsFile(file);
    else if (fileType === 'flights') setFlightsFile(file);
    else setShipmentsFile(file);

    toast.success(`Archivo de ${fileLabels[fileType]} cargado: ${file.name}`);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header con botones siempre visibles */}
      <div className="border-b border-panel-border bg-panel-bg px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-panel-text">Configuración de Simulación</h1>
            <p className="text-sm text-panel-text-muted">Par��metros operacionales del sistema GVNS</p>
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

      {/* Controles de Simulación */}
      <div className="border-b border-panel-border bg-panel-bg px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-panel-text-muted" />
            <div>
              <p className="text-xs text-panel-text-faint">Tiempo de Simulación</p>
              <p className="font-mono text-sm font-medium text-panel-text">
                {format(simulationTime, 'dd/MM/yyyy HH:mm:ss')}
              </p>
            </div>
          </div>

          <div className="h-10 w-px bg-panel-border" />

          <div>
            <p className="text-xs text-panel-text-faint">Escenario</p>
            <p className="text-sm font-medium capitalize text-panel-text">
              {config.scenario === 'realtime' ? 'Tiempo Real' :
               config.scenario === 'period' ? 'Periodo' : 'Colapso'}
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
              <Button onClick={startSimulation} size="sm">
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

      {/* Contenido con Tabs */}
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
              <div className="max-w-3xl space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="scenario">Escenario de Simulación</Label>
                    <Select
                      value={localConfig.scenario}
                      onValueChange={(v) => setLocalConfig({ ...localConfig, scenario: v as SimulationScenario })}
                    >
                      <SelectTrigger id="scenario" className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="realtime">Día a Día (Tiempo Real)</SelectItem>
                        <SelectItem value="period">Simulación de Periodo (3-7 días)</SelectItem>
                        <SelectItem value="collapse">Simulación hasta Colapso</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-xs text-panel-text-muted">
                      {localConfig.scenario === 'realtime' && 'Simulación en tiempo real para monitoreo continuo'}
                      {localConfig.scenario === 'period' && 'Simula 3-7 días en 30-90 minutos reales'}
                      {localConfig.scenario === 'collapse' && 'Simula hasta alcanzar colapso operativo'}
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="speed">Velocidad de Simulación</Label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        id="speed"
                        type="number"
                        min="1"
                        max="1000"
                        value={localConfig.speed}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          speed: parseInt(e.target.value) || 1
                        })}
                        className="w-28"
                      />
                      <span className="text-sm text-panel-text-muted">x veces más rápido</span>
                    </div>
                    <p className="mt-1.5 text-xs text-panel-text-muted">
                      1x = tiempo real, 60x = 1 hora simulada por minuto
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="startDate">Fecha y Hora de Inicio</Label>
                    <Input
                      id="startDate"
                      type="datetime-local"
                      value={localConfig.startDate.toISOString().slice(0, 16)}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        startDate: new Date(e.target.value)
                      })}
                      className="mt-1.5"
                    />
                  </div>

                  {localConfig.scenario === 'period' && (
                    <div>
                      <Label htmlFor="endDate">Fecha y Hora de Fin</Label>
                      <Input
                        id="endDate"
                        type="datetime-local"
                        value={localConfig.endDate?.toISOString().slice(0, 16) || ''}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          endDate: new Date(e.target.value)
                        })}
                        className="mt-1.5"
                      />
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Tab: Planes de Vuelo */}
            <TabsContent value="files" className="m-0">
              <div className="max-w-4xl">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="airports-upload">Archivo de Aeropuertos</Label>
                    <input
                      id="airports-upload"
                      type="file"
                      accept=".txt"
                      onChange={(e) => handleFileUpload(e, 'airports')}
                      className="hidden"
                    />
                    <label htmlFor="airports-upload">
                      <div className="mt-1.5 flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-panel-border bg-panel-section-bg transition-colors hover:border-green-400 hover:bg-green-500/10">
                        <FileSpreadsheet className="h-8 w-8 text-panel-text-faint" />
                        <p className="mt-2 text-center text-xs text-panel-text-muted px-2">
                          {airportsFile ? airportsFile.name : 'Seleccionar archivo'}
                        </p>
                        <p className="text-xs text-panel-text-faint">.txt</p>
                      </div>
                    </label>
                  </div>

                  <div>
                    <Label htmlFor="flights-upload">Archivo de Vuelos</Label>
                    <input
                      id="flights-upload"
                      type="file"
                      accept=".txt"
                      onChange={(e) => handleFileUpload(e, 'flights')}
                      className="hidden"
                    />
                    <label htmlFor="flights-upload">
                      <div className="mt-1.5 flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-panel-border bg-panel-section-bg transition-colors hover:border-green-400 hover:bg-green-500/10">
                        <FileSpreadsheet className="h-8 w-8 text-panel-text-faint" />
                        <p className="mt-2 text-center text-xs text-panel-text-muted px-2">
                          {flightsFile ? flightsFile.name : 'Seleccionar archivo'}
                        </p>
                        <p className="text-xs text-panel-text-faint">.txt</p>
                      </div>
                    </label>
                  </div>

                  <div>
                    <Label htmlFor="shipments-upload">Archivo de Envíos</Label>
                    <input
                      id="shipments-upload"
                      type="file"
                      accept=".txt"
                      onChange={(e) => handleFileUpload(e, 'shipments')}
                      className="hidden"
                    />
                    <label htmlFor="shipments-upload">
                      <div className="mt-1.5 flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-panel-border bg-panel-section-bg transition-colors hover:border-green-400 hover:bg-green-500/10">
                        <FileSpreadsheet className="h-8 w-8 text-panel-text-faint" />
                        <p className="mt-2 text-center text-xs text-panel-text-muted px-2">
                          {shipmentsFile ? shipmentsFile.name : 'Seleccionar archivo'}
                        </p>
                        <p className="text-xs text-panel-text-faint">.txt</p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="mt-6 rounded-lg bg-blue-500/10 p-4">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    <strong>Nota:</strong> Los archivos deben estar en formato .txt con la estructura especificada.
                    Una vez cargados, haz clic en "Guardar y Aplicar" para procesar los datos.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Tab: Umbrales */}
            <TabsContent value="thresholds" className="m-0">
              <div className="max-w-4xl">
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <h3 className="mb-4 text-base font-semibold">Almacenes</h3>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-32">
                          <Label className="text-sm">Verde (OK)</Label>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localConfig.thresholds.warehouse.green}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            thresholds: {
                              ...localConfig.thresholds,
                              warehouse: {
                                ...localConfig.thresholds.warehouse,
                                green: parseInt(e.target.value) || 0
                              }
                            }
                          })}
                          className="w-24"
                        />
                        <span className="text-sm text-panel-text-muted">% o menos</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-32">
                          <Label className="text-sm">Ámbar (Media)</Label>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localConfig.thresholds.warehouse.yellow}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            thresholds: {
                              ...localConfig.thresholds,
                              warehouse: {
                                ...localConfig.thresholds.warehouse,
                                yellow: parseInt(e.target.value) || 0
                              }
                            }
                          })}
                          className="w-24"
                        />
                        <span className="text-sm text-panel-text-muted">% o menos</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-32">
                          <Label className="text-sm">Rojo (Alta)</Label>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localConfig.thresholds.warehouse.red}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            thresholds: {
                              ...localConfig.thresholds,
                              warehouse: {
                                ...localConfig.thresholds.warehouse,
                                red: parseInt(e.target.value) || 0
                              }
                            }
                          })}
                          className="w-24"
                        />
                        <span className="text-sm text-panel-text-muted">% o más</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-4 text-base font-semibold">Vuelos</h3>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-32">
                          <Label className="text-sm">Verde (OK)</Label>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localConfig.thresholds.flight.green}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            thresholds: {
                              ...localConfig.thresholds,
                              flight: {
                                ...localConfig.thresholds.flight,
                                green: parseInt(e.target.value) || 0
                              }
                            }
                          })}
                          className="w-24"
                        />
                        <span className="text-sm text-panel-text-muted">% o menos</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-32">
                          <Label className="text-sm">Ámbar (Media)</Label>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localConfig.thresholds.flight.yellow}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            thresholds: {
                              ...localConfig.thresholds,
                              flight: {
                                ...localConfig.thresholds.flight,
                                yellow: parseInt(e.target.value) || 0
                              }
                            }
                          })}
                          className="w-24"
                        />
                        <span className="text-sm text-panel-text-muted">% o menos</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-32">
                          <Label className="text-sm">Rojo (Alta)</Label>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localConfig.thresholds.flight.red}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            thresholds: {
                              ...localConfig.thresholds,
                              flight: {
                                ...localConfig.thresholds.flight,
                                red: parseInt(e.target.value) || 0
                              }
                            }
                          })}
                          className="w-24"
                        />
                        <span className="text-sm text-panel-text-muted">% o más</span>
                      </div>
                    </div>
                  </div>
                </div>
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