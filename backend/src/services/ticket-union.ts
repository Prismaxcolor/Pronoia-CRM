/**
 * Lógica pura para unir tickets de pesaje global de un mismo proveedor al
 * completar uno de ellos (Punto 3). No toca la BD: el servicio carga las filas
 * y esta función valida/suma. La RPC completar_ticket_pesaje_unido repite las
 * mismas reglas dentro de la transacción (con bloqueo de filas).
 */

/** Máximo razonable de tickets secundarios por unión. */
export const MAX_TICKETS_UNIDOS = 10;

/** Campos mínimos de tickets_pesaje que se necesitan para validar la unión. */
export interface TicketUnibleRow {
  id: string;
  tipo: 'compra' | 'venta';
  estado: 'bruto' | 'completo';
  entidad_id: string | null;
  peso_global: number | null;
  pesaje_exterior: boolean | null;
  facturado?: boolean | null;
  ticket_principal_id?: string | null;
}

/** Suma el peso global del principal con el de los secundarios (sin mutar). */
export function sumarPesosGlobales(
  principal: Pick<TicketUnibleRow, 'peso_global'>,
  secundarios: ReadonlyArray<Pick<TicketUnibleRow, 'peso_global'>>
): number {
  return secundarios.reduce((acc, t) => acc + Number(t.peso_global ?? 0), Number(principal.peso_global ?? 0));
}

function errorSecundario(principal: TicketUnibleRow, t: TicketUnibleRow): string | null {
  if (t.tipo !== 'compra') return 'Solo se pueden unir tickets de compra.';
  if (t.estado !== 'bruto') return 'Solo se pueden unir pesajes globales por recepcionar (sin completar).';
  if (t.entidad_id !== principal.entidad_id) return 'Todos los tickets unidos deben ser del mismo proveedor.';
  if (t.pesaje_exterior) return 'Un ticket con pesaje exterior no tiene peso global y no se puede unir.';
  if (t.ticket_principal_id) return 'Alguno de los tickets ya está unido a otro.';
  return null;
}

/**
 * Valida que `secundarios` se puedan unir a `principal`. Devuelve el mensaje
 * de error o null si todo es válido. `ids` son los solicitados (para detectar
 * tickets inexistentes, repetidos o el propio principal).
 */
export function validarUnionTickets(
  principal: TicketUnibleRow,
  secundarios: ReadonlyArray<TicketUnibleRow>,
  ids: ReadonlyArray<string>
): string | null {
  if (ids.length === 0) return null;
  if (ids.length > MAX_TICKETS_UNIDOS) return `No se pueden unir más de ${MAX_TICKETS_UNIDOS} tickets.`;
  if (new Set(ids).size !== ids.length) return 'Hay tickets repetidos en la unión.';
  if (ids.includes(principal.id)) return 'El ticket principal no puede unirse a sí mismo.';
  if (secundarios.length !== ids.length) return 'Alguno de los tickets a unir no existe.';
  if (principal.tipo !== 'compra') return 'Solo se pueden unir tickets de compra.';
  if (principal.pesaje_exterior) return 'Un ticket con pesaje exterior no admite unir otros tickets.';

  for (const t of secundarios) {
    const error = errorSecundario(principal, t);
    if (error) return error;
  }
  return null;
}
