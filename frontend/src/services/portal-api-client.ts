const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'pronoia_portal_token';

// Separado a propósito de api-client.ts (staff): son dos sesiones distintas, con
// secretos de firma distintos del lado del backend — nunca deben mezclarse.

export function getPortalToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setPortalToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearPortalToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class PortalApiError extends Error {
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

export async function portalApiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (opts.auth !== false) {
    const token = getPortalToken();
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
    const body = data as { error?: string } | null;
    throw new PortalApiError(body?.error ?? `Error ${resp.status}`, resp.status);
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
