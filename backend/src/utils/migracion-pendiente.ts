/**
 * El backend puede desplegarse antes que la migración de BD. Estos helpers
 * reconocen el error de "tabla, columna o función inexistente" para responder
 * vacío/409 con un mensaje claro en vez de un 500.
 */

interface ErrorBd {
  code?: string;
  message?: string;
}

const CODIGOS_OBJETO_INEXISTENTE = ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'];

/** True si el error indica una tabla, columna o función que aún no existe en la BD. */
export function esObjetoInexistente(error: ErrorBd | null | undefined): boolean {
  if (!error) return false;
  if (CODIGOS_OBJETO_INEXISTENTE.includes(error.code ?? '')) return true;
  return /(relation|column|function) .* does not exist|could not find the (table|function|column)/i.test(error.message ?? '');
}

export const MENSAJE_INVENTARIO_NO_HABILITADO =
  'Esta función aún no está habilitada en la base de datos (falta aplicar migration_inventario_rediseno_fase1.sql).';
