import { registrarAuditoria } from './auditoria-service.js';
import type { ActorEdicion } from './edicion-autorizada-service.js';
import { calcularCambios } from '../utils/auditoria.js';
import { resumirTicket, type TicketAuditable } from '../utils/auditoria-ticket.js';

/** Registra la edición de un ticket con el antes/después de los campos relevantes.
 *  No lanza nunca (ver registrarAuditoria). */
export async function auditarEdicionTicket(
  ticketId: string,
  actor: ActorEdicion,
  autorizadoPor: string | null,
  antes: TicketAuditable | null,
  despues: TicketAuditable
): Promise<void> {
  const cambios = antes ? calcularCambios(resumirTicket(antes), resumirTicket(despues)) : {};
  await registrarAuditoria({
    entidadTipo: 'ticket_pesaje',
    entidadId: ticketId,
    accion: 'editar',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor,
    cambios,
  });
}
