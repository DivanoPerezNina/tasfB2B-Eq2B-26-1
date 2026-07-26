/** auth.ts — manejo de la sesión (perfil + token guardados por pestaña en sessionStorage). */

const KEY = 'tasf_auth';
const storage = typeof window !== 'undefined' ? window.sessionStorage : undefined;

export type Rol = 'admin' | 'operario';

export interface Perfil {
  token: string;
  usuario: string;
  rol: Rol;
  aeropuertoIata?: string;
}

export function getPerfil(): Perfil | null {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Perfil) : null;
  } catch {
    return null;
  }
}

export function setPerfil(p: Perfil): void {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* noop */ }
}

export function clearPerfil(): void {
  try { storage?.removeItem(KEY); } catch { /* noop */ }
}

export function isAuthed(): boolean {
  return !!getPerfil();
}

/** Header listo para fetch: {} si no hay sesión. */
export function authHeader(): Record<string, string> {
  const p = getPerfil();
  return p ? { Authorization: `Bearer ${p.token}` } : {};
}
