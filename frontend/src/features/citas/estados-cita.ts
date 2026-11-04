import type { EstadoCita } from '../../services/citas-service';
import type { Tono } from '../../components/ui';

/** Texto y tono de cada estado de cita (compartido por la lista y la agenda). El rojo no se usa: una cita cancelada es neutra. */
export const INFO_ESTADO_CITA: Record<EstadoCita, { texto: string; textoCorto: string; tono: Tono; ayuda: string }> = {
  pendiente: { texto: 'Pendiente', textoCorto: 'Pendiente', tono: 'aviso', ayuda: 'Se pidió la cita y todavía falta confirmarla.' },
  confirmada: { texto: 'Confirmada', textoCorto: 'Confirmada', tono: 'exito', ayuda: 'La cita ya fue confirmada.' },
  reprogramada: { texto: 'Reprogramada', textoCorto: 'Reprog.', tono: 'info', ayuda: 'La cita se movió a otra fecha u hora.' },
  cancelada: { texto: 'Cancelada', textoCorto: 'Cancelada', tono: 'neutral', ayuda: 'La cita se canceló y no cuenta en los totales.' },
  completada: { texto: 'Completada', textoCorto: 'Completada', tono: 'marca', ayuda: 'El despacho ya se realizó y no cuenta en los totales.' },
};
