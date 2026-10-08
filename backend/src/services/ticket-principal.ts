import { supabaseAdmin } from '../config/supabase.js';

/**
 * Lectura tolerante de tickets_pesaje.ticket_principal_id. El código puede
 * desplegarse antes que la migración docs/migration_ticket_pesaje_unido.sql:
 * si la columna no existe (o la consulta falla) se trata como "ningún ticket
 * unido" y no se excluye ni bloquea nada.
 */

/** true si el error de PostgREST/Postgres indica una columna inexistente. */
export function esErrorColumnaInexistente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  return /ticket_principal_id/.test(error.message ?? '') && /(does not exist|could not find|column)/i.test(error.message ?? '');
}

/** Ids, entre `ids`, que son tickets unidos (secundarios). [] si no se puede leer la columna. */
export async function idsTicketsUnidos(ids: ReadonlyArray<string>): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('tickets_pesaje')
      .select('id, ticket_principal_id')
      .in('id', [...ids]);
    if (error || !data) return [];
    return (data as Array<{ id: string; ticket_principal_id: string | null }>)
      .filter(t => !!t.ticket_principal_id)
      .map(t => t.id);
  } catch {
    return [];
  }
}

/** true si la fila (leída con '*') está unida a otro ticket; false si la columna no existe. */
export function esTicketUnido(row: { ticket_principal_id?: string | null }): boolean {
  return !!row.ticket_principal_id;
}

/** true si el ticket `id` está unido a otro (secundario). false si no o si no se puede leer la columna. */
export async function esSecundarioUnido(id: string): Promise<boolean> {
  return (await idsTicketsUnidos([id])).length > 0;
}

/** Cantidad de tickets unidos a `id` como principal. 0 si no hay o si no se puede leer la columna. */
export async function contarSecundarios(id: string): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin
      .from('tickets_pesaje')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_principal_id', id);
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

/** true si la RPC no existe en la BD (PGRST202 de PostgREST o 42883 de Postgres). */
export function esErrorFuncionInexistente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function/i.test(error.message ?? '');
}

export const MENSAJE_UNION_NO_HABILITADA = 'La unión de tickets aún no está habilitada en la base de datos.';
export const MENSAJE_TICKET_UNIDO_EDITAR = 'Este ticket está unido a otro ticket principal y no se puede editar. Edita el ticket principal o contacta al administrador para desvincularlo.';
export const MENSAJE_TICKET_UNIDO_BORRAR = 'Este ticket está unido a otro ticket y no se puede eliminar. Contacta al administrador para desvincularlo.';
export const MENSAJE_PRINCIPAL_CON_UNIDOS_BORRAR = 'Este ticket tiene otros tickets unidos y no se puede eliminar. Contacta al administrador para desvincularlos primero.';
export const MENSAJE_TICKET_UNIDO_COMPLETAR = 'Este ticket ya está unido a otro y no se puede completar por separado.';
