import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente, esTablaInexistente } from '../utils/migracion-pendiente.js';
import { logger } from '../utils/logger.js';
import { estadoUsuario } from '../utils/usuario-activo.js';
import { veTodasLasBancas, type BancasPermitidas } from '../utils/banca-acceso.js';

/**
 * Bancas a las que puede acceder un usuario (tabla usuarios_bancas).
 * null = todas (admin/superadmin, o la tabla usuarios_bancas aún no existe); Set = solo esas.
 * Cualquier otro error de BD falla cerrado (ninguna banca).
 *
 * TEMPORAL: el bypass por tabla inexistente solo existe para no bloquear la app entre el deploy y
 * la migración. Se quita (junto con la rama esTablaInexistente de aquí) cuando se aplique
 * docs/migration_usuarios_bancas.sql. Cada vez que se abre por esa causa se registra un warn.
 */
export async function bancasPermitidas(userId: string, rol: string): Promise<BancasPermitidas> {
  if (veTodasLasBancas(rol)) return null;
  const { data, error } = await supabaseAdmin.from('usuarios_bancas').select('banca_id').eq('usuario_id', userId);
  if (error) {
    if (esTablaInexistente(error, 'usuarios_bancas')) {
      logger.warn({ evento: 'banca_acceso_sin_migracion', userId, mensaje: 'usuarios_bancas no existe: sin filtro por banca hasta aplicar la migración' });
      return null;
    }
    logger.error({ evento: 'banca_acceso_lectura_fallida', userId, mensaje: error.message });
    return new Set();
  }
  return new Set(((data ?? []) as Array<{ banca_id: string }>).map(f => f.banca_id));
}

/** Igual que bancasPermitidas, resolviendo el rol vigente del usuario (caché de 30 s). Para herramientas sin `req`. */
export async function bancasPermitidasDeUsuario(userId: string): Promise<BancasPermitidas> {
  try {
    const { rol } = await estadoUsuario(userId);
    return bancasPermitidas(userId, rol ?? 'trabajador');
  } catch {
    return new Set();
  }
}

/** Ids de las bancas asignadas explícitamente a un usuario (para la pantalla de permisos). */
export async function listarBancasDeUsuario(userId: string): Promise<string[] | { error: string }> {
  const { data, error } = await supabaseAdmin.from('usuarios_bancas').select('banca_id').eq('usuario_id', userId);
  if (error) {
    if (esTablaInexistente(error, 'usuarios_bancas')) return { error: MENSAJE_RPC_BANCAS_PENDIENTE };
    logger.error({ evento: 'usuario_bancas_lectura_fallida', userId, mensaje: error.message });
    return { error: MENSAJE_ERROR_BANCAS };
  }
  return ((data ?? []) as Array<{ banca_id: string }>).map(f => f.banca_id);
}

export const MENSAJE_RPC_BANCAS_PENDIENTE =
  'El acceso por cuenta aún no está habilitado en la base de datos (falta aplicar migration_usuarios_bancas.sql).';
export const MENSAJE_ERROR_BANCAS = 'No se pudieron guardar o leer las cuentas del usuario. Inténtalo de nuevo.';

/**
 * Reemplaza las bancas de un usuario de forma atómica: la RPC borra e inserta en una sola transacción
 * y descarta ids de bancas inexistentes. Si la función no existe devuelve un mensaje de migración pendiente.
 */
export async function reemplazarBancasDeUsuario(
  userId: string,
  bancaIds: readonly string[]
): Promise<{ ok: true } | { error: string; pendiente?: boolean }> {
  const { error } = await supabaseAdmin.rpc('reemplazar_bancas_usuario', {
    p_usuario_id: userId,
    p_banca_ids: [...new Set(bancaIds)],
  });
  if (!error) return { ok: true };
  if (esObjetoInexistente(error)) return { error: MENSAJE_RPC_BANCAS_PENDIENTE, pendiente: true };
  logger.error({ evento: 'usuario_bancas_reemplazo_fallido', userId, mensaje: error.message });
  return { error: MENSAJE_ERROR_BANCAS };
}

type FilaBancas = { banca_origen_id: string | null; banca_destino_id: string | null };

function idsDeFilas(filas: FilaBancas[] | null): string[] {
  return [...new Set((filas ?? []).flatMap(f => [f.banca_origen_id, f.banca_destino_id]).filter((x): x is string => !!x))];
}

/** La BD falló al resolver las bancas de un registro: quien llama debe fallar cerrado (no dejar pasar). */
export class ErrorConsultaBanca extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConsultaBanca';
  }
}

/** Bancas (origen y destino) que usa hoy un movimiento. [] si no existe (lo resuelve el 404). Lanza ErrorConsultaBanca si la BD falla. */
export async function idsBancasDeMovimiento(movimientoId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('movimientos').select('banca_origen_id, banca_destino_id').eq('id', movimientoId);
  if (error) throw new ErrorConsultaBanca(error.message);
  return idsDeFilas(data as FilaBancas[] | null);
}

/** Bancas de todas las filas de un pago/cobro (grupo; o el propio movimiento si es legacy sin grupo). Lanza ErrorConsultaBanca si la BD falla. */
export async function idsBancasDeGrupo(grupoId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .select('banca_origen_id, banca_destino_id')
    .or(`grupo_id.eq.${grupoId},id.eq.${grupoId}`);
  if (error) throw new ErrorConsultaBanca(error.message);
  return idsDeFilas(data as FilaBancas[] | null);
}

/** Da acceso a una banca recién creada a quien la creó (el superadmin no lo necesita; el resto sí). */
export async function concederBancaAUsuario(userId: string, bancaId: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabaseAdmin.from('usuarios_bancas').insert({ usuario_id: userId, banca_id: bancaId });
  if (error && !esTablaInexistente(error, 'usuarios_bancas')) return { error: error.message };
  return { ok: true };
}
