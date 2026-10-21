/**
 * Acceso por usuario a cuentas/cajas (bancas). Reglas puras, sin BD.
 *
 *  - solo superadmin ve todas las bancas y administra los accesos.
 *  - el resto (incluida administracion) solo las que tiene asignadas en usuarios_bancas; sin filas = ninguna.
 *
 * `BancasPermitidas` es `null` cuando no hay restricción (todas) o el conjunto de ids permitidos.
 *
 * Ver y editar van separados: una fila en usuarios_bancas da acceso de consulta; `puede_editar` además
 * permite registrar/modificar/anular movimientos, pagos y cobros que usen esa cuenta. Editar implica ver.
 */

export type BancasPermitidas = ReadonlySet<string> | null;

const ROLES_CON_TODAS_LAS_BANCAS: ReadonlySet<string> = new Set(['superadmin']);

export const MENSAJE_SIN_ACCESO_BANCA = 'No tienes acceso a esa cuenta/caja.';

export const MENSAJE_SOLO_CONSULTA_BANCA =
  'Tienes acceso de solo consulta a esa cuenta/caja: no puedes registrar ni modificar movimientos, pagos o cobros en ella.';

export const MENSAJE_SOLO_ADMIN_TELEGRAM = 'Solo un superadmin puede cambiar el grupo de Telegram de una cuenta.';

/** El grupo de Telegram de una cuenta recibe avisos con saldos: solo quien ve todas las cuentas lo cambia. */
export function puedeCambiarTelegramBanca(rol: string): boolean {
  return veTodasLasBancas(rol);
}

export const MENSAJE_SOLO_ADMIN_REPORTES_TELEGRAM =
  'Solo un superadmin puede activar o desactivar los avisos de Telegram de los movimientos.';

/** Apagar/encender los avisos de Telegram (por cuenta, cliente o proveedor) lo decide solo el superadmin. */
export function puedeCambiarReportesTelegram(rol: string): boolean {
  return veTodasLasBancas(rol);
}

export function veTodasLasBancas(rol: string): boolean {
  return ROLES_CON_TODAS_LAS_BANCAS.has(rol);
}

/** Qué cuentas puede ver y cuáles además puede editar (editar siempre es subconjunto de ver). */
export interface AccesoBancas {
  ver: BancasPermitidas;
  editar: BancasPermitidas;
}

export const ACCESO_TOTAL: AccesoBancas = { ver: null, editar: null };

interface FilaAcceso {
  banca_id: string;
  puede_editar?: boolean | null;
}

/**
 * Construye el acceso desde las filas de usuarios_bancas. Falla cerrado: solo `puede_editar === true` edita.
 * `columnaEditarDisponible=false` (migración pendiente) conserva el comportamiento anterior: ver = editar.
 */
export function accesoDeFilas(filas: readonly FilaAcceso[], columnaEditarDisponible = true): AccesoBancas {
  const ver = new Set(filas.map(f => f.banca_id));
  const editar = columnaEditarDisponible ? new Set(filas.filter(f => f.puede_editar === true).map(f => f.banca_id)) : new Set(ver);
  return { ver, editar };
}

/**
 * Mensaje de rechazo si alguna de las cuentas no se puede escribir (sin acceso o solo consulta); null si todas se pueden.
 * Sin acceso tiene prioridad sobre solo consulta.
 */
export function mensajeDeEscritura(acceso: AccesoBancas, ids: Iterable<string | null | undefined>): string | null {
  const pedidas = [...ids];
  if (bancasNoPermitidas(acceso.ver, pedidas).length > 0) return MENSAJE_SIN_ACCESO_BANCA;
  if (bancasNoPermitidas(acceso.editar, pedidas).length > 0) return MENSAJE_SOLO_CONSULTA_BANCA;
  return null;
}

/** Agrega `puedeEditar` a cada cuenta (para que la UI solo ofrezca las editables en los selectores de registro). */
export function anotarPuedeEditar<T extends { id: string }>(items: readonly T[], editar: BancasPermitidas): Array<T & { puedeEditar: boolean }> {
  return items.map(b => ({ ...b, puedeEditar: bancaPermitida(editar, b.id) }));
}

/** Texto que reemplaza nombre, referencia y comprobante de una cuenta a la que el usuario no tiene acceso. */
export const TEXTO_CUENTA_RESTRINGIDA = 'Cuenta restringida';

export function bancaPermitida(permitidas: BancasPermitidas, bancaId: string): boolean {
  return permitidas === null || permitidas.has(bancaId);
}

/** Ids (sin vacíos ni repetidos) a los que NO se tiene acceso. */
export function bancasNoPermitidas(
  permitidas: BancasPermitidas,
  ids: Iterable<string | null | undefined>
): string[] {
  if (permitidas === null) return [];
  const pedidas = new Set([...ids].filter((id): id is string => typeof id === 'string' && id !== ''));
  return [...pedidas].filter(id => !permitidas.has(id));
}

/**
 * Una fila de dinero es visible en sus datos de cuenta (nombre, referencia, comprobantes) si no tiene
 * banca o se tiene acceso a ella. Las filas NO se filtran en estados de cuenta (falsearía saldos):
 * solo se enmascaran estos datos.
 */
export function cuentaVisible(permitidas: BancasPermitidas, bancaId: string | null | undefined): boolean {
  return !bancaId || bancaPermitida(permitidas, bancaId);
}

/** Datos de un movimiento que pueden revelar la cuenta contraria de una transferencia. */
interface MovimientoEnmascarable {
  bancaOrigenId: string;
  bancaDestinoId: string | null;
  referencia?: string;
  descripcion?: string;
  comprobantes?: string[];
}

/** True si es una transferencia (tiene destino) y el usuario NO tiene acceso a alguno de sus dos extremos. */
export function tieneExtremoOculto(permitidas: BancasPermitidas, m: Pick<MovimientoEnmascarable, 'bancaOrigenId' | 'bancaDestinoId'>): boolean {
  return m.bancaDestinoId !== null && !(cuentaVisible(permitidas, m.bancaOrigenId) && cuentaVisible(permitidas, m.bancaDestinoId));
}

/**
 * Quien ve un extremo de una transferencia pero no el otro NO debe ver la referencia, los comprobantes ni la
 * descripción: pueden nombrar o mostrar la cuenta contraria. Los montos propios no se tocan. No muta el original.
 */
export function enmascararMovimientoPorBanca<T extends MovimientoEnmascarable>(m: T, permitidas: BancasPermitidas): T {
  if (permitidas === null || !tieneExtremoOculto(permitidas, m)) return m;
  return {
    ...m,
    ...(m.referencia === undefined ? {} : { referencia: TEXTO_CUENTA_RESTRINGIDA }),
    ...(m.descripcion === undefined ? {} : { descripcion: TEXTO_CUENTA_RESTRINGIDA }),
    ...(m.comprobantes === undefined ? {} : { comprobantes: [] }),
  };
}

export function enmascararMovimientosPorBanca<T extends MovimientoEnmascarable>(items: readonly T[], permitidas: BancasPermitidas): T[] {
  return items.map(m => enmascararMovimientoPorBanca(m, permitidas));
}

interface DetalleConBancas {
  movimiento: MovimientoEnmascarable;
  bancaOrigenNombre: string | null;
  bancaDestinoNombre: string | null;
}

/**
 * En el detalle de un movimiento, oculta el nombre de la banca (origen o destino) a la que el usuario
 * no tiene acceso: quien ve solo una punta de una transferencia no debe ver el nombre de la otra.
 */
export function enmascararDetalleMovimiento<T extends DetalleConBancas>(detalle: T, permitidas: BancasPermitidas): T {
  if (permitidas === null) return detalle;
  return {
    ...detalle,
    movimiento: enmascararMovimientoPorBanca(detalle.movimiento, permitidas),
    bancaOrigenNombre: cuentaVisible(permitidas, detalle.movimiento.bancaOrigenId) ? detalle.bancaOrigenNombre : TEXTO_CUENTA_RESTRINGIDA,
    bancaDestinoNombre: cuentaVisible(permitidas, detalle.movimiento.bancaDestinoId) ? detalle.bancaDestinoNombre : TEXTO_CUENTA_RESTRINGIDA,
  };
}

export function filtrarBancas<T extends { id: string }>(items: T[], permitidas: BancasPermitidas): T[] {
  return permitidas === null ? items : items.filter(b => permitidas.has(b.id));
}

/** Un movimiento es visible si se tiene acceso a su banca de origen o a la de destino. */
export function filtrarMovimientos<T extends { bancaOrigenId: string; bancaDestinoId: string | null }>(
  items: T[],
  permitidas: BancasPermitidas
): T[] {
  if (permitidas === null) return items;
  return items.filter(
    m => permitidas.has(m.bancaOrigenId) || (m.bancaDestinoId !== null && permitidas.has(m.bancaDestinoId))
  );
}

const esRegistro = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ids de banca que menciona el body de una operación de dinero: bancaId, bancaDestinoId y bancas[].bancaId. */
export function idsBancasDeBody(body: unknown): string[] {
  if (!esRegistro(body)) return [];
  const ids: unknown[] = [body.bancaId, body.bancaDestinoId];
  if (Array.isArray(body.bancas)) ids.push(...body.bancas.map(b => (esRegistro(b) ? b.bancaId : undefined)));
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
}
