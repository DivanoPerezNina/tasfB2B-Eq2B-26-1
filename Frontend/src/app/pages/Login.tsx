/**
 * Login — pantalla de acceso (usuario/clave por cuenta, admin u operario) + muro de comentarios.
 *
 * El muro es anónimo: no pide usuario, pero cada comentario guarda y MUESTRA
 * toda la metadata capturable (IP pública vista por el servidor, navegador/SO,
 * zona horaria, pantalla, CPU/RAM, GPU, IPs locales, fecha/hora).
 *
 * Primera pantalla migrada a Carbon Design System.
 */
import React, { useEffect, useState } from 'react';
import {
  Tile, TextInput, PasswordInput, Button, Form, Stack,
  InlineNotification, Tag,
} from '@carbon/react';
import { Login as LoginIcon, Send, Chat, Earth, Time, Location, Screen, Chip } from '@carbon/icons-react';
import { setPerfil, Perfil } from '../lib/auth';
import { recolectarFingerprint } from '../lib/fingerprint';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

interface Comentario {
  id: string;
  texto: string;
  fecha_utc: string;
  ip: string;
  user_agent: string;
  idioma: string;
  cliente?: Record<string, any>;
}

export function Login({ onSuccess }: { onSuccess: (perfil: Perfil) => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave]     = useState('');
  const [error, setError]     = useState('');
  const [entrando, setEntrando] = useState(false);

  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [texto, setTexto]   = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargarMuro = () => {
    fetch(`${BFF}/api/muro`)
      .then(r => r.json())
      .then(j => setComentarios(Array.isArray(j.data) ? j.data : []))
      .catch(() => { /* BFF puede no estar arriba */ });
  };
  useEffect(cargarMuro, []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEntrando(true);
    try {
      const res = await fetch(`${BFF}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, clave }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.message ?? 'Credenciales inválidas');
      }
      const perfil: Perfil = {
        token: j.data.token,
        usuario: j.data.usuario,
        rol: j.data.rol,
        aeropuertoIata: j.data.aeropuerto_iata,
      };
      setPerfil(perfil);
      onSuccess(perfil);
    } catch (err: any) {
      setError(err.message ?? 'Error al iniciar sesión');
    } finally {
      setEntrando(false);
    }
  };

  const publicar = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      const cliente = await recolectarFingerprint();
      const res = await fetch(`${BFF}/api/muro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto.trim(), cliente }),
      });
      if (res.ok) {
        setTexto('');
        cargarMuro();
      }
    } catch { /* noop */ } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', width: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
      background: 'var(--cds-background)',
    }}>
      <div style={{
        display: 'grid', gap: '1.5rem', width: '100%', maxWidth: '64rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      }}>

        {/* ── Login ── */}
        <Tile>
          <Stack gap={5}>
            <div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>TASF.B2B</h1>
              <p style={{ color: 'var(--cds-text-secondary)', fontSize: '.75rem', margin: 0 }}>
                Acceso a operaciones y simulación
              </p>
            </div>

            <Form onSubmit={entrar}>
              <Stack gap={5}>
                <TextInput
                  id="login-usuario"
                  labelText="Usuario"
                  value={usuario}
                  onChange={e => setUsuario(e.target.value)}
                  autoFocus
                />
                <PasswordInput
                  id="login-clave"
                  labelText="Clave"
                  value={clave}
                  onChange={e => setClave(e.target.value)}
                />
                {error && (
                  <InlineNotification
                    kind="error"
                    lowContrast
                    title="No se pudo entrar"
                    subtitle={error}
                    hideCloseButton
                  />
                )}
                <Button type="submit" disabled={entrando} renderIcon={LoginIcon}>
                  {entrando ? 'Entrando…' : 'Entrar'}
                </Button>
              </Stack>
            </Form>
          </Stack>
        </Tile>

        {/* ── Muro ── */}
        <Tile>
          <Stack gap={4}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <Chat />
              <h2 style={{ fontSize: '.875rem', fontWeight: 600, margin: 0 }}>Muro público</h2>
              <span style={{ marginLeft: 'auto', fontSize: '.75rem', color: 'var(--cds-text-secondary)' }}>
                {comentarios.length} comentarios
              </span>
            </div>

            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <TextInput
                  id="muro-texto"
                  labelText="Comentario"
                  placeholder="Escribe un comentario…"
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') publicar(); }}
                />
              </div>
              <Button
                hasIconOnly renderIcon={Send} iconDescription="Publicar"
                onClick={publicar} disabled={enviando || !texto.trim()}
              />
            </div>
            <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
              Al comentar se registra tu IP, navegador y dispositivo (visible abajo).
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', maxHeight: '18rem', overflowY: 'auto' }}>
              {comentarios.length === 0 && (
                <p style={{ textAlign: 'center', fontSize: '.75rem', color: 'var(--cds-text-secondary)', padding: '1.5rem 0' }}>
                  Sé el primero en comentar
                </p>
              )}
              {comentarios.map(c => (
                <Tile key={c.id} style={{ background: 'var(--cds-layer-accent)' }}>
                  <p style={{ fontSize: '.875rem', wordBreak: 'break-word', margin: 0 }}>{c.texto}</p>
                  <div style={{ marginTop: '.5rem', display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                    <Tag size="sm" type="gray" renderIcon={Earth}>{c.ip || '—'}</Tag>
                    <Tag size="sm" type="gray" renderIcon={Time}>{new Date(c.fecha_utc).toLocaleString()}</Tag>
                    {c.cliente?.zonaHoraria && <Tag size="sm" type="gray" renderIcon={Location}>{c.cliente.zonaHoraria}</Tag>}
                    {c.cliente?.plataforma && <Tag size="sm" type="gray" renderIcon={Screen}>{c.cliente.plataforma}</Tag>}
                    {c.cliente?.nucleosCPU != null && (
                      <Tag size="sm" type="gray" renderIcon={Chip}>
                        {c.cliente.nucleosCPU} cores{c.cliente?.memoriaGB ? ` · ${c.cliente.memoriaGB}GB` : ''}
                      </Tag>
                    )}
                    {Array.isArray(c.cliente?.ipsLocales) && c.cliente.ipsLocales.length > 0 && (
                      <Tag size="sm" type="gray">LAN: {c.cliente.ipsLocales.join(', ')}</Tag>
                    )}
                  </div>
                  {c.user_agent && (
                    <p style={{ marginTop: '.25rem', fontSize: '.6875rem', color: 'var(--cds-text-helper)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.user_agent}>
                      {c.user_agent}
                    </p>
                  )}
                </Tile>
              ))}
            </div>
          </Stack>
        </Tile>
      </div>
    </div>
  );
}
