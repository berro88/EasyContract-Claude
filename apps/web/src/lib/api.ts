// Thin fetch wrapper. In development the signed-in user is picked by the
// `x-user-id` header; real sign-in replaces this in Stage 8.

const DEV_USER_KEY = 'easycontract.devUser';
export const DEFAULT_DEV_USER = 'user_owner';

export function devUser(): string {
  try {
    return localStorage.getItem(DEV_USER_KEY) || DEFAULT_DEV_USER;
  } catch {
    return DEFAULT_DEV_USER;
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-user-id', devUser());
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? (res.status === 404 ? 'Not found.' : 'Something went wrong.'));
  return body as T;
}

/** Downloads a file from the API (the dev sign-in header means a plain link won't do). */
export async function download(path: string) {
  const headers = new Headers({ 'x-user-id': devUser() });
  const res = await fetch(`/api${path}`, { headers });
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
