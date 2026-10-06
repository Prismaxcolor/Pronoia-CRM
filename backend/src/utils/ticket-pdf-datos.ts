import { redondearKg } from './peso-kg.js';

/** Datos puros del PDF del ticket de pesaje (fáciles de probar sin armar el documento). */

export const TITULO_TICKET_POR_RECEPCIONAR = 'Pesaje global por recepcionar';
export const TITULO_TICKET = 'Ticket de pesaje';

/** Título del documento según el estado del ticket (sin la palabra "bruto"). */
export function tituloTicket(estado: 'bruto' | 'completo'): string {
  return estado === 'bruto' ? TITULO_TICKET_POR_RECEPCIONAR : TITULO_TICKET;
}

/** Total de kg pesados: suma del neto de los materiales; en un ticket sin materiales, el peso global. */
export function totalKgPesados(t: { materiales: ReadonlyArray<{ pesoNeto: number }>; pesoGlobal: number }): number {
  if (t.materiales.length === 0) return redondearKg(t.pesoGlobal);
  return redondearKg(t.materiales.reduce((acc, m) => acc + m.pesoNeto, 0));
}

/** Fecha del pesaje global (YYYY-MM-DD): la del ticket, o la de creación si no tiene. */
export function fechaPesajeGlobal(t: { fecha: string | null; createdAt: string }): string {
  return (t.fecha ?? t.createdAt).slice(0, 10);
}
