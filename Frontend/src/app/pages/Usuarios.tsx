/**
 * Usuarios — alta de cuentas de operario/admin (tarea 8.2: antes era un
 * INSERT manual en la BD, ver backend/db/migracion_usuarios.sql).
 * Sin borrado a propósito: las cuentas se activan/desactivan (Toggle),
 * igual que ya hace Login validando `activo` contra la BD.
 */
import { useEffect, useState } from 'react';
import {
  Tile, Stack, Button, Tag, Toggle, Modal, TextInput, PasswordInput,
  Select, SelectItem, InlineNotification, Loading,
} from '@carbon/react';
import { Add, UserAdmin, UserAvatar, TrashCan } from '@carbon/icons-react';
import { useDomain } from '../context/DomainContext';
import { authHeader, getPerfil } from '../lib/auth';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

interface UsuarioRow {
  id: number;
  usuario: string;
  rol: 'admin' | 'operario';
  aeropuerto_iata?: string;
  activo: boolean;
  creado_en: string;
}

const FORM_VACIO = { usuario: '', clave: '', rol: 'operario' as 'admin' | 'operario', aeropuerto_iata: '' };

async function apiRequest(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BFF}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message ?? `Error HTTP ${res.status}`);
  return body.data;
}

export function Usuarios() {
  const { aeropuertosBFF } = useDomain();
  const yoUsuario = getPerfil()?.usuario;

  const [lista, setLista] = useState<UsuarioRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; title: string; subtitle: string } | null>(null);

  // Interruptor de Día a Día: independiente de la simulación, decide si los
  // operarios pueden registrar ahora mismo (ver modo_operacion.go).
  const [modoOperacion, setModoOperacion] = useState<boolean | null>(null);
  const [cambiandoModo, setCambiandoModo] = useState(false);
  const [limpiando, setLimpiando] = useState(false);

  const cargar = () => {
    setCargando(true);
    apiRequest('/api/mantenimiento/usuarios')
      .then(data => setLista(Array.isArray(data) ? data : []))
      .catch((e: any) => setFeedback({ kind: 'error', title: 'No se pudo cargar', subtitle: e.message }))
      .finally(() => setCargando(false));
  };
  useEffect(cargar, []);

  useEffect(() => {
    apiRequest('/api/modo-operacion')
      .then(data => setModoOperacion(!!data?.activo))
      .catch(() => { /* el toggle queda deshabilitado hasta poder leerlo */ });
  }, []);

  const alternarModoOperacion = async () => {
    const nuevo = !modoOperacion;
    setCambiandoModo(true);
    try {
      await apiRequest('/api/modo-operacion', { method: 'PUT', body: JSON.stringify({ activo: nuevo }) });
      setModoOperacion(nuevo);
      setFeedback({
        kind: 'success',
        title: nuevo ? 'Modo Día a Día activado' : 'Modo Día a Día desactivado',
        subtitle: nuevo ? 'Los operarios ya pueden registrar envíos.' : 'Los operarios quedan en espera.',
      });
    } catch (e: any) {
      setFeedback({ kind: 'error', title: 'No se pudo cambiar el modo', subtitle: e.message });
    } finally {
      setCambiandoModo(false);
    }
  };

  const limpiarDatosDiaADia = async () => {
    if (!window.confirm('¿Vaciar TODOS los envíos de Día a Día registrados hasta ahora? No se puede deshacer. El dataset histórico (Periodo/Colapso) no se toca.')) return;
    setLimpiando(true);
    try {
      await apiRequest('/api/modo-operacion/limpiar', { method: 'POST' });
      setFeedback({ kind: 'success', title: 'Datos limpiados', subtitle: 'envios_operacion quedó vacía. Listo para un nuevo ensayo.' });
    } catch (e: any) {
      setFeedback({ kind: 'error', title: 'No se pudo limpiar', subtitle: e.message });
    } finally {
      setLimpiando(false);
    }
  };

  const abrirCrear = () => {
    setForm({ ...FORM_VACIO, aeropuerto_iata: aeropuertosBFF[0]?.iata ?? '' });
    setModalAbierto(true);
  };

  const crear = async () => {
    setGuardando(true);
    try {
      await apiRequest('/api/mantenimiento/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          usuario: form.usuario.trim(),
          clave: form.clave,
          rol: form.rol,
          aeropuerto_iata: form.rol === 'operario' ? form.aeropuerto_iata : '',
        }),
      });
      setModalAbierto(false);
      setFeedback({ kind: 'success', title: 'Cuenta creada', subtitle: `${form.usuario} (${form.rol}) ya puede iniciar sesión.` });
      cargar();
    } catch (e: any) {
      setFeedback({ kind: 'error', title: 'No se pudo crear la cuenta', subtitle: e.message });
    } finally {
      setGuardando(false);
    }
  };

  const alternarActivo = async (u: UsuarioRow) => {
    try {
      await apiRequest(`/api/mantenimiento/usuarios/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ activo: !u.activo }),
      });
      setLista(prev => prev.map(x => x.id === u.id ? { ...x, activo: !u.activo } : x));
    } catch (e: any) {
      setFeedback({ kind: 'error', title: 'No se pudo actualizar', subtitle: e.message });
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '64rem', margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <Stack gap={5}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Usuarios</h1>
            <p style={{ color: 'var(--cds-text-secondary)', fontSize: '.8125rem', margin: 0 }}>
              Cuentas de admin y operario. Las cuentas no se borran, se desactivan.
            </p>
          </div>
          <Button renderIcon={Add} onClick={abrirCrear}>Crear cuenta</Button>
        </div>

        {feedback && (
          <InlineNotification
            kind={feedback.kind} lowContrast title={feedback.title} subtitle={feedback.subtitle}
            onCloseButtonClick={() => setFeedback(null)}
          />
        )}

        <Tile>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '.9375rem', fontWeight: 600, margin: 0 }}>Modo Día a Día</h2>
              <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                Mientras esté apagado, los operarios ven su panel pero no pueden registrar envíos.
              </p>
            </div>
            <Toggle
              id="modo-operacion-toggle" size="lg" labelText=""
              labelA="Apagado" labelB="Encendido"
              toggled={!!modoOperacion}
              disabled={modoOperacion === null || cambiandoModo}
              onToggle={alternarModoOperacion}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--cds-border-subtle)' }}>
            <div>
              <h2 style={{ fontSize: '.9375rem', fontWeight: 600, margin: 0 }}>Limpiar datos de Día a Día</h2>
              <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                Vacía los envíos registrados por los operarios para empezar un ensayo desde cero. No afecta el dataset histórico.
              </p>
            </div>
            <Button kind="danger--tertiary" size="sm" renderIcon={TrashCan} disabled={limpiando} onClick={limpiarDatosDiaADia}>
              {limpiando ? 'Limpiando…' : 'Limpiar datos'}
            </Button>
          </div>
        </Tile>

        <Tile>
          {cargando ? (
            <Loading withOverlay={false} description="Cargando usuarios…" small />
          ) : lista.length === 0 ? (
            <p style={{ color: 'var(--cds-text-secondary)', fontSize: '.875rem', margin: 0 }}>No hay cuentas registradas.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {lista.map(u => (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem',
                  padding: '.75rem 1rem', background: 'var(--cds-layer-accent)', borderRadius: '4px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    {u.rol === 'admin' ? <UserAdmin size={20} /> : <UserAvatar size={20} />}
                    <div>
                      <strong style={{ fontSize: '.875rem' }}>{u.usuario}</strong>
                      {u.usuario === yoUsuario && <Tag size="sm" type="blue" style={{ marginLeft: '.4rem' }}>Tú</Tag>}
                      <div style={{ display: 'flex', gap: '.4rem', marginTop: '.2rem' }}>
                        <Tag size="sm" type={u.rol === 'admin' ? 'purple' : 'teal'}>{u.rol}</Tag>
                        {u.aeropuerto_iata && <Tag size="sm" type="gray">{u.aeropuerto_iata}</Tag>}
                      </div>
                    </div>
                  </div>
                  <Toggle
                    id={`activo-${u.id}`}
                    size="sm"
                    labelText=""
                    labelA="Inactivo" labelB="Activo"
                    toggled={u.activo}
                    disabled={u.usuario === yoUsuario && u.activo}
                    onToggle={() => alternarActivo(u)}
                  />
                </div>
              ))}
            </div>
          )}
        </Tile>
      </Stack>

      <Modal
        open={modalAbierto}
        modalHeading="Crear cuenta"
        primaryButtonText={guardando ? 'Creando…' : 'Crear'}
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={guardando || !form.usuario.trim() || form.clave.length < 8 || (form.rol === 'operario' && !form.aeropuerto_iata)}
        onRequestSubmit={crear}
        onRequestClose={() => setModalAbierto(false)}
      >
        <Stack gap={5}>
          <TextInput
            id="nuevo-usuario" labelText="Usuario" value={form.usuario}
            onChange={e => setForm(f => ({ ...f, usuario: e.target.value }))}
          />
          <PasswordInput
            id="nueva-clave" labelText="Clave" helperText="Mínimo 8 caracteres" value={form.clave}
            onChange={e => setForm(f => ({ ...f, clave: e.target.value }))}
          />
          <Select
            id="nuevo-rol" labelText="Rol" value={form.rol}
            onChange={e => setForm(f => ({ ...f, rol: e.target.value as 'admin' | 'operario' }))}
          >
            <SelectItem value="operario" text="Operario" />
            <SelectItem value="admin" text="Admin" />
          </Select>
          {form.rol === 'operario' && (
            <Select
              id="nuevo-aeropuerto" labelText="Aeropuerto asignado" value={form.aeropuerto_iata}
              onChange={e => setForm(f => ({ ...f, aeropuerto_iata: e.target.value }))}
            >
              {aeropuertosBFF.map(a => (
                <SelectItem key={a.iata} value={a.iata} text={`${a.iata} — ${a.ciudad}, ${a.pais}`} />
              ))}
            </Select>
          )}
        </Stack>
      </Modal>
    </div>
  );
}
