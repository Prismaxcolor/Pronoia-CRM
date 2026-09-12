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

/** Horarios de despacho disponibles. Vienen del backend (HORARIOS_DISPONIBLES
 *  en cita-despacho-service.ts) — no se hardcodean acá para no desincronizarse. */
export async function obtenerHorarios(): Promise<string[]> {
  try {
    const { horarios } = await apiFetch<{ horarios: string[] }>('/api/citas/horarios');
    return horarios;
  } catch {
    return [];
  }
}

export interface CrearCitaStaffInput {
  entidadTipo: 'proveedor' | 'cliente';
  entidadId: string;
  fecha: string;
  hora: string;
  notas?: string;
}

/** Agenda una cita en nombre de un proveedor/cliente (walk-in o por teléfono). */
export async function crearCitaStaff(input: CrearCitaStaffInput): Promise<{ cita: Cita } | { error: string }> {
  try {
    const { cita } = await apiFetch<{ cita: Cita }>('/api/citas', {
      method: 'POST',
      body: input,
    });
    return { cita };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo agendar la cita.' };
  }
}
