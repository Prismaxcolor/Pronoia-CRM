import { apiFetch } from './api-client';
import type { Cambista, CambistaConSaldo, EstadoCuentaMesa, TipoAsiento } from '@shared/types/mesa-cambio';

export interface CambistaInput {
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
}

export interface AsientoInput {
  cambistaId: string;
  tipo: TipoAsiento;
  montoUsd: number;
  tasa: number | null;
  fecha: string;
  nota: string | null;
  referencia: string | null;
}

export type Resultado<T> = T | { error: string };

function mensajeDe(e: unknown, porDefecto: string): string {
  return e instanceof Error && e.message ? e.message : porDefecto;
}

async function ejecutar<T>(accion: () => Promise<T>, porDefecto: string): Promise<Resultado<T>> {
  try {
    return await accion();
  } catch (e) {
    return { error: mensajeDe(e, porDefecto) };
  }
}

export const obtenerCambistas = () =>
  ejecutar(() => apiFetch<{ cambistas: CambistaConSaldo[] }>('/api/mesa-cambio/cambistas'), 'No se pudieron cargar los cambistas.');

export const crearCambista = (input: CambistaInput) =>
  ejecutar(() => apiFetch<{ cambista: Cambista }>('/api/mesa-cambio/cambistas', { method: 'POST', body: input }), 'No se pudo crear el cambista.');

export const actualizarCambista = (id: string, input: Partial<CambistaInput> & { activo?: boolean }) =>
  ejecutar(
    () => apiFetch<{ cambista: Cambista }>(`/api/mesa-cambio/cambistas/${id}`, { method: 'PATCH', body: input }),
    'No se pudo actualizar el cambista.',
  );

export function obtenerEstadoCuentaMesa(id: string, rango: { desde?: string; hasta?: string }) {
  const q = new URLSearchParams();
  if (rango.desde) q.set('desde', rango.desde);
  if (rango.hasta) q.set('hasta', rango.hasta);
  const sufijo = q.size > 0 ? `?${q.toString()}` : '';
  return ejecutar(
    () => apiFetch<{ estado: EstadoCuentaMesa }>(`/api/mesa-cambio/cambistas/${id}/estado-cuenta${sufijo}`),
    'No se pudo cargar el estado de cuenta.',
  );
}

export const registrarAsiento = (input: AsientoInput) =>
  ejecutar(() => apiFetch<{ asiento: { id: string; numero: number } }>('/api/mesa-cambio/asientos', { method: 'POST', body: input }), 'No se pudo registrar el asiento.');

export const anularAsientoMesa = (id: string, motivo: string) =>
  ejecutar(() => apiFetch<{ ok: true }>(`/api/mesa-cambio/asientos/${id}/anular`, { method: 'POST', body: { motivo } }), 'No se pudo anular el asiento.');
