import type { EstadoCita } from '../../services/citas-service';
import type { Tono } from '../../components/ui';

/** Texto y tono de cada estado de cita (compartido por la lista y la agenda). El rojo no se usa: una cita cancelada es neutra. */
export const INFO_ESTADO_CITA: Record<EstadoCita, { texto: string; textoCorto: string; tono: Tono }> = {
  pendiente: { texto: 'Pendiente', textoCorto: 'Pendiente', tono: 'aviso' },
  confirmada: { texto: 'Confirmada', textoCorto: 'Confirmada', tono: 'exito' },
  reprogramada: { texto: 'Reprogramada', textoCorto: 'Reprog.', tono: 'info' },
  cancelada: { texto: 'Cancelada', textoCorto: 'Cancelada', tono: 'neutral' },
  completada: { texto: 'Completada', textoCorto: 'Completada', tono: 'marca' },
};
