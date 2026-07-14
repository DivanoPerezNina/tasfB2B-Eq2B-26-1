import React, { useState, useEffect } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { useSimulation } from '../context/SimulationContext';
import {
  Button, Tabs, TabList, Tab, TabPanels, TabPanel,
  TileGroup, RadioTile, ContentSwitcher, Switch,
  DatePicker, DatePickerInput, TextInput, Tag, InlineNotification, Stack,
} from '@carbon/react';
import { SimulationScenario } from '../types';
import {
  Settings, Save, Play, Pause, Reset, Time, Close, Calendar,
  Flash, DataBase, Plane, Building, TrashCan, ChartLineSmooth, SettingsAdjust,
} from '@carbon/icons-react';
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

// ─── Slider de umbrales tricolor (control especializado; se migra en limpieza) ──

function ThresholdSlider({
  label, icon, green, yellow, onChange,
}: {
  label: string; icon: React.ReactNode; green: number; yellow: number;
  onChange: (green: number, yellow: number) => void;
}) {
  return (
    <Stack gap={4}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 600 }}>
          {icon}{label}
        </span>
        <div style={{ display: 'flex', gap: '.75rem', fontSize: '.75rem' }}>
          <span style={{ color: '#24a148' }}>● ≤ {green}%</span>
          <span style={{ color: '#f1c21b' }}>● ≤ {yellow}%</span>
          <span style={{ color: '#da1e28' }}>● &gt; {yellow}%</span>
        </div>
      </div>
      <SliderPrimitive.Root
        min={0} max={100} step={1}
        value={[green, yellow]}
        onValueChange={([g, y]) => onChange(g, y)}
        style={{ position: 'relative', display: 'flex', width: '100%', alignItems: 'center', userSelect: 'none', touchAction: 'none' }}
      >
        <SliderPrimitive.Track
          style={{
            position: 'relative', height: 16, width: '100%', flexGrow: 1, overflow: 'hidden', borderRadius: 9999,
            background: `linear-gradient(to right, #24a148 0% ${green}%, #f1c21b ${green}% ${yellow}%, #da1e28 ${yellow}% 100%)`,
          }}
        >
          <SliderPrimitive.Range style={{ position: 'absolute', height: '100%', opacity: 0 }} />
        </SliderPrimitive.Track>
        {[0, 1].map((i) => (
          <SliderPrimitive.Thumb
            key={i}
            style={{ display: 'block', height: 20, width: 20, borderRadius: 9999, background: '#fff', border: '2px solid #8d8d8d', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }}
          />
        ))}
      </SliderPrimitive.Root>
      <div style={{ display: 'flex', fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}>
        <span>0%</span><span style={{ flex: 1 }} /><span>100%</span>
      </div>
    </Stack>
  );
}

// ─── Opciones de escenario ────────────────────────────────────────────────────

const SCENARIO_OPTIONS: { value: SimulationScenario; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: 'realtime', label: 'Tiempo Real', desc: 'Operación día a día',         icon: <Time size={20} /> },
  { value: 'period',   label: 'Periodo',     desc: 'Comprime días en minutos',    icon: <Calendar size={20} /> },
  { value: 'collapse', label: 'Colapso',     desc: 'Prueba de estrés',            icon: <ChartLineSmooth size={20} /> },
];

const SCENARIO_LABELS: Record<SimulationScenario, string> = {
  realtime: 'Tiempo Real', period: 'Periodo', collapse: 'Colapso',
};
const SCENARIO_TAG: Record<SimulationScenario, 'green' | 'blue' | 'red'> = {
  realtime: 'green', period: 'blue', collapse: 'red',
};

// ─── Componente principal ─────────────────────────────────────────────────────

export function SimulationConfig() {
  const {
    config, updateConfig, datasetInfo,
    fase, planProgreso, planMensaje,
    iniciarPeriodoProgramado, iniciarColapsoProgramado, iniciarSimulacion, pausarSimulacion,
    reanudarSimulacion, resetear,
    contadores,
    resetSimulation,
  } = useSimulation();

  const [localConfig, setLocalConfig] = useState(config);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [history, setHistory] = useState<HistoryRecord[]>(loadHistory);

  const VELOCIDADES_COLAPSO = [
    { k: 3600,  horas: 1,  label: '1 s = 1 h' },
    { k: 18000, horas: 5,  label: '1 s = 5 h' },
    { k: 36000, horas: 10, label: '1 s = 10 h' },
  ] as const;
  const SA_COLAPSO = 300;
  const kColapso = localConfig.velocidadColapsoK ?? VELOCIDADES_COLAPSO[0].k;


  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setLocalConfig(prev => ({ ...prev, startDate: config.startDate }));
  }, [config.startDate]);

  useEffect(() => {
    if (fase === 'completado' && contadores.total > 0) {
      const record: HistoryRecord = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        scenario: config.scenario,
        dias: config.scenario === 'period' ? config.dias : undefined,
        duracionMin: config.scenario === 'period' ? config.duracionRealMin : undefined,
        fechaInicio: config.scenario === 'period' ? (() => {
          const sd = config.startDate;
          const p = (n: number) => String(n).padStart(2, '0');
          const base = `${sd.getFullYear()}-${p(sd.getMonth() + 1)}-${p(sd.getDate())}`;
          const hasTime = sd.getHours() !== 0 || sd.getMinutes() !== 0;
          return hasTime ? `${base}T${p(sd.getHours())}:${p(sd.getMinutes())}` : base;
        })() : undefined,
        total: contadores.total,
        exitosos: contadores.entregado,
        rechazados: contadores.rechazado,
        tasaExito: contadores.total > 0 ? (contadores.entregado / contadores.total) * 100 : 0,
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
  const totalEnvios = Number(datasetInfo?.total_envios);
  const tieneEnviosValidos = backendTieneDatos && Number.isFinite(totalEnvios);

  const esPeriodo  = localConfig.scenario === 'period';
  const esRealtime = localConfig.scenario === 'realtime';
  const esConFecha = esPeriodo || esRealtime;
  const diasEfectivos = esRealtime ? 1 : localConfig.dias;
  const duracionFueraDeRango = esPeriodo
    ? (localConfig.duracionRealMin < 30 || localConfig.duracionRealMin > 90)
    : esRealtime
      ? (localConfig.duracionRealMin < 5 || localConfig.duracionRealMin > 90)
      : false;
  const fechaMaxDataset = datasetInfo ? new Date(datasetInfo.fecha_max + 'T23:59:59') : null;
  const fechaFinSim = new Date(localConfig.startDate.getTime() + diasEfectivos * 86_400_000);
  const fechaFueraDeRango = esConFecha && !!fechaMaxDataset && fechaFinSim > fechaMaxDataset;
  const puedeIniciar = !esConFecha || (!fechaFueraDeRango && !duracionFueraDeRango);

  const timeValue = localConfig.startDate && !isNaN(localConfig.startDate.getTime())
    ? `${String(localConfig.startDate.getHours()).padStart(2, '0')}:${String(localConfig.startDate.getMinutes()).padStart(2, '0')}`
    : '00:00';

  // ── Handlers ──
  const handleGuardar = () => {
    const toSave = { ...localConfig };
    if (!toSave.scenario) toSave.scenario = 'period';
    updateConfig(toSave);
    resetSimulation();
    toast.success('Configuración guardada');
  };

  const handleFecha = (dates: Date[]) => {
    const d = dates?.[0];
    if (!d) return;
    const prev = localConfig.startDate;
    const merged = new Date(d);
    merged.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    setLocalConfig({ ...localConfig, startDate: merged });
  };

  const handleHora = (t: string) => {
    if (!/^\d{2}:\d{2}$/.test(t)) return;
    const [h, m] = t.split(':').map(Number);
    const next = new Date(localConfig.startDate);
    next.setHours(h, m, 0, 0);
    setLocalConfig({ ...localConfig, startDate: next });
  };

  const handleIniciarPlanificacion = () => {
    if (!puedeIniciar) {
      toast.error('Revisa la configuración', {
        description: fechaFueraDeRango
          ? 'La ventana de simulación excede el rango del dataset.'
          : esRealtime
            ? 'La duración real debe estar entre 5 y 90 minutos.'
            : 'La duración real debe estar entre 30 y 90 minutos.',
      });
      return;
    }
    updateConfig(localConfig);

    if (esPeriodo) {
      const bloquesPeriodo = 30;
      iniciarPeriodoProgramado({
        startDate: localConfig.startDate,
        dias: localConfig.dias,
        criterio: localConfig.criterio,
        warmUp: localConfig.warmUp,
        scMin: localConfig.dias * 48,
        saSeg: Math.max(20, Math.round((localConfig.duracionRealMin * 60) / bloquesPeriodo)),
        usarCancelaciones: true,
      });
      return;
    }
    if (esRealtime) {
      const bloquesDia = 24;
      iniciarPeriodoProgramado({
        startDate: localConfig.startDate,
        dias: 1,
        criterio: localConfig.criterio,
        warmUp: localConfig.warmUp,
        scMin: 60,
        saSeg: Math.max(5, Math.round((localConfig.duracionRealMin * 60) / bloquesDia)),
        usarCancelaciones: false,
      });
      return;
    }
    iniciarColapsoProgramado({
      startDate: localConfig.startDate,
      criterio: localConfig.criterio,
      warmUp: false,
      k: kColapso,
      saSeg: SA_COLAPSO,
      maxDias: 540,
      umbralColapso: 0.85,
      umbralRechazosPct: 0.30,
      bloquesRojoConsecutivos: 3,
    });
  };

  const handleClearHistory = () => {
    setHistory([]); localStorage.removeItem(HISTORY_KEY);
    toast.success('Historial borrado');
  };

  // ── Botón de acción principal según fase ──
  const botonAccion = () => {
    if (fase === 'ejecutando') return <Button size="sm" kind="secondary" renderIcon={Pause} onClick={() => pausarSimulacion()}>Pausar</Button>;
    if (fase === 'pausado')    return <Button size="sm" renderIcon={Play} onClick={() => reanudarSimulacion()}>Reanudar</Button>;
    if (fase === 'listo')      return <Button size="sm" renderIcon={Play} onClick={() => iniciarSimulacion()}>Ejecutar</Button>;
    if (fase === 'planificando') return <Button size="sm" disabled renderIcon={Time}>{planProgreso}%</Button>;
    if (fase === 'completado') return <Button size="sm" kind="secondary" renderIcon={Reset} onClick={() => resetear()}>Nueva</Button>;
    return (
      <Button size="sm" renderIcon={Play} disabled={!puedeIniciar} onClick={handleIniciarPlanificacion}>
        Iniciar
      </Button>
    );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cds-background)' }}>

      {/* ── Barra superior ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
        padding: '.75rem 1.5rem', borderBottom: '1px solid var(--cds-border-subtle)', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', fontSize: '.8125rem', color: 'var(--cds-text-secondary)', flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--cds-text-primary)' }}>Configuración</strong>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontFamily: 'var(--cds-font-mono, monospace)' }}>
            <Time size={14} />{format(currentTime, 'dd/MM/yyyy HH:mm:ss')}
          </span>
          <Tag size="sm" type={SCENARIO_TAG[localConfig.scenario]}>{SCENARIO_LABELS[localConfig.scenario]}</Tag>
          {esPeriodo && <span style={{ whiteSpace: 'nowrap' }}>{localConfig.dias} días · {localConfig.duracionRealMin} min</span>}
          {esRealtime && <span style={{ whiteSpace: 'nowrap' }}>1 día · {localConfig.duracionRealMin} min</span>}
          {localConfig.scenario === 'collapse' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', whiteSpace: 'nowrap' }}>
              <Flash size={14} /> {VELOCIDADES_COLAPSO.find(v => v.k === kColapso)?.label}
            </span>
          )}
          {tieneEnviosValidos
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', whiteSpace: 'nowrap', color: 'var(--cds-support-success)' }}><DataBase size={14} /> {totalEnvios.toLocaleString()} envíos</span>
            : <span style={{ whiteSpace: 'nowrap', color: 'var(--cds-support-warning)' }}>Sin datos</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          {botonAccion()}
          <Button size="sm" kind="ghost" renderIcon={Reset} onClick={() => resetear()}>Reiniciar</Button>
          <Button size="sm" kind="ghost" renderIcon={Close} onClick={() => setLocalConfig(config)}>Descartar</Button>
          <Button size="sm" renderIcon={Save} onClick={handleGuardar}>Guardar</Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '1.25rem 1.5rem' }}>
        <Tabs>
          <TabList aria-label="Configuración">
            <Tab renderIcon={Settings}>General</Tab>
            <Tab renderIcon={SettingsAdjust}>Umbrales</Tab>
            <Tab renderIcon={Calendar}>Historial ({history.length})</Tab>
          </TabList>

          <TabPanels>
            {/* ── General ── */}
            <TabPanel>
              <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', maxWidth: '64rem', margin: '1rem auto 0' }}>

                {/* Escenario */}
                <TileGroup
                  legend="Escenario"
                  name="scenario"
                  valueSelected={localConfig.scenario}
                  onChange={(value) => {
                    const scenario = value as SimulationScenario;
                    setLocalConfig({ ...localConfig, scenario, warmUp: false });
                  }}
                >
                  {SCENARIO_OPTIONS.map((opt) => (
                    <RadioTile id={`sc-${opt.value}`} value={opt.value} key={opt.value}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                        {opt.icon}
                        <div>
                          <div style={{ fontWeight: 600 }}>{opt.label}</div>
                          <div style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}>{opt.desc}</div>
                        </div>
                      </div>
                    </RadioTile>
                  ))}
                </TileGroup>

                {/* Fecha + duración/velocidad */}
                <Stack gap={5}>
                  <Stack gap={3}>
                    <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 160px' }}>
                        <DatePicker
                          datePickerType="single"
                          dateFormat="d/m/Y"
                          value={localConfig.startDate}
                          minDate={datasetInfo?.fecha_min}
                          maxDate={datasetInfo?.fecha_max}
                          onChange={handleFecha}
                        >
                          <DatePickerInput
                            id="cfg-fecha"
                            labelText="Fecha de inicio"
                            placeholder="dd/mm/aaaa"
                            disabled={!esConFecha}
                          />
                        </DatePicker>
                      </div>
                      <div style={{ width: '8rem' }}>
                        <TextInput
                          id="cfg-hora"
                          labelText="Hora"
                          type="time"
                          value={timeValue}
                          disabled={!esConFecha}
                          onChange={(e) => handleHora(e.target.value)}
                        />
                      </div>
                    </div>

                    {datasetInfo ? (
                      <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                        Rango disponible: <strong>{datasetInfo.fecha_min}</strong> → <strong>{datasetInfo.fecha_max}</strong>
                      </p>
                    ) : (
                      <InlineNotification kind="warning" lowContrast hideCloseButton
                        title="Sin dataset" subtitle="Sube archivos en Ingreso de datos." />
                    )}

                    {fechaFueraDeRango && (
                      <InlineNotification kind="error" lowContrast hideCloseButton
                        title="Fecha fuera de rango"
                        subtitle={`La ventana de ${diasEfectivos} ${diasEfectivos === 1 ? 'día' : 'días'} termina el ${format(fechaFinSim, 'dd/MM/yyyy')}, fuera del dataset (${datasetInfo?.fecha_max}).`} />
                    )}
                    {duracionFueraDeRango && (
                      <InlineNotification kind="error" lowContrast hideCloseButton
                        title="Duración fuera de rango"
                        subtitle={esRealtime ? 'Día a día permite entre 5 y 90 minutos reales.' : 'Periodo permite entre 30 y 90 minutos reales.'} />
                    )}
                    {esRealtime && (
                      <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                        Día a día: opera 1 día desde la fecha/hora elegida con duración real configurable.
                      </p>
                    )}
                    {localConfig.scenario === 'collapse' && (
                      <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                        La fecha solo es editable en Periodo y Día a día.
                      </p>
                    )}
                  </Stack>

                  {(esPeriodo || esRealtime) && (
                    <div style={{ maxWidth: 240 }}>
                      <TextInput
                        id="cfg-duracion-real"
                        labelText="Duración real objetivo (min)"
                        type="number"
                        min={esRealtime ? 5 : 30}
                        max={90}
                        step={5}
                        value={String(localConfig.duracionRealMin)}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          duracionRealMin: Number(e.target.value) || (esRealtime ? 24 : 60),
                        })}
                      />
                      <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: '.35rem 0 0' }}>
                        Ajusta la velocidad de la simulación sin cambiar la ventana de datos.
                      </p>
                    </div>
                  )}

                  {esPeriodo && (
                    <InlineNotification
                      kind="info"
                      lowContrast
                      hideCloseButton
                      title={`Simulación ${localConfig.dias}D calibrada`}
                      subtitle={`Tiempo estimado: ${localConfig.duracionRealMin} minutos reales. Se usan 30 bloques: cada ${Math.round(localConfig.dias * 48)} minutos de datos futuros se consumen cada ${Math.max(20, Math.round((localConfig.duracionRealMin * 60) / 30))} segundos reales. Tiempo = 0 en la fecha/hora elegida; no se procesa data anterior.`}
                    />
                  )}

                </Stack>

                {/* Días + estado inicial (Periodo) / Velocidad (Colapso) */}
                <Stack gap={5}>
                  {localConfig.scenario === 'collapse' && (
                    <TileGroup
                      legend="Velocidad (horas simuladas por segundo real)"
                      name="velocidad"
                      valueSelected={String(kColapso)}
                      onChange={(value) => setLocalConfig({ ...localConfig, velocidadColapsoK: Number(value) })}
                    >
                      {VELOCIDADES_COLAPSO.map((v) => (
                        <RadioTile id={`vel-${v.k}`} value={String(v.k)} key={v.k}>{v.label}</RadioTile>
                      ))}
                    </TileGroup>
                  )}
                  {esPeriodo && (
                    <>
                      <div>
                        <p style={{ fontSize: '.75rem', marginBottom: '.5rem', color: 'var(--cds-text-secondary)' }}>Días a simular</p>
                        <ContentSwitcher
                          selectedIndex={[3, 5, 7].indexOf(localConfig.dias)}
                          onChange={({ index }) => setLocalConfig({ ...localConfig, dias: ([3, 5, 7] as const)[index ?? 0] })}
                        >
                          <Switch name="3" text="3 días" />
                          <Switch name="5" text="5 días" />
                          <Switch name="7" text="7 días" />
                        </ContentSwitcher>
                      </div>

                      <TileGroup
                        legend="Estado inicial de la red"
                        name="warmup"
                        valueSelected={localConfig.warmUp ? 'prev' : 'cero'}
                        onChange={(value) => setLocalConfig({ ...localConfig, warmUp: value === 'prev' })}
                      >
                        <RadioTile id="wu-cero" value="cero">
                          <div style={{ fontWeight: 600 }}>Desde cero</div>
                          <div style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}>
                            Tiempo 0 = fecha elegida. Solo procesa maletas desde ese momento.
                          </div>
                        </RadioTile>
                        <RadioTile id="wu-prev" value="prev">
                          <div style={{ fontWeight: 600 }}>Cargar estado previo</div>
                          <div style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}>
                            Siembra aviones en vuelo y almacenes ocupados al inicio (lookback rápido).
                          </div>
                        </RadioTile>
                      </TileGroup>

                      <InlineNotification
                        kind="info"
                        lowContrast
                        hideCloseButton
                        title="Cancelaciones consideradas en Periodo"
                        subtitle="Para Sim3D/5D/7D se procesan las cancelaciones del archivo. Si eliges Desde cero, tiempo 0 queda en la fecha/hora seleccionada y se consumen datos futuros."
                      />
                    </>
                  )}

                  {fase === 'planificando' && (
                    <InlineNotification kind="info" lowContrast hideCloseButton
                      title={`Calculando rutas… ${planProgreso}%`} subtitle={planMensaje} />
                  )}
                  {fase === 'listo' && (
                    <InlineNotification kind="success" lowContrast hideCloseButton
                      title="Plan listo" subtitle="Pulsa Ejecutar para iniciar." />
                  )}
                  {fase === 'completado' && (
                    <InlineNotification kind="info" lowContrast hideCloseButton
                      title="Simulación completada" subtitle="Pulsa Nueva para reiniciar." />
                  )}
                </Stack>
              </div>
            </TabPanel>

            {/* ── Umbrales ── */}
            <TabPanel>
              <div style={{ maxWidth: '64rem', marginTop: '1rem' }}>
                <p style={{ fontSize: '.8125rem', color: 'var(--cds-text-secondary)', marginBottom: '1rem' }}>
                  Define los límites de semaforización. Los colores del mapa se actualizan en tiempo real.
                </p>
                <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                  <ThresholdSlider
                    label="Almacenes" icon={<Building size={18} />}
                    green={localConfig.thresholds.warehouse.green}
                    yellow={localConfig.thresholds.warehouse.yellow}
                    onChange={(g, y) => setLocalConfig({ ...localConfig, thresholds: { ...localConfig.thresholds, warehouse: { green: g, yellow: y, red: y } } })}
                  />
                  <ThresholdSlider
                    label="Vuelos" icon={<Plane size={18} />}
                    green={localConfig.thresholds.flight.green}
                    yellow={localConfig.thresholds.flight.yellow}
                    onChange={(g, y) => setLocalConfig({ ...localConfig, thresholds: { ...localConfig.thresholds, flight: { green: g, yellow: y, red: y } } })}
                  />
                </div>
              </div>
            </TabPanel>

            {/* ── Historial ── */}
            <TabPanel>
              <div style={{ maxWidth: '64rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
                  <p style={{ fontSize: '.8125rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                    {history.length === 0
                      ? 'Las simulaciones completadas se registrarán aquí.'
                      : `${history.length} simulación${history.length !== 1 ? 'es' : ''} registrada${history.length !== 1 ? 's' : ''}`}
                  </p>
                  {history.length > 0 && (
                    <Button size="sm" kind="ghost" renderIcon={TrashCan} onClick={handleClearHistory}>Borrar historial</Button>
                  )}
                </div>

                {history.length === 0 ? (
                  <InlineNotification kind="info" lowContrast hideCloseButton
                    title="Sin registros" subtitle="Completa una simulación para ver el historial." />
                ) : (
                  <Stack gap={2}>
                    {history.map((rec) => {
                      const pct = Math.round(rec.tasaExito);
                      const barColor = pct >= 90 ? '#24a148' : pct >= 75 ? '#f1c21b' : '#da1e28';
                      return (
                        <div key={rec.id} style={{
                          display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                          padding: '.75rem 1rem', border: '1px solid var(--cds-border-subtle)', background: 'var(--cds-layer)',
                        }}>
                          <Tag size="sm" type={SCENARIO_TAG[rec.scenario]}>{SCENARIO_LABELS[rec.scenario]}</Tag>
                          {rec.fechaInicio && <span style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}>desde <strong>{rec.fechaInicio}</strong></span>}
                          {rec.dias != null && <span style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}>{rec.dias} días · {rec.duracionMin} min</span>}
                          <span style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}><strong>{rec.total.toLocaleString()}</strong> envíos</span>
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 120 }}>
                            <div style={{ flex: 1, height: 6, borderRadius: 9999, background: 'var(--cds-border-subtle)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor }} />
                            </div>
                            <span style={{ fontSize: '.75rem', fontWeight: 700, color: barColor }}>{pct}%</span>
                          </div>
                          <span style={{ fontSize: '.6875rem', color: 'var(--cds-text-helper)', marginLeft: 'auto' }}>
                            {format(new Date(rec.date), 'dd/MM HH:mm', { locale: es })}
                          </span>
                        </div>
                      );
                    })}
                  </Stack>
                )}
              </div>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>
    </div>
  );
}
