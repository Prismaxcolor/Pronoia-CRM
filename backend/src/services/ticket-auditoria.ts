import { registrarAuditoria } from './auditoria-service.js';
import type { ActorEdicion } from './edicion-autorizada-service.js';
import { calcularCambios, type CambiosAuditoria } from '../utils/auditoria.js';
import { resumirTicket, type TicketAuditable } from '../utils/auditoria-ticket.js';
import { cambiosAuditoriaFactura, type AvisoFactura } from '../utils/factura-ticket-edicion.js';

/** Ticket facturado cuya factura no se encontró (flag huérfano): se deja constancia. */
const AVISO_FACTURADO_SIN_FACTURA: CambiosAuditoria = {
  'Ticket facturado (sin factura vinculada)': { antes: null, despues: 'sí' },
};

/** Registra la edición de un ticket con el antes/después de los campos relevantes.
 *  No lanza nunca (ver registrarAuditoria). Devuelve false si no quedó registrada. */
export async function auditarEdicionTicket(
  ticketId: string,
  actor: ActorEdicion,
  autorizadoPor: string | null,
  antes: TicketAuditable | null,
  despues: TicketAuditable,
  opts: { facturado?: boolean; avisosFactura?: ReadonlyArray<AvisoFactura> } = {}
): Promise<boolean> {
  const cambiosCampos = antes ? calcularCambios(resumirTicket(antes), resumirTicket(despues)) : {};
  const avisos = opts.avisosFactura ?? [];
  const cambiosFactura = avisos.length > 0
    ? cambiosAuditoriaFactura(avisos)
    : opts.facturado ? AVISO_FACTURADO_SIN_FACTURA : {};
  const cambios = { ...cambiosCampos, ...cambiosFactura };
  return registrarAuditoria({
    entidadTipo: 'ticket_pesaje',
    entidadId: ticketId,
    accion: 'editar',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor,
    cambios,
  });
}
