const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// Separado a propósito de api-client.ts (staff): son dos sesiones distintas. La del
// portal viaja en una cookie httpOnly (credentials: 'include') en vez de un Bearer
// token guardado en localStorage — así un XSS en el portal no puede robar la sesión
// vía JS. El navegador la adjunta solo, nunca la tocamos desde el frontend.

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
}

export async function portalApiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const resp = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
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
