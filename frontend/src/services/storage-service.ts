import { getToken } from './api-client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function subirArchivo(tipo: 'productos' | 'tickets' | 'taras' | 'comprobantes' | 'traslados', file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append('file', file);

  const token = getToken();
  const resp = await fetch(`${API_URL}/api/uploads/${tipo}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as { url: string };
  return data.url;
}

export function subirImagenProducto(file: File): Promise<string | null> {
  return subirArchivo('productos', file);
}

/** Sube una foto de evidencia del pesaje. */
export function subirFotoTicket(file: File): Promise<string | null> {
  return subirArchivo('tickets', file);
}

/** Sube la foto de una tara predefinida. */
export function subirFotoTara(file: File): Promise<string | null> {
  return subirArchivo('taras', file);
}

/** Sube la foto del comprobante de un pago (transferencia, USDT, etc.). */
export function subirComprobantePago(file: File): Promise<string | null> {
  return subirArchivo('comprobantes', file);
}

/** Sube una foto de evidencia de recepción de un traslado entre almacenes. */
export function subirFotoTraslado(file: File): Promise<string | null> {
  return subirArchivo('traslados', file);
}
