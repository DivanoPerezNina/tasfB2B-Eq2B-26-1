/**
 * OperarioRutas — mantenimiento de las rutas del día a día (vuelos_operacion).
 *
 * Tabla SEPARADA del catálogo de simulación: el planificador la consume vía
 * Consultas → body de /desde-datos, igual que envios_operacion.
 *
 * Dos acciones distintas que conviene no confundir:
 *  - Eliminar ruta  → la borra del catálogo (permanente).
 *  - Cancelar vuelo → cancela la SALIDA DE HOY y dispara re-planificación.
 *    Es efímera (vive en memoria del orquestador mientras corre la simulación)
 *    y solo tiene sentido si esa salida existe en el plan actual.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Tile, Stack, Button, Tag, TextInput, NumberInput, Select, SelectItem,
  InlineNotification, Modal, FileUploaderDropContainer, FileUploaderItem,
} from '@carbon/react';
import { Add, TrashCan, Edit, Renew, Upload, CloseOutline } from '@carbon/icons-react';
import { toast } from 'sonner';
import { authHeader, getPerfil } from '../lib/auth';
import { useDomain } from '../context/DomainContext';
import { useSimulation } from '../context/SimulationContext';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

interface Ruta {
  id: number;
  origen_iata: string;
  destino_iata: string;
  salida_minutos: number;
  llegada_minutos: number;
  capacidad_max: number;
  mismo_continente: boolean;
}

type CampoOrden = 'origen_iata' | 'destino_iata' | 'salida_minutos' | 'capacidad_max';

const ETIQUETAS: Record<CampoOrden, string> = {
  origen_iata: 'Origen', destino_iata: 'Destino',
  salida_minutos: 'Salida', capacidad_max: 'Capacidad',
};
const CAMPOS: CampoOrden[] = ['origen_iata', 'destino_iata', 'salida_minutos', 'capacidad_max'];

/** minutos desde medianoche → "HH:MM". Acepta >1440 (cruza medianoche) y lo
 *  muestra con un +1d para que no parezca un error de dato. */
function minutosAHora(min: number): string {
  const dias = Math.floor(min / 1440);
  const m = min % 1440;
  const txt = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return dias > 0 ? `${txt} +${dias}d` : txt;
}

function horaAMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const FORM_VACIO = { origen_iata: '', destino_iata: '', salida: '12:00', llegada: '18:00', capacidad_max: 150 };

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BFF}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message ?? `Error HTTP ${res.status}`);
  return body.data;
}

export function OperarioRutas({ modoActivo }: { modoActivo: boolean | null }) {
  const { aeropuertosBFF } = useDomain();
  const { planTramos, tiempoSimUTC, cancelarVuelo, conectarEspectador } = useSimulation();

  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [filtro, setFiltro] = useState('');
  const [ordenPor, setOrdenPor] = useState<CampoOrden>('origen_iata');
  const [ordenAsc, setOrdenAsc] = useState(true);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<Ruta | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState('');

  const cargar = () => {
    api('/api/operario/rutas')
      .then(d => setRutas(Array.isArray(d) ? d : []))
      .catch((e: any) => toast.error('No se pudieron cargar las rutas', { description: e.message }));
  };
  useEffect(cargar, []);

  const asegurarOperacionConectada = async () => {
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
        await asegurarOperacionConectada();
        await fetch(`${BFF}/api/simulacion/replanificar`, {
          method: 'POST',
          headers: authHeader(),
        });
      }
      await conectarEspectador();
    } catch {
      // Si aún no hay operación activa, el mapa seguirá intentando conectarse.
    }
  };

  const rutasVisibles = useMemo(() => {
    const q = filtro.trim().toUpperCase();
    const lista = q
      ? rutas.filter(r => r.origen_iata.includes(q) || r.destino_iata.includes(q))
      : rutas;
    return [...lista].sort((a, b) => {
      const av = a[ordenPor], bv = b[ordenPor];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return ordenAsc ? cmp : -cmp;
    });
  }, [rutas, filtro, ordenPor, ordenAsc]);

  const toggleOrden = (campo: CampoOrden) => {
    if (ordenPor === campo) setOrdenAsc(a => !a);
    else { setOrdenPor(campo); setOrdenAsc(true); }
  };

  // Resuelve la ocurrencia REAL que está usando el plan. La tabla contiene un
  // patrón diario, pero el planificador puede haber elegido la salida de mañana
  // si la hora de hoy ya pasó. Antes se reconstruía siempre "la salida de hoy";
  // al cancelar esa fecha, el envío seguía asignado a la ocurrencia de mañana y
  // parecía que la cancelación no hacía nada.
  const salidaUTCDeFila = (r: Ruta): number | null => {
    if (!Number.isFinite(tiempoSimUTC)) return null;

    // plan-tramos repite una ocurrencia por cada envío que la usa. Se deduplica
    // por ID+salida y se prioriza: vuelo activo, luego la próxima salida futura.
    const candidatas = planTramos
      .filter((tramo) => {
        const coincideId = Number.isFinite(tramo.vueloId)
          && Number(tramo.vueloId) === Number(r.id);
        if (coincideId) return true;

        // Compatibilidad con planes antiguos que todavía no publican vueloId.
        return !Number.isFinite(tramo.vueloId)
          && tramo.desde === r.origen_iata
          && tramo.hasta === r.destino_iata;
      })
      .filter((tramo, index, arr) => arr.findIndex((otro) =>
        Number(otro.vueloId ?? -1) === Number(tramo.vueloId ?? -1)
        && otro.salidaUTC === tramo.salidaUTC,
      ) === index);

    const activa = candidatas
      .filter((tramo) => tramo.salidaUTC <= tiempoSimUTC && tramo.llegadaUTC > tiempoSimUTC)
      .sort((a, b) => b.salidaUTC - a.salidaUTC)[0];
    if (activa) return activa.salidaUTC;

    const futura = candidatas
      .filter((tramo) => tramo.salidaUTC > tiempoSimUTC)
      .sort((a, b) => a.salidaUTC - b.salidaUTC)[0];
    if (futura) return futura.salidaUTC;

    // Fallback para una ruta sin envíos asignados todavía. Calcula la siguiente
    // ocurrencia cancelable del patrón diario, no una salida pasada.
    const origen = aeropuertosBFF.find(a => a.iata === r.origen_iata);
    const destino = aeropuertosBFF.find(a => a.iata === r.destino_iata);
    if (!origen || !destino) return null;

    const gmtOrigen = origen.gmt_offset;
    const gmtDestino = destino.gmt_offset;
    const minutoLocalOrigenActual = tiempoSimUTC + gmtOrigen * 60;
    let diaLocalOrigen = Math.floor(minutoLocalOrigenActual / 1440);

    let salidaUTC = diaLocalOrigen * 1440 + r.salida_minutos - gmtOrigen * 60;
    let llegadaUTC = diaLocalOrigen * 1440 + r.llegada_minutos - gmtDestino * 60;
    if (llegadaUTC <= salidaUTC) llegadaUTC += 1440;

    // Si la ocurrencia de hoy ya terminó, apunta a la de mañana.
    if (llegadaUTC <= tiempoSimUTC) {
      diaLocalOrigen += 1;
      salidaUTC = diaLocalOrigen * 1440 + r.salida_minutos - gmtOrigen * 60;
    }

    return salidaUTC;
  };

  const abrirCrear = () => {
    setEditando(null);
    const origenPerfil = getPerfil()?.aeropuertoIata ?? aeropuertosBFF[0]?.iata ?? '';
    const destinoInicial = aeropuertosBFF.find(a => a.iata !== origenPerfil)?.iata ?? '';
    setForm({ ...FORM_VACIO, origen_iata: origenPerfil, destino_iata: destinoInicial });
    setModalAbierto(true);
  };

  const abrirEditar = (r: Ruta) => {
    setEditando(r);
    setForm({
      origen_iata: r.origen_iata, destino_iata: r.destino_iata,
      salida: minutosAHora(r.salida_minutos).slice(0, 5),
      llegada: minutosAHora(r.llegada_minutos).slice(0, 5),
      capacidad_max: r.capacidad_max,
    });
    setModalAbierto(true);
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const payload = {
        origen_iata: form.origen_iata,
        destino_iata: form.destino_iata,
        salida_minutos: horaAMinutos(form.salida),
        llegada_minutos: horaAMinutos(form.llegada),
        capacidad_max: form.capacidad_max,
      };
      if (editando) {
        await api(`/api/operario/rutas/${editando.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Ruta actualizada');
      } else {
        await api('/api/operario/rutas', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Ruta creada');
      }
      setModalAbierto(false);
      cargar();
      solicitarReplanificacion();
    } catch (e: any) {
      toast.error('No se pudo guardar', { description: e.message });
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (r: Ruta) => {
    if (!window.confirm(`¿Eliminar la ruta ${r.origen_iata} → ${r.destino_iata} del catálogo del día a día?`)) return;
    try {
      await api(`/api/operario/rutas/${r.id}`, { method: 'DELETE' });
      toast.success('Ruta eliminada');
      cargar();
      solicitarReplanificacion();
    } catch (e: any) {
      toast.error('No se pudo eliminar', { description: e.message });
    }
  };

  const cancelarSalida = async (r: Ruta) => {
    const salidaUTC = salidaUTCDeFila(r);
    if (salidaUTC == null) return;
    if (!window.confirm(`¿Cancelar la salida ${r.origen_iata} → ${r.destino_iata}? Las maletas asignadas se re-planificarán por otra ruta.`)) return;
    const okCancel = await cancelarVuelo(r.origen_iata, r.destino_iata, salidaUTC, r.id);
    if (okCancel) {
      toast.success(`Vuelo ${r.origen_iata} → ${r.destino_iata} cancelado — re-planificando`);
      // El backend ya dispara replanificación al cancelar, pero esta llamada es
      // idempotente y cubre casos donde el operario se reconectó/reabrió la vista.
      solicitarReplanificacion();
    } else toast.error('No se pudo cancelar el vuelo');
  };

  const subirArchivo = async () => {
    if (!archivo) return;
    setSubiendo(true);
    setResultado('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const res = await fetch(`${BFF}/api/operario/rutas/archivo`, {
        method: 'POST', headers: authHeader(), body: fd,
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message ?? 'Error al subir');
      setResultado(`${j.data.registradas} rutas cargadas, ${j.data.fallidas} con error`);
      if (Array.isArray(j.data.errores) && j.data.errores.length > 0) {
        console.warn('[Rutas] líneas con error:', j.data.errores);
      }
      toast.success('Archivo procesado', { description: `${j.data.registradas} rutas cargadas` });
      setArchivo(null);
      cargar();
      solicitarReplanificacion();
    } catch (e: any) {
      toast.error('No se pudo subir el archivo', { description: e.message });
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <Stack gap={5}>
      {/* Carga por archivo */}
      <Tile>
        <Stack gap={4}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Cargar rutas desde archivo</h2>
          <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
            Formato: ORIGEN-DESTINO-HH:MM-HH:MM-CAPACIDAD (una por línea). Las horas son locales
            de cada aeropuerto. Las líneas que empiezan con <code>*</code> o <code>#</code> se ignoran,
            así puedes pegar el bloque de planes de vuelo tal cual.
          </p>
          <FileUploaderDropContainer
            labelText="Arrastra o elige un archivo .txt"
            accept={['.txt']}
            multiple={false}
            onAddFiles={(_e: unknown, { addedFiles }: { addedFiles: File[] }) => setArchivo(addedFiles[0] ?? null)}
          />
          {archivo && <FileUploaderItem name={archivo.name} status="edit" onDelete={() => setArchivo(null)} />}
          <Button renderIcon={Upload} disabled={!archivo || subiendo} onClick={subirArchivo}>
            {subiendo ? 'Subiendo…' : 'Subir rutas'}
          </Button>
          {resultado && <InlineNotification kind="success" lowContrast hideCloseButton title="Listo" subtitle={resultado} />}
        </Stack>
      </Tile>

      {/* Tabla de rutas */}
      <Tile>
        <Stack gap={4}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Rutas del día a día ({rutas.length})</h2>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Button kind="ghost" size="sm" renderIcon={Renew} onClick={cargar}>Actualizar</Button>
              <Button size="sm" renderIcon={Add} onClick={abrirCrear}>Nueva ruta</Button>
            </div>
          </div>

          {rutas.length === 0 && (
            <InlineNotification kind="info" lowContrast hideCloseButton title="Sin rutas cargadas"
              subtitle="El día a día arranca con el catálogo vacío. Carga el archivo de planes de vuelo o crea rutas a mano antes de iniciar la simulación." />
          )}

          <TextInput
            id="filtro-rutas" labelText="Buscar" placeholder="Filtrar por origen o destino…"
            value={filtro} onChange={(e) => setFiltro(e.target.value)}
          />

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--cds-border-subtle)' }}>
                  {CAMPOS.map(c => (
                    <th key={c} onClick={() => toggleOrden(c)}
                      style={{ cursor: 'pointer', padding: '.5rem .6rem', userSelect: 'none', color: 'var(--cds-text-secondary)', whiteSpace: 'nowrap' }}>
                      {ETIQUETAS[c]}{ordenPor === c ? (ordenAsc ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  <th style={{ padding: '.5rem .6rem' }}>Llegada</th>
                  <th style={{ padding: '.5rem .6rem' }}>Tipo</th>
                  <th style={{ padding: '.5rem .6rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rutasVisibles.map(r => {
                  const salidaUTC = salidaUTCDeFila(r);
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--cds-border-subtle)' }}>
                      <td style={{ padding: '.45rem .6rem', fontFamily: 'monospace' }}>{r.origen_iata}</td>
                      <td style={{ padding: '.45rem .6rem', fontFamily: 'monospace' }}>{r.destino_iata}</td>
                      <td style={{ padding: '.45rem .6rem', whiteSpace: 'nowrap' }}>{minutosAHora(r.salida_minutos)}</td>
                      <td style={{ padding: '.45rem .6rem', textAlign: 'right' }}>{r.capacidad_max}</td>
                      <td style={{ padding: '.45rem .6rem', whiteSpace: 'nowrap' }}>{minutosAHora(r.llegada_minutos)}</td>
                      <td style={{ padding: '.45rem .6rem' }}>
                        <Tag size="sm" type={r.mismo_continente ? 'blue' : 'purple'}>
                          {r.mismo_continente ? 'Continental' : 'Intercontinental'}
                        </Tag>
                      </td>
                      <td style={{ padding: '.45rem .6rem' }}>
                        <div style={{ display: 'flex', gap: '.25rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <Button size="sm" kind="ghost" renderIcon={CloseOutline}
                            disabled={salidaUTC == null}
                            title={salidaUTC == null
                              ? 'No hay una salida de esta ruta en el plan actual (la simulación debe estar corriendo)'
                              : 'Cancela la próxima salida y re-planifica las maletas'}
                            onClick={() => cancelarSalida(r)}>
                            Cancelar vuelo
                          </Button>
                          <Button size="sm" kind="ghost" renderIcon={Edit} onClick={() => abrirEditar(r)}>Editar</Button>
                          <Button size="sm" kind="danger--ghost" renderIcon={TrashCan} onClick={() => eliminar(r)}>Eliminar</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rutasVisibles.length === 0 && rutas.length > 0 && (
                  <tr><td colSpan={7} style={{ padding: '1rem', textAlign: 'center', color: 'var(--cds-text-secondary)' }}>
                    Ninguna ruta coincide con el filtro.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
            <strong>Cancelar vuelo</strong> anula solo la salida de hoy y re-rutea las maletas al instante;
            requiere que la simulación esté corriendo. <strong>Eliminar</strong> borra la ruta del catálogo.
          </p>
        </Stack>
      </Tile>

      <Modal
        open={modalAbierto}
        modalHeading={editando ? `Editar ruta ${editando.origen_iata} → ${editando.destino_iata}` : 'Nueva ruta'}
        primaryButtonText={guardando ? 'Guardando…' : 'Guardar'}
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={guardando || !form.origen_iata || !form.destino_iata || form.origen_iata === form.destino_iata}
        onRequestSubmit={guardar}
        onRequestClose={() => setModalAbierto(false)}
      >
        <Stack gap={5}>
          <Select id="ruta-origen" labelText="Origen" value={form.origen_iata}
            onChange={e => setForm(f => ({ ...f, origen_iata: e.target.value }))}>
            {aeropuertosBFF.map(a => <SelectItem key={a.iata} value={a.iata} text={`${a.iata} — ${a.ciudad}, ${a.pais}`} />)}
          </Select>
          <Select id="ruta-destino" labelText="Destino" value={form.destino_iata}
            onChange={e => setForm(f => ({ ...f, destino_iata: e.target.value }))}>
            {aeropuertosBFF.map(a => <SelectItem key={a.iata} value={a.iata} text={`${a.iata} — ${a.ciudad}, ${a.pais}`} />)}
          </Select>
          {form.origen_iata === form.destino_iata && (
            <InlineNotification kind="error" lowContrast hideCloseButton title="Origen y destino iguales"
              subtitle="Elige aeropuertos distintos." />
          )}
          <TextInput id="ruta-salida" labelText="Hora de salida (local del origen)" type="time"
            value={form.salida} onChange={e => setForm(f => ({ ...f, salida: e.target.value }))} />
          <TextInput id="ruta-llegada" labelText="Hora de llegada (local del destino)" type="time"
            value={form.llegada} onChange={e => setForm(f => ({ ...f, llegada: e.target.value }))} />
          <NumberInput id="ruta-capacidad" label="Capacidad (maletas)" min={1} max={65535}
            value={form.capacidad_max} invalidText="Debe ser mayor que cero"
            onChange={(_e: unknown, { value }: { value: number | string }) => setForm(f => ({ ...f, capacidad_max: Number(value) || 1 }))} />
        </Stack>
      </Modal>
    </Stack>
  );
}
