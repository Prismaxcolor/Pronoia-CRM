import { apiFetch } from './api-client';
import type { EntidadConLlave } from './auditoria-service';

export type EstadoSolicitudLlave = 'pendiente' | 'aprobada' | 'rechazada' | 'usada' | 'expirada';

export interface SolicitudLlave {
  id: string;
  solicitanteNombre: string;
  entidadTipo: string;
  entidadId: string;
  /** Texto legible de lo que se quiere editar (p. ej. "Ticket de pesaje Compra-0042 · Metales SA"). */
  descripcion: string;
  motivo: string;
  estado: EstadoSolicitudLlave;
  aprobadorNombre: string | null;
  motivoRechazo: string | null;
  resueltaEn: string | null;
  createdAt: string;
  expiraEn: string;
  /** Solo viene en la respuesta que entrega el código al solicitante: el servidor lo muestra UNA vez. */
  codigo?: string;
}

export type ResultadoApi<T> = { ok: true; data: T } | { ok: false; error: string };

async function llamar<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<ResultadoApi<T>> {
  try {
    return { ok: true, data: await apiFetch<T>(path, { method, body }) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo completar la operación.' };
  }
}

const BASE = '/api/llaves-solicitudes';

/** Crea la solicitud, o devuelve la pendiente que el usuario ya tenía para ese documento. */
export const crearSolicitudLlave = (entidadTipo: EntidadConLlave, entidadId: string, motivo: string) =>
  llamar<{ solicitud: SolicitudLlave; existente: boolean }>(BASE, 'POST', { entidadTipo, entidadId, motivo });

/** Estado de una solicitud. Si está aprobada y es del usuario, trae `codigo` (una sola vez). */
export const obtenerSolicitudLlave = (id: string) => llamar<SolicitudLlave>(`${BASE}/${id}`);

export const listarSolicitudesLlave = (estado: EstadoSolicitudLlave = 'pendiente') =>
  llamar<SolicitudLlave[]>(`${BASE}?estado=${estado}`);

export const contarSolicitudesPendientes = () => llamar<{ pendientes: number }>(`${BASE}/pendientes/conteo`);

export const aprobarSolicitudLlave = (id: string) => llamar<SolicitudLlave>(`${BASE}/${id}/aprobar`, 'POST', {});

export const rechazarSolicitudLlave = (id: string, motivo?: string) =>
  llamar<SolicitudLlave>(`${BASE}/${id}/rechazar`, 'POST', motivo ? { motivo } : {});
