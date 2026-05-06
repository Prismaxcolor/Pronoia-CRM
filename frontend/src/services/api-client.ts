const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'pronoia_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const resp = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await resp.text();
  const data = text ? safeParse(text) : null;

  if (!resp.ok) {
    const body = data as
      | { error?: string; detalles?: Array<{ campo?: string; mensaje?: string }> }
      | null;
    let msg = body?.error ?? `Error ${resp.status}`;
    if (body?.detalles?.length) {
      const dets = body.detalles
        .map(d => (d.campo && d.campo !== '(raíz)' ? `${d.campo}: ${d.mensaje}` : d.mensaje))
        .filter(Boolean)
        .join(' · ');
      if (dets) msg = `${msg} (${dets})`;
    }
    throw new ApiError(msg, resp.status);
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
