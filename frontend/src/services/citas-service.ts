import { apiFetch } from './api-client';

export type EstadoCita = 'pendiente' | 'confirmada' | 'reprogramada' | 'cancelada' | 'completada';

export interface Cita {
  id: string;
  entidadTipo: 'proveedor' | 'cliente';
  entidadId: string;
  nombreEntidad: string;
  fecha: string;
  hora: string;
  estado: EstadoCita;
  notas: string | null;
  createdAt: string;
}

export async function listarCitas(desde?: string, hasta?: string): Promise<Cita[]> {
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const query = params.toString() ? `?${params.toString()}` : '';
  const result = await apiFetch<{ citas: Cita[] }>(`/api/citas${query}`);
  return result.citas;
}

export async function actualizarEstadoCita(id: string, estado: EstadoCita): Promise<Cita> {
  const result = await apiFetch<{ cita: Cita }>(`/api/citas/${id}/estado`, {
    method: 'PATCH',
    body: { estado },
  });
  return result.cita;
}
