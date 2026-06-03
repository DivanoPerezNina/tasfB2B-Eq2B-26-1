/**
 * Login — pantalla de acceso (credencial compartida) + muro de comentarios.
 *
 * El muro es anónimo: no pide usuario, pero cada comentario guarda y MUESTRA
 * toda la metadata capturable (IP pública vista por el servidor, navegador/SO,
 * zona horaria, pantalla, CPU/RAM, GPU, IPs locales, fecha/hora).
 */
import React, { useEffect, useState } from 'react';
import { Lock, LogIn, MessageSquare, Send, Globe, Monitor, Cpu, Clock, MapPin, Loader2 } from 'lucide-react';
import { setToken } from '../lib/auth';
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

export function Login({ onSuccess }: { onSuccess: () => void }) {
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
      setToken(j.data.token);
      onSuccess();
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
    <div className="min-h-screen w-full bg-background text-panel-text flex items-center justify-center p-4">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-2">

        {/* ── Login ── */}
        <div className="rounded-2xl border border-panel-border bg-panel-bg p-8 shadow-lg">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/15">
              <Lock className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold">TASF.B2B</h1>
              <p className="text-xs text-panel-text-faint">Acceso a la simulación</p>
            </div>
          </div>

          <form onSubmit={entrar} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-panel-text-muted">Usuario</label>
              <input
                value={usuario} onChange={e => setUsuario(e.target.value)}
                className="mt-1 w-full rounded-lg border border-panel-border bg-panel-section-bg px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-panel-text-muted">Clave</label>
              <input
                type="password" value={clave} onChange={e => setClave(e.target.value)}
                className="mt-1 w-full rounded-lg border border-panel-border bg-panel-section-bg px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400/30"
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              type="submit" disabled={entrando}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {entrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Entrar
            </button>
          </form>
        </div>

        {/* ── Muro ── */}
        <div className="rounded-2xl border border-panel-border bg-panel-bg p-6 shadow-lg flex flex-col">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-panel-text-muted" />
            <h2 className="text-sm font-semibold">Muro público</h2>
            <span className="ml-auto text-[10px] text-panel-text-faint">{comentarios.length} comentarios</span>
          </div>

          <div className="flex gap-2">
            <input
              value={texto} onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') publicar(); }}
              placeholder="Escribe un comentario…"
              className="flex-1 rounded-lg border border-panel-border bg-panel-section-bg px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
            <button
              onClick={publicar} disabled={enviando || !texto.trim()}
              className="flex items-center gap-1 rounded-lg bg-panel-section-bg px-3 text-sm hover:bg-panel-hover disabled:opacity-50"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-panel-text-faint">
            Al comentar se registra tu IP, navegador y dispositivo (visible abajo).
          </p>

          <div className="mt-3 flex-1 space-y-2 overflow-y-auto max-h-72 pr-1">
            {comentarios.length === 0 && (
              <p className="py-6 text-center text-xs text-panel-text-faint">Sé el primero en comentar</p>
            )}
            {comentarios.map(c => (
              <div key={c.id} className="rounded-lg border border-panel-border bg-panel-section-bg p-2.5">
                <p className="text-sm text-panel-text break-words">{c.texto}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-panel-text-faint">
                  <span className="flex items-center gap-1"><Globe className="h-2.5 w-2.5" />{c.ip || '—'}</span>
                  <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{new Date(c.fecha_utc).toLocaleString()}</span>
                  {c.cliente?.zonaHoraria && <span className="flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{c.cliente.zonaHoraria}</span>}
                  {c.cliente?.plataforma && <span className="flex items-center gap-1"><Monitor className="h-2.5 w-2.5" />{c.cliente.plataforma}</span>}
                  {c.cliente?.nucleosCPU != null && <span className="flex items-center gap-1"><Cpu className="h-2.5 w-2.5" />{c.cliente.nucleosCPU} cores{c.cliente?.memoriaGB ? ` · ${c.cliente.memoriaGB}GB` : ''}</span>}
                  {Array.isArray(c.cliente?.ipsLocales) && c.cliente.ipsLocales.length > 0 && (
                    <span className="flex items-center gap-1">LAN: {c.cliente.ipsLocales.join(', ')}</span>
                  )}
                </div>
                {c.user_agent && (
                  <p className="mt-0.5 text-[9px] text-panel-text-faint/70 truncate" title={c.user_agent}>{c.user_agent}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
