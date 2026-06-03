/** auth.ts — manejo simple de la sesión (token guardado en localStorage). */

const KEY = 'tasf_auth_token';

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setToken(token: string): void {
  try { localStorage.setItem(KEY, token); } catch { /* noop */ }
}

export function clearToken(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

export function isAuthed(): boolean {
  return !!getToken();
}
