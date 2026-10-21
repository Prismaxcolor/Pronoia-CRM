import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { puedeCambiarReportesTelegram } from '../utils/banca-acceso.js';
import { cuentasDeBody } from './grupo-dinero.js';
import type { ContextoEvento, EventoCatalogo } from './grupo-eventos.js';

/**
 * Interruptor "avisos de movimientos a Telegram" (columna telegram_reportes_activos de bancas,
 * proveedores y clientes). Con false no se avisa:
 *  - nada de lo que pase en esa cuenta/caja (grupo de cajas o chat propio de la banca);
 *  - de un proveedor/cliente: pagos, cobros, adelantos, anticipos, cruces, notas y movimientos de banca
 *    que lo nombren (las facturas y los envíos manuales NO se silencian).
 *
 * FAIL-OPEN: si la columna aún no existe (migración sin aplicar) o la consulta falla, se avisa como
 * siempre y se registra. Nunca lanza.
 */

export type TablaReportes = 'bancas' | 'proveedores' | 'clientes';

export const MENSAJE_REPORTES_TELEGRAM_PENDIENTE =
  'Los avisos de Telegram por cuenta, cliente o proveedor aún no están habilitados en la base de datos (falta aplicar migration_telegram_reportes_activos.sql). Guarda sin ese cambio o aplica la migración.';

/** Eventos de dinero que se silencian cuando el proveedor/cliente que nombran tiene los avisos apagados. */
const CLAVES_SILENCIABLES_POR_TERCERO: ReadonlySet<string> = new Set([
  'pago.registrado', 'pago.multiple', 'pago.editado', 'pago.anulado',
  'cobro.multiple', 'cobro.editado', 'cobro.anulado',
  'banca.movimiento', 'movimiento.editado', 'movimiento.anulado',
  'proveedor.nota_creada', 'nota.anulada_proveedor',
  'cliente.nota_creada', 'nota.anulada_cliente',
]);

/** Eventos cuyo body no trae las cuentas: se leen de los movimientos del documento (por id o por grupo). */
const LECTURA_POR_ID = new Set(['banca.transferencia_mesa_completada', 'movimiento.editado', 'movimiento.anulado']);
const LECTURA_POR_GRUPO = new Set(['pago.editado', 'pago.anulado', 'cobro.editado', 'cobro.anulado']);

interface Tercero { tabla: 'proveedores' | 'clientes'; id: string }
interface Referencias { bancas: string[]; terceros: Tercero[] }
interface FilaMovimiento {
  banca_origen_id: string | null; banca_destino_id: string | null;
  proveedor_id: string | null; cliente_id: string | null;
}

function registrarFallo(evento: string, tabla: string, error: { code?: string; message?: string }): void {
  // Columna inexistente = migración pendiente (esperado): aviso suave; cualquier otro error es un fallo real.
  const nivel = esObjetoInexistente(error) ? 'warn' : 'error';
  logger[nivel]({ evento, tabla, codigo: error.code, mensaje: error.message });
}

/** Ids de la tabla con los avisos apagados. Vacío si la columna falta o la consulta falla (fail-open). */
async function idsSilenciados(tabla: TablaReportes, ids: readonly string[]): Promise<Set<string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Set();
  try {
    const { data, error } = await supabaseAdmin.from(tabla).select('id, telegram_reportes_activos').in('id', unicos);
    if (error) {
      registrarFallo('reportes_telegram_lectura_fallida', tabla, error);
      return new Set();
    }
    const filas = (data ?? []) as Array<{ id: string; telegram_reportes_activos?: boolean | null }>;
    return new Set(filas.filter(f => f.telegram_reportes_activos === false).map(f => f.id));
  } catch (e) {
    logger.error({ evento: 'reportes_telegram_lectura_fallida', tabla, mensaje: e instanceof Error ? e.message : String(e) });
    return new Set();
  }
}

/** ¿Los avisos de esta banca/proveedor/cliente están activos? true si no se puede saber (fail-open). */
export async function reportesTelegramActivos(tabla: TablaReportes, id: string): Promise<boolean> {
  return !(await idsSilenciados(tabla, [id])).has(id);
}

/**
 * ¿Se intenta cambiar el interruptor sin ser superadmin? Reenviar el valor que ya tiene no es un cambio
 * (los formularios mandan todos los campos). Sin valor nuevo => false.
 */
export async function cambioReportesNoPermitido(
  tabla: TablaReportes, id: string, rol: string, nuevo: boolean | undefined
): Promise<boolean> {
  if (nuevo === undefined || puedeCambiarReportesTelegram(rol)) return false;
  return nuevo !== await reportesTelegramActivos(tabla, id);
}

/** Movimientos del documento (por id o por grupo) con sus cuentas y tercero. [] si falla (fail-open). */
async function leerMovimientos(columna: 'id' | 'grupo_id', valor: string): Promise<FilaMovimiento[]> {
  if (!valor) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('movimientos')
      .select('banca_origen_id, banca_destino_id, proveedor_id, cliente_id')
      .eq(columna, valor);
    if (error) {
      registrarFallo('reportes_telegram_movimientos_fallida', 'movimientos', error);
      return [];
    }
    return (data ?? []) as FilaMovimiento[];
  } catch (e) {
    logger.error({ evento: 'reportes_telegram_movimientos_fallida', mensaje: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

const sinNulos = (v: ReadonlyArray<string | null | undefined>): string[] => v.filter((x): x is string => Boolean(x));

function deMovimientos(filas: readonly FilaMovimiento[]): Referencias {
  return {
    bancas: sinNulos(filas.flatMap(f => [f.banca_origen_id, f.banca_destino_id])),
    terceros: [
      ...sinNulos(filas.map(f => f.proveedor_id)).map((id): Tercero => ({ tabla: 'proveedores', id })),
      ...sinNulos(filas.map(f => f.cliente_id)).map((id): Tercero => ({ tabla: 'clientes', id })),
    ],
  };
}

/** Cuentas y terceros a los que toca el evento: los del body/contexto y, si hace falta, los del documento en BD. */
async function referenciasDelEvento(evento: EventoCatalogo, ctx: ContextoEvento): Promise<Referencias> {
  const contexto = evento.contexto?.(ctx) ?? null;
  const delBody: Referencias = {
    bancas: cuentasDeBody(ctx.reqBody).map(c => c.id),
    terceros: contexto ? [{ tabla: contexto.tabla, id: contexto.id }] : [],
  };
  const filas = LECTURA_POR_ID.has(evento.clave)
    ? await leerMovimientos('id', ctx.params.id ?? '')
    : LECTURA_POR_GRUPO.has(evento.clave) ? await leerMovimientos('grupo_id', ctx.params.grupoId ?? '') : [];
  const deBd = deMovimientos(filas);
  return { bancas: [...delBody.bancas, ...deBd.bancas], terceros: [...delBody.terceros, ...deBd.terceros] };
}

/**
 * ¿Hay que callar este aviso de dinero del grupo de cajas? Sí si alguna cuenta que interviene tiene los
 * avisos apagados o, en eventos de pagos/cobros/notas/movimientos, si el proveedor/cliente que nombra los tiene.
 */
export async function avisoCajasSilenciado(evento: EventoCatalogo, ctx: ContextoEvento): Promise<boolean> {
  try {
    const refs = await referenciasDelEvento(evento, ctx);
    const terceros = CLAVES_SILENCIABLES_POR_TERCERO.has(evento.clave) ? refs.terceros : [];
    const [bancas, proveedores, clientes] = await Promise.all([
      idsSilenciados('bancas', refs.bancas),
      idsSilenciados('proveedores', terceros.filter(t => t.tabla === 'proveedores').map(t => t.id)),
      idsSilenciados('clientes', terceros.filter(t => t.tabla === 'clientes').map(t => t.id)),
    ]);
    return bancas.size > 0 || proveedores.size > 0 || clientes.size > 0;
  } catch (e) {
    logger.error({ evento: 'reportes_telegram_silencio_fallido', clave: evento.clave, mensaje: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

type ErrorEscritura = { code?: string; message: string } | null;

/**
 * Ejecuta un UPDATE de proveedor/cliente que incluye telegram_reportes_activos. Si la columna no existe:
 * con true se reintenta sin ella (es el valor por defecto) y con false se avisa (pendiente), no se descarta
 * en silencio. Los demás errores se devuelven tal cual.
 */
export async function escribirConReportes<R extends { error: ErrorEscritura }>(
  update: Record<string, unknown>,
  ejecutar: (u: Record<string, unknown>) => PromiseLike<R>
): Promise<R | { pendiente: true; mensaje: string }> {
  const resp = await ejecutar(update);
  if (!resp.error || !esObjetoInexistente(resp.error) || !('telegram_reportes_activos' in update)) return resp;
  if (update.telegram_reportes_activos === false) return { pendiente: true, mensaje: MENSAJE_REPORTES_TELEGRAM_PENDIENTE };
  const resto = Object.fromEntries(Object.entries(update).filter(([k]) => k !== 'telegram_reportes_activos'));
  return Object.keys(resto).length > 0 ? ejecutar(resto) : resp;
}
