import { supabaseAdmin } from '../config/supabase.js';
import { esColumnaInexistente, esObjetoInexistente, esTablaInexistente } from '../utils/migracion-pendiente.js';
import { logger } from '../utils/logger.js';
import { estadoUsuario } from '../utils/usuario-activo.js';
import { ACCESO_TOTAL, accesoDeFilas, veTodasLasBancas, type AccesoBancas, type BancasPermitidas } from '../utils/banca-acceso.js';

type FilaUsuarioBanca = { banca_id: string; puede_editar?: boolean | null };
type ResultadoFilas = { filas: FilaUsuarioBanca[]; columnaEditar: boolean } | { error: { code?: string; message: string } };

/**
 * Lee usuarios_bancas con puede_editar. Si la columna aún no existe (migration_usuarios_bancas_editar.sql
 * pendiente) reintenta sin ella y marca `columnaEditar: false` (ver = editar, comportamiento anterior).
 */
async function leerFilasDeUsuario(userId: string): Promise<ResultadoFilas> {
  const completa = await supabaseAdmin.from('usuarios_bancas').select('banca_id, puede_editar').eq('usuario_id', userId);
  if (!completa.error) return { filas: (completa.data ?? []) as FilaUsuarioBanca[], columnaEditar: true };
  if (!esColumnaInexistente(completa.error, 'puede_editar')) return { error: completa.error };
  const basica = await supabaseAdmin.from('usuarios_bancas').select('banca_id').eq('usuario_id', userId);
  if (basica.error) return { error: basica.error };
  return { filas: (basica.data ?? []) as FilaUsuarioBanca[], columnaEditar: false };
}

/**
 * Qué bancas puede ver y cuáles editar un usuario (tabla usuarios_bancas, una sola consulta).
 * null = todas (superadmin, o la tabla usuarios_bancas aún no existe); Set = solo esas.
 * Cualquier otro error de BD falla cerrado (ninguna banca).
 *
 * TEMPORAL: el bypass por tabla inexistente solo existe para no bloquear la app entre el deploy y
 * la migración. Se quita (junto con la rama esTablaInexistente de aquí) cuando se aplique
 * docs/migration_usuarios_bancas.sql. Cada vez que se abre por esa causa se registra un warn.
 *
 * TODO(M6): quitar la rama `esTablaInexistente` (devuelve ACCESO_TOTAL) en cuanto migration_usuarios_bancas.sql
 * esté aplicada en TODOS los entornos (staging y producción), es decir, cuando ese warn deje de aparecer en los
 * logs. Hasta entonces, un entorno sin la tabla deja pasar a cualquier usuario por todas las cuentas (falla abierto).
 * Se deja tal cual a propósito; no cambia el comportamiento.
 */
export async function accesoBancas(userId: string, rol: string): Promise<AccesoBancas> {
  if (veTodasLasBancas(rol)) return ACCESO_TOTAL;
  const r = await leerFilasDeUsuario(userId);
  if ('error' in r) {
    if (esTablaInexistente(r.error, 'usuarios_bancas')) {
      logger.warn({ evento: 'banca_acceso_sin_migracion', userId, mensaje: 'usuarios_bancas no existe: sin filtro por banca hasta aplicar la migración' });
      return ACCESO_TOTAL;
    }
    logger.error({ evento: 'banca_acceso_lectura_fallida', userId, mensaje: r.error.message });
    return accesoDeFilas([]);
  }
  return accesoDeFilas(r.filas, r.columnaEditar);
}

/** Bancas que el usuario puede VER (null = todas). Para escribir, usar accesoBancas().editar. */
export async function bancasPermitidas(userId: string, rol: string): Promise<BancasPermitidas> {
  return (await accesoBancas(userId, rol)).ver;
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

/** Bancas asignadas explícitamente a un usuario: las que ve y, de ellas, las que además edita (pantalla de permisos). */
export async function listarBancasDeUsuario(userId: string): Promise<{ bancaIds: string[]; bancaIdsEditar: string[] } | { error: string }> {
  const r = await leerFilasDeUsuario(userId);
  if ('error' in r) {
    if (esTablaInexistente(r.error, 'usuarios_bancas')) return { error: MENSAJE_RPC_BANCAS_PENDIENTE };
    logger.error({ evento: 'usuario_bancas_lectura_fallida', userId, mensaje: r.error.message });
    return { error: MENSAJE_ERROR_BANCAS };
  }
  const editables = r.columnaEditar ? r.filas.filter(f => f.puede_editar === true) : r.filas;
  return { bancaIds: r.filas.map(f => f.banca_id), bancaIdsEditar: editables.map(f => f.banca_id) };
}

export const MENSAJE_RPC_BANCAS_PENDIENTE =
  'El acceso por cuenta aún no está habilitado en la base de datos (falta aplicar migration_usuarios_bancas.sql).';
export const MENSAJE_ERROR_BANCAS = 'No se pudieron guardar o leer las cuentas del usuario. Inténtalo de nuevo.';

export const MENSAJE_RPC_ACCESOS_PENDIENTE =
  'El acceso de solo consulta aún no está habilitado en la base de datos (falta aplicar migration_usuarios_bancas_editar.sql).';

/**
 * Reemplaza las bancas de un usuario de forma atómica (una sola RPC = una transacción). `bancaIdsEditar`
 * (subconjunto de `bancaIds`; si se omite, todas) marca en cuáles puede además registrar/modificar.
 * Si todas son editables se usa la función original (funciona antes y después de la migración nueva);
 * si hay alguna solo-consulta se exige la función nueva y, si falta, NO se guarda (nunca se otorga más de lo pedido).
 */
export async function reemplazarBancasDeUsuario(
  userId: string,
  bancaIds: readonly string[],
  bancaIdsEditar?: readonly string[]
): Promise<{ ok: true } | { error: string; pendiente?: boolean }> {
  const ver = [...new Set(bancaIds)];
  const editar = bancaIdsEditar === undefined ? ver : ver.filter(id => bancaIdsEditar.includes(id));
  const todasEditables = editar.length === ver.length;
  const { error } = todasEditables
    ? await supabaseAdmin.rpc('reemplazar_bancas_usuario', { p_usuario_id: userId, p_banca_ids: ver })
    : await supabaseAdmin.rpc('reemplazar_accesos_bancas_usuario', { p_usuario_id: userId, p_banca_ids: ver, p_banca_ids_editar: editar });
  if (!error) return { ok: true };
  if (esObjetoInexistente(error)) return { error: todasEditables ? MENSAJE_RPC_BANCAS_PENDIENTE : MENSAJE_RPC_ACCESOS_PENDIENTE, pendiente: true };
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
