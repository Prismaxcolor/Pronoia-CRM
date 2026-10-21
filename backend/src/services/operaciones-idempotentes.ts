/** Variantes idempotentes de crear/completar pesaje y traslado.
 *  Sin `clientRequestId` delegan tal cual en el servicio de siempre. */
import { crearTicket, completarTicket, obtenerTicket } from './ticket-pesaje-service.js';
import { crearTraslado, completarTraslado, obtenerTraslado } from './traslado-service.js';
import { ejecutarIdempotente, buscarIdPorClientRequestId } from './idempotencia-service.js';
import { exigirIdRecurso } from './operaciones-idempotentes-cola.js';
import type { CrearTicketInput, CompletarTicketInput } from '../schemas/tickets-pesaje.js';
import type { CrearTrasladoInput, CompletarTrasladoInput } from '../schemas/traslados.js';

type ResultadoTicket = Awaited<ReturnType<typeof crearTicket>>;
type ResultadoTraslado = Awaited<ReturnType<typeof crearTraslado>>;
export interface Idempotente<T> { resultado: T; repetida: boolean }

const idTicket = (r: ResultadoTicket) => ('ticket' in r ? r.ticket.id : null);
const idTraslado = (r: ResultadoTraslado) => ('traslado' in r ? r.traslado.id : null);

export async function crearTicketIdempotente(input: CrearTicketInput, usuarioId: string): Promise<Idempotente<ResultadoTicket>> {
  const { clientRequestId, capturadoEn } = input;
  if (!clientRequestId) return { resultado: await crearTicket(input, usuarioId), repetida: false };
  return ejecutarIdempotente(clientRequestId, 'ticket_pesaje', usuarioId, () => crearTicket(input, usuarioId), {
    capturadoEn,
    entidadId: idTicket,
    buscarExistente: async () => {
      const id = await buscarIdPorClientRequestId('tickets_pesaje', clientRequestId);
      const ticket = id ? await obtenerTicket(id) : null;
      return ticket ? { ticket } : null;
    },
  });
}

export async function completarTicketIdempotente(id: string, input: CompletarTicketInput, usuarioId: string): Promise<Idempotente<ResultadoTicket>> {
  const { clientRequestId, capturadoEn } = input;
  if (!clientRequestId) return { resultado: await completarTicket(id, input, usuarioId), repetida: false };
  return ejecutarIdempotente(clientRequestId, `ticket_completar:${exigirIdRecurso(id)}`, usuarioId, () => completarTicket(id, input, usuarioId), {
    capturadoEn,
    entidadId: idTicket,
    // Un intento anterior que sí completó el ticket (mismo usuario) no se repite.
    buscarExistente: async () => {
      const ticket = await obtenerTicket(id);
      return ticket && ticket.estado === 'completo' && ticket.completadoPor === usuarioId ? { ticket } : null;
    },
  });
}

export async function crearTrasladoIdempotente(input: CrearTrasladoInput, usuarioId: string): Promise<Idempotente<ResultadoTraslado>> {
  const { clientRequestId, capturadoEn } = input;
  if (!clientRequestId) return { resultado: await crearTraslado(input, usuarioId), repetida: false };
  return ejecutarIdempotente(clientRequestId, 'traslado', usuarioId, () => crearTraslado(input, usuarioId), {
    capturadoEn,
    entidadId: idTraslado,
    buscarExistente: async () => {
      const id = await buscarIdPorClientRequestId('tickets_traslado', clientRequestId);
      const traslado = id ? await obtenerTraslado(id) : null;
      return traslado ? { traslado } : null;
    },
  });
}

export async function completarTrasladoIdempotente(id: string, input: CompletarTrasladoInput, usuarioId: string): Promise<Idempotente<ResultadoTraslado>> {
  const { clientRequestId, capturadoEn } = input;
  if (!clientRequestId) return { resultado: await completarTraslado(id, input, usuarioId), repetida: false };
  return ejecutarIdempotente(clientRequestId, `traslado_completar:${exigirIdRecurso(id)}`, usuarioId, () => completarTraslado(id, input, usuarioId), {
    capturadoEn,
    entidadId: idTraslado,
    buscarExistente: async () => {
      const traslado = await obtenerTraslado(id);
      return traslado && traslado.estado === 'completo' && traslado.completadoPor === usuarioId ? { traslado } : null;
    },
  });
}
