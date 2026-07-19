/**
 * OperarioDashboard — pantalla de trabajo del operario de Día a Día.
 *
 * Un operario está atado a un único aeropuerto (perfil.aeropuertoIata) y solo
 * puede: (1) registrar envíos manualmente uno por uno, (2) subir un archivo
 * con varios envíos de una vez. El origen NUNCA se pide — sale de la cuenta.
 * La fecha/hora tampoco se escribe a mano: se toma del reloj del navegador
 * (por eso el reloj en vivo — confirma visualmente que la laptop está en el
 * huso horario correcto antes de empezar a registrar).
 */
import React, { useEffect, useState } from 'react';
import {
  Tile, Button, Stack, Tag, TextInput, NumberInput, Select, SelectItem,
  InlineNotification, FileUploaderDropContainer, FileUploaderItem,
} from '@carbon/react';
import { UserAvatar, Logout, Location, Time, Send, Upload } from '@carbon/icons-react';
import { clearPerfil, authHeader, Perfil } from '../lib/auth';
import { toast } from 'sonner';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

interface AeroBFF {
  id: number;
  iata: string;
  ciudad: string;
  pais: string;
}

interface RegistroLog {
  idEnvio: string;
  destino: string;
  cantidad: number;
  hora: string;
}

export function OperarioDashboard({ perfil, onLogout }: { perfil: Perfil; onLogout: () => void }) {
  const [ahora, setAhora] = useState(new Date());
  const [aeropuertos, setAeropuertos] = useState<AeroBFF[]>([]);

  const [destino, setDestino] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [cliente, setCliente] = useState(7729);
  const [enviando, setEnviando] = useState(false);
  const [log, setLog] = useState<RegistroLog[]>([]);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendoArchivo, setSubiendoArchivo] = useState(false);
  const [resultadoArchivo, setResultadoArchivo] = useState('');

  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch(`${BFF}/api/aeropuertos`)
      .then(r => r.json())
      .then(j => setAeropuertos(Array.isArray(j.data) ? j.data : []))
      .catch(() => { /* la lista queda vacía; el select sigue usable a mano */ });
  }, []);

  const destinosDisponibles = aeropuertos.filter(a => a.iata !== perfil.aeropuertoIata);

  const fechaHoraLocal = () => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}T${p(ahora.getHours())}:${p(ahora.getMinutes())}:${p(ahora.getSeconds())}`;
  };

  const registrar = async () => {
    if (!destino) { toast.error('Selecciona un destino'); return; }
    if (cantidad <= 0) { toast.error('La cantidad debe ser mayor a cero'); return; }
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
      setLog(prev => [{ idEnvio: j.data.id_envio, destino, cantidad, hora: ahora.toLocaleTimeString() }, ...prev].slice(0, 20));
      toast.success(`Envío ${j.data.id_envio} registrado — ${cantidad} maleta(s) a ${destino}`);
      setDestino('');
      setCantidad(1);
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
    <div style={{ minHeight: '100vh', background: 'var(--cds-background)', padding: '1.5rem' }}>
      <div style={{ maxWidth: '56rem', margin: '0 auto' }}>
        <Stack gap={5}>

          {/* Encabezado */}
          <Tile>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <UserAvatar size={28} />
                <div>
                  <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{perfil.usuario}</h1>
                  <Tag type="blue" renderIcon={Location} size="sm">{perfil.aeropuertoIata}</Tag>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontFamily: 'var(--cds-code-01-font-family, monospace)', fontSize: '1rem' }}>
                  <Time size={18} />
                  {ahora.toLocaleTimeString()} — {ahora.toLocaleDateString()}
                </span>
                <Button kind="danger--tertiary" size="sm" renderIcon={Logout} onClick={salir}>
                  Cerrar sesión
                </Button>
              </div>
            </div>
          </Tile>

          {/* Registro manual */}
          <Tile>
            <Stack gap={4}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Registrar envío</h2>
              <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                El origen ({perfil.aeropuertoIata}) y la hora ({ahora.toLocaleTimeString()}) se toman automáticamente.
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
                    id="cantidad" label="Maletas" min={1} value={cantidad}
                    onChange={(_e: unknown, { value }: { value: number | string }) => setCantidad(Number(value) || 1)}
                  />
                </div>
                <div style={{ width: '9rem' }}>
                  <TextInput id="cliente" labelText="Cliente" value={String(cliente)} onChange={(e) => setCliente(Number(e.target.value) || 7729)} />
                </div>
                <Button renderIcon={Send} disabled={enviando || !destino} onClick={registrar}>
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
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Cargar envíos desde archivo</h2>
              <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
                Formato: id_envío-aaaammdd-hh-mm-destino-cantidad-cliente (una línea por envío).
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
              <Button renderIcon={Upload} disabled={!archivo || subiendoArchivo} onClick={subirArchivo}>
                {subiendoArchivo ? 'Subiendo…' : 'Subir'}
              </Button>
              {resultadoArchivo && (
                <InlineNotification kind="success" lowContrast hideCloseButton title="Listo" subtitle={resultadoArchivo} />
              )}
            </Stack>
          </Tile>

        </Stack>
      </div>
    </div>
  );
}
