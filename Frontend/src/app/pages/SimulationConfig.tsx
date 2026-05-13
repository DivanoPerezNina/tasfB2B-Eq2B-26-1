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
import { Progress } from '../components/ui/progress';
import { CriterioOrden, SimulationScenario } from '../types';
import {
  Settings, Save, Calendar, Sliders, Play, Pause,
  RotateCcw, Clock, X, Loader2, CheckCircle2, AlertCircle,
  StopCircle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function SimulationConfig() {
  const {
    config,
    updateConfig,
    fase,
    errorMsg,
    planProgreso,
    planMensaje,
    isRunning,
    simulationTime,
    progresoPct,
    contadores,
    datasetInfo,
    iniciarPlanificacion,
    iniciarSimulacion,
    pausarSimulacion,
    reanudarSimulacion,
    detenerSimulacion,
    resetear,
  } = useSimulation();

  const [localConfig, setLocalConfig] = useState(config);

  const handleGuardar = () => {
    updateConfig(localConfig);
    toast.success('Configuración guardada', {
      description: 'Se aplicará en la próxima planificación',
    });
  };

  const handleIniciarPlanificacion = async () => {
    updateConfig(localConfig);
    await iniciarPlanificacion();
  };

  const handleIniciarSimulacion = async () => {
    await iniciarSimulacion();
  };

  // ─── Barra de estado superior ─────────────────────────────────────────────

  const renderEstadoBadge = () => {
    const badges: Record<string, { label: string; cls: string }> = {
      idle:         { label: 'Sin iniciar',    cls: 'bg-slate-100 text-slate-600' },
      planificando: { label: 'Planificando…',  cls: 'bg-yellow-100 text-yellow-700' },
      listo:        { label: 'Plan listo ✓',   cls: 'bg-blue-100 text-blue-700' },
      ejecutando:   { label: 'Ejecutando',     cls: 'bg-green-100 text-green-700' },
      pausado:      { label: 'Pausado',        cls: 'bg-orange-100 text-orange-700' },
      completado:   { label: 'Completado ✓',   cls: 'bg-green-100 text-green-800' },
      error:        { label: 'Error',          cls: 'bg-red-100 text-red-700' },
    };
    const b = badges[fase] ?? badges.idle;
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${b.cls}`}>
        {b.label}
      </span>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="border-b border-panel-border bg-panel-bg px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-panel-text">Simulación de Periodo</h1>
            <p className="text-sm text-panel-text-muted">
              Planificación GVNS + simulación acelerada (3 / 5 / 7 días)
            </p>
          </div>
          <div className="flex items-center gap-3">
            {renderEstadoBadge()}
            <Button variant="outline" onClick={() => setLocalConfig(config)} size="sm">
              <X className="mr-2 h-4 w-4" />
              Descartar
            </Button>
            <Button onClick={handleGuardar} size="sm" disabled={fase !== 'idle' && fase !== 'error' && fase !== 'completado'}>
              <Save className="mr-2 h-4 w-4" />
              Guardar
            </Button>
          </div>
        </div>
      </div>

      {/* ── Barra de progreso de planificación ── */}
      {(fase === 'planificando') && (
        <div className="border-b border-panel-border bg-yellow-50 px-6 py-3 dark:bg-yellow-900/20">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-yellow-700 dark:text-yellow-300">{planMensaje}</span>
                <span className="font-medium text-yellow-700 dark:text-yellow-300">{planProgreso}%</span>
              </div>
              <Progress value={planProgreso} className="h-2" />
            </div>
          </div>
        </div>
      )}

      {/* ── Listo para simular ── */}
      {fase === 'listo' && (
        <div className="border-b border-panel-border bg-blue-50 px-6 py-3 dark:bg-blue-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Plan generado — {localConfig.dias} días desde {localConfig.startDate?.toISOString().slice(0,10)}
              </span>
            </div>
            <Button onClick={handleIniciarSimulacion} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
              <Play className="mr-2 h-4 w-4" />
              Iniciar Simulación
            </Button>
          </div>
        </div>
      )}

      {/* ── Controles en vivo (ejecutando / pausado / completado) ── */}
      {(fase === 'ejecutando' || fase === 'pausado' || fase === 'completado') && (
        <div className="border-b border-panel-border bg-panel-bg px-6 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-panel-text-muted" />
              <div>
                <p className="text-xs text-panel-text-faint">Tiempo simulado</p>
                <p className="font-mono text-sm font-medium text-panel-text">
                  {format(simulationTime, 'dd/MM/yyyy HH:mm')}
                </p>
              </div>
            </div>

            <div className="h-10 w-px bg-panel-border" />

            {/* Progreso */}
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-xs text-panel-text-muted">
                <span>Progreso</span>
                <span className="font-medium">{progresoPct.toFixed(1)}%</span>
              </div>
              <Progress value={progresoPct} className="h-2" />
            </div>

            <div className="h-10 w-px bg-panel-border" />

            {/* Contadores */}
            <div className="flex gap-4 text-xs">
              <div className="text-center">
                <p className="font-bold text-blue-600">{contadores.en_vuelo + contadores.en_escala}</p>
                <p className="text-panel-text-faint">En tránsito</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-green-600">{contadores.entregado}</p>
                <p className="text-panel-text-faint">Entregado</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-red-500">{contadores.rechazado}</p>
                <p className="text-panel-text-faint">Rechazado</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-panel-text">{contadores.total}</p>
                <p className="text-panel-text-faint">Total</p>
              </div>
            </div>

            <div className="ml-auto flex gap-2">
              {fase === 'ejecutando' ? (
                <Button onClick={() => pausarSimulacion()} variant="outline" size="sm">
                  <Pause className="mr-2 h-4 w-4" />
                  Pausar
                </Button>
              ) : fase === 'pausado' ? (
                <Button onClick={() => reanudarSimulacion()} size="sm">
                  <Play className="mr-2 h-4 w-4" />
                  Reanudar
                </Button>
              ) : null}
              {(fase === 'ejecutando' || fase === 'pausado') && (
                <Button
                  onClick={() => { detenerSimulacion(); toast.info('Simulación detenida'); }}
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                >
                  <StopCircle className="mr-2 h-4 w-4" />
                  Detener
                </Button>
              )}
              {fase === 'completado' && (
                <Button onClick={() => resetear()} variant="outline" size="sm">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Nueva simulación
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {fase === 'error' && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-3 dark:bg-red-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-red-700 dark:text-red-300">{errorMsg}</span>
            </div>
            <Button onClick={() => resetear()} variant="outline" size="sm">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>
          </div>
        </div>
      )}

      {/* ── Tabs de configuración ── */}
      <div className="flex-1 overflow-hidden p-6">
        <Tabs defaultValue="general" className="h-full">
          <TabsList className="mb-4">
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

          <div className="h-[calc(100%-3rem)] overflow-y-auto">
            {/* ── Tab: General ── */}
            <TabsContent value="general" className="m-0">
              <div className="max-w-3xl space-y-6">

                {/* Dataset info */}
                {datasetInfo && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm font-semibold">Rango del dataset disponible</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <div className="flex gap-8 text-sm">
                        <div>
                          <p className="text-xs text-panel-text-faint">Desde</p>
                          <p className="font-mono font-medium">{datasetInfo.fecha_min}</p>
                        </div>
                        <div>
                          <p className="text-xs text-panel-text-faint">Hasta</p>
                          <p className="font-mono font-medium">{datasetInfo.fecha_max}</p>
                        </div>
                        <div>
                          <p className="text-xs text-panel-text-faint">Total envíos</p>
                          <p className="font-mono font-medium">
                            {parseInt(datasetInfo.total_envios).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Scenario */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label>Escenario</Label>
                    <Select
                      value={localConfig.scenario}
                      onValueChange={v => setLocalConfig({ ...localConfig, scenario: v as SimulationScenario })}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="period">Simulación de Periodo (3–7 días)</SelectItem>
                        <SelectItem value="realtime">Tiempo Real (día a día)</SelectItem>
                        <SelectItem value="collapse">Hasta Colapso</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Criterio GVNS</Label>
                    <Select
                      value={localConfig.criterio}
                      onValueChange={v => setLocalConfig({ ...localConfig, criterio: v as CriterioOrden })}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EDF">EDF — Earliest Deadline First</SelectItem>
                        <SelectItem value="FIFO">FIFO — First In First Out</SelectItem>
                        <SelectItem value="ALEATORIO">Aleatorio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Fecha inicio + Días */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="startDate">Fecha de inicio</Label>
                    <Input
                      id="startDate"
                      type="date"
                      min={datasetInfo?.fecha_min}
                      max={datasetInfo?.fecha_max}
                      value={localConfig.startDate.toISOString().slice(0, 10)}
                      onChange={e => setLocalConfig({
                        ...localConfig,
                        startDate: new Date(e.target.value + 'T00:00:00'),
                      })}
                      className="mt-1.5"
                    />
                    <p className="mt-1 text-xs text-panel-text-muted">
                      Dentro del rango del dataset
                    </p>
                  </div>

                  <div>
                    <Label>Días a simular</Label>
                    <Select
                      value={String(localConfig.dias)}
                      onValueChange={v => setLocalConfig({ ...localConfig, dias: parseInt(v) })}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">3 días</SelectItem>
                        <SelectItem value="5">5 días</SelectItem>
                        <SelectItem value="7">7 días</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-panel-text-muted">
                      Ventana temporal que planifica y simula GVNS
                    </p>
                  </div>
                </div>

                {/* Duración real */}
                <div className="max-w-sm">
                  <Label>Duración real de la simulación</Label>
                  <Select
                    value={String(localConfig.duracionRealMin)}
                    onValueChange={v => setLocalConfig({
                      ...localConfig,
                      duracionRealMin: parseInt(v),
                      speed: Math.round((localConfig.dias * 1440) / (parseInt(v) * 60)),
                    })}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 minutos</SelectItem>
                      <SelectItem value="45">45 minutos</SelectItem>
                      <SelectItem value="60">60 minutos (1 hora)</SelectItem>
                      <SelectItem value="90">90 minutos (1.5 horas)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-panel-text-muted">
                    Velocidad efectiva:{' '}
                    <span className="font-semibold text-panel-text">
                      {((localConfig.dias * 1440) / (localConfig.duracionRealMin * 60)).toFixed(1)}×
                    </span>{' '}
                    ({localConfig.dias} días simulados en {localConfig.duracionRealMin} min reales)
                  </p>
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

            {/* ── Tab: Umbrales ── */}
            <TabsContent value="thresholds" className="m-0">
              <div className="max-w-4xl">
                <div className="grid grid-cols-2 gap-8">
                  {/* Almacenes */}
                  <div>
                    <h3 className="mb-4 text-base font-semibold">Almacenes</h3>
                    <div className="space-y-4">
                      {(['green', 'yellow', 'red'] as const).map(color => (
                        <div key={color} className="flex items-center gap-3">
                          <div className="w-32">
                            <Label className="text-sm capitalize">
                              {color === 'green' ? '🟢 Verde (OK)' : color === 'yellow' ? '🟡 Ámbar' : '🔴 Rojo'}
                            </Label>
                          </div>
                          <Input
                            type="number" min="0" max="100"
                            value={localConfig.thresholds.warehouse[color]}
                            onChange={e => setLocalConfig({
                              ...localConfig,
                              thresholds: {
                                ...localConfig.thresholds,
                                warehouse: {
                                  ...localConfig.thresholds.warehouse,
                                  [color]: parseInt(e.target.value) || 0,
                                },
                              },
                            })}
                            className="w-24"
                          />
                          <span className="text-sm text-panel-text-muted">%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Vuelos */}
                  <div>
                    <h3 className="mb-4 text-base font-semibold">Vuelos</h3>
                    <div className="space-y-4">
                      {(['green', 'yellow', 'red'] as const).map(color => (
                        <div key={color} className="flex items-center gap-3">
                          <div className="w-32">
                            <Label className="text-sm">
                              {color === 'green' ? '🟢 Verde' : color === 'yellow' ? '🟡 Ámbar' : '🔴 Rojo'}
                            </Label>
                          </div>
                          <Input
                            type="number" min="0" max="100"
                            value={localConfig.thresholds.flight[color]}
                            onChange={e => setLocalConfig({
                              ...localConfig,
                              thresholds: {
                                ...localConfig.thresholds,
                                flight: {
                                  ...localConfig.thresholds.flight,
                                  [color]: parseInt(e.target.value) || 0,
                                },
                              },
                            })}
                            className="w-24"
                          />
                          <span className="text-sm text-panel-text-muted">%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Tab: Historial ── */}
            <TabsContent value="history" className="m-0">
              <div className="max-w-5xl">
                <div className="rounded-lg border border-panel-border bg-panel-bg">
                  <table className="w-full">
                    <thead className="bg-panel-section-bg">
                      <tr>
                        <th className="p-3 text-left text-sm font-medium">Fecha</th>
                        <th className="p-3 text-left text-sm font-medium">Inicio</th>
                        <th className="p-3 text-left text-sm font-medium">Días</th>
                        <th className="p-3 text-left text-sm font-medium">Duración</th>
                        <th className="p-3 text-left text-sm font-medium">Total</th>
                        <th className="p-3 text-left text-sm font-medium">Entregados</th>
                        <th className="p-3 text-left text-sm font-medium">Rechazados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Completado actual si hay */}
                      {fase === 'completado' && (
                        <tr className="border-t bg-green-50 dark:bg-green-900/10">
                          <td className="p-3 text-sm">{new Date().toLocaleString('es-PE')}</td>
                          <td className="p-3 font-mono text-sm">{localConfig.startDate.toISOString().slice(0,10)}</td>
                          <td className="p-3 text-sm">{localConfig.dias}</td>
                          <td className="p-3 text-sm">{localConfig.duracionRealMin} min</td>
                          <td className="p-3 text-sm">{contadores.total}</td>
                          <td className="p-3 text-sm text-green-600">{contadores.entregado}</td>
                          <td className="p-3 text-sm text-red-600">{contadores.rechazado}</td>
                        </tr>
                      )}
                      {fase !== 'completado' && (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-sm text-panel-text-muted">
                            No hay simulaciones completadas en esta sesión.
                          </td>
                        </tr>
                      )}
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
