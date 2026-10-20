// Thin fetch wrapper. Sign-in uses an HttpOnly session cookie. In local
// development only, the `x-user-id` header can stand in for signing in
// ("Continue as demo owner"); the server ignores it in production.

const DEV_USER_KEY = 'easycontract.devUser';
export const DEFAULT_DEV_USER = 'user_owner';

/** The dev user to send, or null when the dev shortcut is off. */
export function devUser(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const v = localStorage.getItem(DEV_USER_KEY);
    return v === 'off' ? null : v || DEFAULT_DEV_USER;
  } catch {
    return DEFAULT_DEV_USER;
  }
}

export function setDevUser(value: string | 'off') {
  try { localStorage.setItem(DEV_USER_KEY, value); } catch { /* convenience only */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function headersFor(init: RequestInit) {
  const headers = new Headers(init.headers);
  const dev = devUser();
  if (dev) headers.set('x-user-id', dev);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  return headers;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: headersFor(init), credentials: 'same-origin' });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? (res.status === 404 ? 'Not found.' : 'Something went wrong.'), body?.code);
  return body as T;
}

/** Downloads a file from the API (the dev sign-in header means a plain link won't do). */
export async function download(path: string) {
  const res = await fetch(`/api${path}`, { headers: headersFor({}), credentials: 'same-origin' });
  if (!res.ok) {
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    throw new ApiError(res.status, body?.error ?? 'The download failed.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
