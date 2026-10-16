/** Lógica pura de qué tickets de pesaje se pueden facturar (sin React ni DOM). */

export interface TicketFacturableMinimo {
  tipo: 'compra' | 'venta';
  estado: 'bruto' | 'completo';
  facturado: boolean;
  ticketPrincipalId?: string | null;
}

/** Facturable = completo (con materiales), sin factura y no unido a otro ticket (el principal lo cubre).
 *  Un pesaje global en bruto nunca lo es. */
export function esTicketFacturable(t: TicketFacturableMinimo): boolean {
  return t.estado === 'completo' && !t.facturado && !t.ticketPrincipalId;
}

/** Tickets que aún esperan factura, del tipo pedido. No muta la lista de entrada. */
export function ticketsPendientesDeFacturar<T extends TicketFacturableMinimo>(
  tickets: readonly T[],
  tipo: 'compra' | 'venta',
): T[] {
  return tickets.filter(t => t.tipo === tipo && esTicketFacturable(t));
}
