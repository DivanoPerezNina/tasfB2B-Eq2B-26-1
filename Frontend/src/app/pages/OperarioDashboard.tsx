/**
 * OperarioDashboard — pantalla de trabajo del operario de Día a Día.
 *
 * Un operario está atado a un único aeropuerto (perfil.aeropuertoIata) y solo
 * puede: (1) registrar envíos manualmente uno por uno, (2) subir un archivo
 * con varios envíos de una vez. El origen NUNCA se pide — sale de la cuenta.
 *
 * La hora mostrada y usada al registrar es la hora LOCAL DEL AEROPUERTO del
 * operario (derivada de su gmt_offset), no la del navegador: un operario
 * puede estar probando el sistema físicamente en otro huso horario (p.ej.
 * durante pruebas del curso), y aun así los envíos deben quedar fechados
 * como si el operario estuviera en su aeropuerto. El backend ya interpreta
 * fecha_hora_local como la hora de pared del origen y resta gmt_offset para
 * obtener el UTC — aquí solo hay que construir esa hora de pared bien.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Tile, Button, Stack, Tag, TextInput, NumberInput, Select, SelectItem,
  InlineNotification, FileUploaderDropContainer, FileUploaderItem, Modal,
  Tabs, TabList, Tab, TabPanels, TabPanel,
} from '@carbon/react';
import { UserAvatar, Logout, Location, Time, Send, Upload, DocumentExport, Renew } from '@carbon/icons-react';
import { clearPerfil, authHeader, Perfil } from '../lib/auth';
import { toast } from 'sonner';
import { Map as SimulationMap } from '../components/Map';
import { useSimulation } from '../context/SimulationContext';
import { useDomain } from '../context/DomainContext';
import { OperarioRutas } from './OperarioRutas';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

// Tope por envío: los aeropuertos de la prueba operan con almacén de 999.
const MAX_MALETAS = 999;
// Debe calzar con ventanaEdicionMin en operario.go (backend es quien manda).
const ventanaEdicionMinFront = 10;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Instante real → hora de pared en un aeropuerto de gmt_offset dado, sin
 *  depender de la zona horaria configurada en el navegador/SO: se lee con
 *  getUTC* sobre un Date ya desplazado, así el navegador nunca reaplica su
 *  propio huso encima. */
function horaEnAeropuerto(instanteReal: Date, gmtOffset: number): Date {
  return new Date(instanteReal.getTime() + gmtOffset * 3600 * 1000);
}

function formatHora(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function formatFecha(d: Date): string {
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function formatRegistroEnvio(e: EnvioRegistrado, gmtOffset: number): string {
  // Preferimos los campos locales guardados en la BD. Así si el archivo dice
  // 13-59, la tabla muestra 13:59, sin reconvertir a otra zona horaria.
  if (e.fecha_registro && Number.isFinite(Number(e.hora)) && Number.isFinite(Number(e.minuto))) {
    const fecha = String(e.fecha_registro).slice(0, 10); // soporta "2026-07-26" y "2026-07-26T00:00:00Z"
    const [yyyy, mm, dd] = fecha.split('-');
    if (yyyy && mm && dd) {
      return `${pad2(Number(e.hora))}:${pad2(Number(e.minuto))}:00 ${dd}/${mm}/${yyyy}`;
    }
  }

  // Respaldo para datos antiguos que aún no traen fecha_registro/hora/minuto.
  const hora = horaEnAeropuerto(new Date(Number(e.registro_utc) * 60000), gmtOffset);
  return `${formatHora(hora)} ${formatFecha(hora)}`;
}

interface RegistroLog {
  idEnvio: string;
  destino: string;
  cantidad: number;
  hora: string;
}

interface EnvioRegistrado {
  id_envio: string;
  origen_iata: string;
  destino_iata: string;
  fecha_registro?: string;
  hora?: number;
  minuto?: number;
  cantidad_maletas: number;
  id_cliente: number;
  registro_utc: number;
  deadline_utc: number;
  editable: boolean;
}

type CampoOrden = 'id_envio' | 'destino_iata' | 'cantidad_maletas' | 'registro_utc';

const ETIQUETAS_ORDEN: Record<CampoOrden, string> = {
  id_envio: 'ID envío', destino_iata: 'Destino', cantidad_maletas: 'Maletas', registro_utc: 'Registrado',
};
const CAMPOS_ORDEN: CampoOrden[] = ['id_envio', 'destino_iata', 'cantidad_maletas', 'registro_utc'];

export function OperarioDashboard({ perfil, onLogout }: { perfil: Perfil; onLogout: () => void }) {
  const { conectarEspectador, fase, planVisualCargado } = useSimulation();
  const { aeropuertosBFF } = useDomain();
  const gmtOffset = aeropuertosBFF.find(a => a.iata === perfil.aeropuertoIata)?.gmt_offset ?? 0;

  const [ahora, setAhora] = useState(new Date());
  const horaAeropuerto = horaEnAeropuerto(ahora, gmtOffset);

  const [destino, setDestino] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [cliente, setCliente] = useState(7729);
  const [enviando, setEnviando] = useState(false);
  const [log, setLog] = useState<RegistroLog[]>([]);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendoArchivo, setSubiendoArchivo] = useState(false);
  const [resultadoArchivo, setResultadoArchivo] = useState('');

  // null mientras no se sabe todavía (primer fetch en curso).
  const [modoActivo, setModoActivo] = useState<boolean | null>(null);

  const [misEnvios, setMisEnvios] = useState<EnvioRegistrado[]>([]);
  const [filtroEnvios, setFiltroEnvios] = useState('');
  const [ordenPor, setOrdenPor] = useState<CampoOrden>('registro_utc');
  const [ordenAsc, setOrdenAsc] = useState(false);
  const [editando, setEditando] = useState<EnvioRegistrado | null>(null);
  const [editDestino, setEditDestino] = useState('');
  const [editCantidad, setEditCantidad] = useState(1);
  const [editCliente, setEditCliente] = useState(7729);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // El admin enciende/apaga el modo Día a Día de forma independiente a la
  // simulación (ver modo_operacion.go): mientras esté apagado, el operario
  // puede ver todo pero no registrar. Se sondea porque puede cambiar sin que
  // el operario recargue la página.
  useEffect(() => {
    let cancelado = false;
    const consultar = () => {
      fetch(`${BFF}/api/modo-operacion`, { headers: authHeader() })
        .then(r => r.json())
        .then(j => {
          if (!cancelado) {
            const activo = !!j.data?.activo;
            setModoActivo(activo);
            if (activo && j.data?.simulacion_activa) conectarEspectador();
          }
        })
        .catch(() => { /* se reintenta en el próximo poll */ });
    };
    consultar();
    const id = setInterval(consultar, 10000);
    return () => { cancelado = true; clearInterval(id); };
  }, []);

  const cargarMisEnvios = () => {
    fetch(`${BFF}/api/operario/envios`, { headers: authHeader() })
      .then(r => r.json())
      .then(j => setMisEnvios(Array.isArray(j.data) ? j.data : []))
      .catch(() => { /* la tabla se queda con lo último cargado */ });
  };
  useEffect(cargarMisEnvios, []);

  const asegurarOperacionConectada = async () => {
    // GET /api/modo-operacion no solo consulta: en el BFF también asegura que el
    // orquestador de Día a Día esté vivo si el modo está activo.
    try {
      await fetch(`${BFF}/api/modo-operacion`, { headers: authHeader() });
    } catch {
      // best effort
    }
    await conectarEspectador();
  };

  const solicitarReplanificacion = async () => {
    try {
      await asegurarOperacionConectada();
      const res = await fetch(`${BFF}/api/simulacion/replanificar`, {
        method: 'POST',
        headers: authHeader(),
      });
      if (!res.ok) {
        // Si la operación no estaba levantada cuando se hizo el POST, se intenta
        // arrancar/conectar y se reintenta una vez.
        await asegurarOperacionConectada();
        await fetch(`${BFF}/api/simulacion/replanificar`, {
          method: 'POST',
          headers: authHeader(),
        });
      }
      await conectarEspectador();
    } catch {
      // Si aún no hay simulación viva, el poll de conectarEspectador reintentará.
    }
  };

  const toggleOrden = (campo: CampoOrden) => {
    if (ordenPor === campo) setOrdenAsc(a => !a);
    else { setOrdenPor(campo); setOrdenAsc(true); }
  };

  // Se recalcula en cada tick de "ahora" (cada segundo) en vez de depender del
  // campo `editable` que trajo el último fetch: sin esto, una fila se veía
  // "Editable" en pantalla hasta el próximo Actualizar aunque ya hubieran
  // pasado los 10 minutos, y el guardado fallaba recién al enviarlo.
  const esEditable = (registroUtcMin: number) => {
    const nowUTCMin = Math.floor(ahora.getTime() / 60000);
    return nowUTCMin - registroUtcMin <= ventanaEdicionMinFront;
  };

  const enviosFiltrados = useMemo(() => {
    const q = filtroEnvios.trim().toUpperCase();
    const lista = q
      ? misEnvios.filter(e => e.id_envio.toUpperCase().includes(q) || e.destino_iata.toUpperCase().includes(q))
      : misEnvios;
    return [...lista].sort((a, b) => {
      const av = a[ordenPor], bv = b[ordenPor];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return ordenAsc ? cmp : -cmp;
    });
  }, [misEnvios, filtroEnvios, ordenPor, ordenAsc]);

  const abrirEdicion = (e: EnvioRegistrado) => {
    setEditando(e);
    setEditDestino(e.destino_iata);
    setEditCantidad(e.cantidad_maletas);
    setEditCliente(e.id_cliente);
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    setGuardandoEdicion(true);
    try {
      const res = await fetch(`${BFF}/api/operario/envios/${encodeURIComponent(editando.id_envio)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ destino_iata: editDestino, cantidad_maletas: editCantidad, id_cliente: editCliente }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message ?? 'Error al editar');
      toast.success(`Envío ${editando.id_envio} actualizado`);
      setEditando(null);
      cargarMisEnvios();
    } catch (e: any) {
      toast.error('No se pudo editar', { description: e.message });
    } finally {
      setGuardandoEdicion(false);
    }
  };

  // El operario nunca inicia la simulación: sondea /estado y, si el admin ya
  // arrancó Día a Día, el mapa se suscribe al SSE (con snapshot al conectar).
  // Se sigue sondeando por si la sim actual termina y el admin arranca otra.
  useEffect(() => {
    conectarEspectador();
    const id = setInterval(conectarEspectador, 15000);
    return () => clearInterval(id);
  }, [conectarEspectador]);

  const destinosDisponibles = aeropuertosBFF.filter(a => a.iata !== perfil.aeropuertoIata);

  const fechaHoraLocal = () => {
    const h = horaEnAeropuerto(ahora, gmtOffset);
    return `${h.getUTCFullYear()}-${pad2(h.getUTCMonth() + 1)}-${pad2(h.getUTCDate())}T${pad2(h.getUTCHours())}:${pad2(h.getUTCMinutes())}:${pad2(h.getUTCSeconds())}`;
  };

  // Ejemplo de línea para la plantilla, con la fecha/hora actual DEL AEROPUERTO
  // del operario (no la del navegador) para que sirva de referencia real al
  // escribir el archivo a mano.
  const descargarPlantilla = () => {
    const h = horaEnAeropuerto(new Date(), gmtOffset);
    const fecha = `${h.getUTCFullYear()}${pad2(h.getUTCMonth() + 1)}${pad2(h.getUTCDate())}`;
    const hhmm = `${pad2(h.getUTCHours())}-${pad2(h.getUTCMinutes())}`;
    const ejemploDestino = destinosDisponibles[0]?.iata ?? 'SCEL';
    const contenido = [
      `# Plantilla de envíos — ${perfil.aeropuertoIata} (hora local del aeropuerto, no la de tu navegador)`,
      '# Formato: id_envio-aaaammdd-hh-mm-destino-cantidad-idCliente',
      '# El id_envio puede omitirse tal cual (se regenera al subir); una línea por envío.',
      `10000001-${fecha}-${hhmm}-${ejemploDestino}-180-0007729`,
    ].join('\n') + '\n';
    const blob = new Blob([contenido], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plantilla_envios_${perfil.aeropuertoIata}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const registrar = async () => {
    if (!destino) { toast.error('Selecciona un destino'); return; }
    if (cantidad <= 0 || cantidad > MAX_MALETAS) {
      toast.error(`La cantidad debe estar entre 1 y ${MAX_MALETAS} maletas`);
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch(`${BFF}/api/operario/envios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          destino_iata: destino,
          cantidad_maletas: cantidad,
          id_cliente: cliente,
          fecha_hora_local: fechaHoraLocal(),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message ?? 'Error al registrar');
      setLog(prev => [{ idEnvio: j.data.id_envio, destino, cantidad, hora: formatHora(horaAeropuerto) }, ...prev].slice(0, 20));
      toast.success(`Envío ${j.data.id_envio} registrado — ${cantidad} maleta(s) a ${destino}`);
      setDestino('');
      setCantidad(1);
      cargarMisEnvios();
      solicitarReplanificacion();
    } catch (e: any) {
      toast.error('No se pudo registrar', { description: e.message });
    } finally {
      setEnviando(false);
    }
  };

  const subirArchivo = async () => {
    if (!archivo) return;
    setSubiendoArchivo(true);
    setResultadoArchivo('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const res = await fetch(`${BFF}/api/operario/envios/archivo`, {
        method: 'POST',
        headers: authHeader(),
        body: fd,
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message ?? 'Error al subir');
      setResultadoArchivo(`${j.data.registrados} registrados, ${j.data.fallidos} fallidos`);
      toast.success('Archivo procesado', { description: `${j.data.registrados} envíos registrados` });
      setArchivo(null);
      cargarMisEnvios();
      solicitarReplanificacion();
    } catch (e: any) {
      toast.error('No se pudo subir el archivo', { description: e.message });
    } finally {
      setSubiendoArchivo(false);
    }
  };

  const salir = async () => {
    try {
      await fetch(`${BFF}/api/logout`, { method: 'POST', headers: authHeader() });
    } catch { /* best-effort */ }
    clearPerfil();
    onLogout();
  };

  return (
    // Columna de alto fijo: el encabezado queda arriba siempre y solo scrollea
    // el contenido de la pestaña activa. Así el mapa puede ocupar el alto
    // completo sin pelearse con el scroll de la página.
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--cds-background)' }}>
      <div style={{ flexShrink: 0, padding: '1rem 1.5rem 0' }}>
        <div style={{ maxWidth: '80rem', margin: '0 auto' }}>

          {/* Encabezado */}
          <Tile>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <UserAvatar size={28} />
                <div>
                  <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{perfil.usuario}</h1>
                  <div style={{ display: 'flex', gap: '.4rem', marginTop: '.15rem' }}>
                    <Tag type="blue" renderIcon={Location} size="sm">{perfil.aeropuertoIata}</Tag>
                    {modoActivo === true ? (
                      <Tag type="green" size="sm">Día a Día activo</Tag>
                    ) : modoActivo === false ? (
                      <Tag type="gray" size="sm">En espera del administrador</Tag>
                    ) : null}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontFamily: 'var(--cds-code-01-font-family, monospace)', fontSize: '1rem' }}>
                  <Time size={18} />
                  {formatHora(horaAeropuerto)} — {formatFecha(horaAeropuerto)}
                  <Tag size="sm" type="gray">hora {perfil.aeropuertoIata}</Tag>
                </span>
                <Button kind="danger--tertiary" size="sm" renderIcon={Logout} onClick={salir}>
                  Cerrar sesión
                </Button>
              </div>
            </div>
          </Tile>

          {modoActivo === false && (
            <div style={{ marginTop: '.75rem' }}>
              <InlineNotification kind="warning" lowContrast hideCloseButton title="En espera"
                subtitle="El administrador todavía no activó el modo Día a Día. Cuando lo active, podrás registrar envíos y rutas desde aquí mismo." />
            </div>
          )}
        </div>
      </div>

      <Tabs>
        <div style={{ flexShrink: 0, padding: '.75rem 1.5rem 0' }}>
          <div style={{ maxWidth: '80rem', margin: '0 auto' }}>
            <TabList aria-label="Secciones del operario" contained>
              <Tab>Mapa</Tab>
              <Tab>Registros</Tab>
            </TabList>
          </div>
        </div>

        <TabPanels>
          {/* ── Pantalla 1: solo el mapa ── */}
          <TabPanel style={{ flex: 1, minHeight: 0, padding: '1rem 1.5rem 1.5rem' }}>
            <div style={{ maxWidth: '80rem', margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {modoActivo === true ? (
                  fase === 'ejecutando' || fase === 'calentando' ? (
                    <Tag type="green" size="sm">
                      {planVisualCargado ? 'Día a Día en curso — vuelos en vivo' : 'Día a Día activo — esperando rutas/envíos'}
                    </Tag>
                  ) : (
                    <Tag type="green" size="sm">Día a Día activo — conectando operación</Tag>
                  )
                ) : (
                  <Tag type="gray" size="sm">Los vuelos aparecerán cuando el administrador inicie Día a Día</Tag>
                )}
              </div>
              <div style={{ flex: 1, minHeight: '30rem' }}>
                <SimulationMap />
              </div>
            </div>
          </TabPanel>

          {/* ── Pantalla 2: registros manuales (envíos y rutas) ── */}
          <TabPanel style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem 1.5rem 1.5rem' }}>
            <div style={{ maxWidth: '80rem', margin: '0 auto' }}>
              <Tabs>
                <TabList aria-label="Tipo de registro">
                  <Tab>Envíos</Tab>
                  <Tab>Rutas</Tab>
                </TabList>
                <TabPanels>
                  <TabPanel style={{ padding: '1rem 0 0' }}>
                    <Stack gap={5}>

          {/* Registro manual */}
          <Tile>
            <Stack gap={4}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Registrar envío</h2>
              <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                El origen ({perfil.aeropuertoIata}) y la hora local de ese aeropuerto ({formatHora(horaAeropuerto)}) se toman automáticamente.
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ minWidth: '14rem' }}>
                  <Select id="destino" labelText="Destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
                    <SelectItem value="" text="Selecciona un aeropuerto" />
                    {destinosDisponibles.map(a => (
                      <SelectItem key={a.iata} value={a.iata} text={`${a.iata} — ${a.ciudad}, ${a.pais}`} />
                    ))}
                  </Select>
                </div>
                <div style={{ width: '9rem' }}>
                  <NumberInput
                    id="cantidad" label="Maletas" min={1} max={MAX_MALETAS} value={cantidad}
                    invalidText={`Entre 1 y ${MAX_MALETAS}`}
                    onChange={(_e: unknown, { value }: { value: number | string }) => setCantidad(Number(value) || 1)}
                  />
                </div>
                <div style={{ width: '9rem' }}>
                  <TextInput id="cliente" labelText="Cliente" value={String(cliente)} onChange={(e) => setCliente(Number(e.target.value) || 7729)} />
                </div>
                <Button renderIcon={Send} disabled={enviando || !destino || modoActivo !== true} onClick={registrar}>
                  {enviando ? 'Registrando…' : 'Registrar'}
                </Button>
              </div>

              {log.length > 0 && (
                <div style={{ maxHeight: '12rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                  {log.map((r) => (
                    <div key={r.idEnvio} style={{
                      display: 'flex', justifyContent: 'space-between', fontSize: '.8125rem',
                      padding: '.4rem .6rem', background: 'var(--cds-layer-accent)', borderRadius: '4px',
                    }}>
                      <span><strong>{r.idEnvio}</strong> → {r.destino} ({r.cantidad} maletas)</span>
                      <span style={{ color: 'var(--cds-text-secondary)' }}>{r.hora}</span>
                    </div>
                  ))}
                </div>
              )}
            </Stack>
          </Tile>

          {/* Carga por archivo */}
          <Tile>
            <Stack gap={4}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Cargar envíos desde archivo</h2>
                <Button kind="ghost" size="sm" renderIcon={DocumentExport} onClick={descargarPlantilla}>
                  Descargar plantilla
                </Button>
              </div>
              <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                Formato: id_envío-aaaammdd-hh-mm-destino-cantidad-cliente (una línea por envío).
                Las fechas y horas deben estar en la hora local de {perfil.aeropuertoIata}, no en la de tu navegador.
              </p>
              <FileUploaderDropContainer
                labelText="Arrastra o elige un archivo .txt"
                accept={['.txt']}
                multiple={false}
                onAddFiles={(_e: unknown, { addedFiles }: { addedFiles: File[] }) => setArchivo(addedFiles[0] ?? null)}
              />
              {archivo && (
                <FileUploaderItem name={archivo.name} status="edit" onDelete={() => setArchivo(null)} />
              )}
              <Button renderIcon={Upload} disabled={!archivo || subiendoArchivo || modoActivo !== true} onClick={subirArchivo}>
                {subiendoArchivo ? 'Subiendo…' : 'Subir'}
              </Button>
              {resultadoArchivo && (
                <InlineNotification kind="success" lowContrast hideCloseButton title="Listo" subtitle={resultadoArchivo} />
              )}
            </Stack>
          </Tile>

          {/* Mis envíos — mantenimiento de lectura, ordenable y filtrable */}
          <Tile>
            <Stack gap={4}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Mis envíos registrados</h2>
                <Button kind="ghost" size="sm" renderIcon={Renew} onClick={cargarMisEnvios}>Actualizar</Button>
              </div>
              <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                Editable hasta {ventanaEdicionMinFront} minutos después de registrado (hora real, no simulada).
              </p>
              <TextInput
                id="filtro-envios" labelText="Buscar" placeholder="Filtrar por ID o destino…"
                value={filtroEnvios} onChange={(e) => setFiltroEnvios(e.target.value)}
              />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--cds-border-subtle)' }}>
                      {CAMPOS_ORDEN.map(campo => (
                        <th
                          key={campo}
                          onClick={() => toggleOrden(campo)}
                          style={{ cursor: 'pointer', padding: '.5rem .6rem', userSelect: 'none', color: 'var(--cds-text-secondary)', whiteSpace: 'nowrap' }}
                        >
                          {ETIQUETAS_ORDEN[campo]}{ordenPor === campo ? (ordenAsc ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th style={{ padding: '.5rem .6rem' }}>Estado</th>
                      <th style={{ padding: '.5rem .6rem' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {enviosFiltrados.map(e => {
                      const registradoTexto = formatRegistroEnvio(e, gmtOffset);
                      const editable = esEditable(e.registro_utc);
                      return (
                        <tr key={e.id_envio} style={{ borderBottom: '1px solid var(--cds-border-subtle)' }}>
                          <td style={{ padding: '.45rem .6rem', fontFamily: 'monospace' }}>{e.id_envio}</td>
                          <td style={{ padding: '.45rem .6rem' }}>{e.destino_iata}</td>
                          <td style={{ padding: '.45rem .6rem', textAlign: 'right' }}>{e.cantidad_maletas}</td>
                          <td style={{ padding: '.45rem .6rem', whiteSpace: 'nowrap' }}>{registradoTexto}</td>
                          <td style={{ padding: '.45rem .6rem' }}>
                            <Tag size="sm" type={editable ? 'teal' : 'gray'}>{editable ? 'Editable' : 'Bloqueado'}</Tag>
                          </td>
                          <td style={{ padding: '.45rem .6rem', textAlign: 'right' }}>
                            <Button size="sm" kind="ghost" disabled={!editable} onClick={() => abrirEdicion(e)}>Editar</Button>
                          </td>
                        </tr>
                      );
                    })}
                    {enviosFiltrados.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: 'var(--cds-text-secondary)' }}>
                          Sin envíos registrados todavía.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Stack>
          </Tile>

                    </Stack>
                  </TabPanel>

                  {/* Rutas del día a día (vuelos_operacion) */}
                  <TabPanel style={{ padding: '1rem 0 0' }}>
                    <OperarioRutas modoActivo={modoActivo} />
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>

      {editando && (
        <Modal
          open={!!editando}
          modalHeading={`Editar envío ${editando.id_envio}`}
          primaryButtonText={guardandoEdicion ? 'Guardando…' : 'Guardar'}
          secondaryButtonText="Cancelar"
          primaryButtonDisabled={guardandoEdicion || !editDestino || editCantidad <= 0 || editCantidad > MAX_MALETAS}
          onRequestSubmit={guardarEdicion}
          onRequestClose={() => setEditando(null)}
        >
          <Stack gap={5}>
            <Select id="edit-destino" labelText="Destino" value={editDestino} onChange={(e) => setEditDestino(e.target.value)}>
              {destinosDisponibles.map(a => (
                <SelectItem key={a.iata} value={a.iata} text={`${a.iata} — ${a.ciudad}, ${a.pais}`} />
              ))}
            </Select>
            <NumberInput
              id="edit-cantidad" label="Maletas" min={1} max={MAX_MALETAS} value={editCantidad}
              invalidText={`Entre 1 y ${MAX_MALETAS}`}
              onChange={(_e: unknown, { value }: { value: number | string }) => setEditCantidad(Number(value) || 1)}
            />
            <TextInput id="edit-cliente" labelText="Cliente" value={String(editCliente)} onChange={(e) => setEditCliente(Number(e.target.value) || 7729)} />
          </Stack>
        </Modal>
      )}
    </div>
  );
}
