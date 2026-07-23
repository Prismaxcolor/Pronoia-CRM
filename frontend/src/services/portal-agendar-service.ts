import { portalApiFetch } from './portal-api-client';

export type EstadoCita = 'pendiente' | 'confirmada' | 'reprogramada' | 'cancelada' | 'completada';

export interface HorarioDisponibilidad {
  hora: string;
  disponible: boolean;
}

export interface CitaPortal {
  id: string;
  fecha: string;
  hora: string;
  estado: EstadoCita;
  notas: string | null;
  createdAt: string;
}

export async function obtenerDisponibilidad(fecha: string): Promise<HorarioDisponibilidad[]> {
  try {
    const result = await portalApiFetch<{ horarios: HorarioDisponibilidad[] }>(
      `/api/portal/agendar/disponibilidad?fecha=${fecha}`
    );
    return result.horarios;
  } catch {
    return [];
  }
}

export async function listarMisCitas(): Promise<CitaPortal[]> {
  try {
    const result = await portalApiFetch<{ citas: CitaPortal[] }>('/api/portal/agendar');
    return result.citas;
  } catch {
    return [];
  }
}

export async function agendarCita(fecha: string, hora: string): Promise<{ ok: true } | { error: string }> {
  try {
    await portalApiFetch('/api/portal/agendar', { method: 'POST', body: { fecha, hora } });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo agendar la cita.' };
  }
}
