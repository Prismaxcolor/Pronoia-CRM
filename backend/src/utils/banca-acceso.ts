/**
 * Acceso por usuario a cuentas/cajas (bancas). Reglas puras, sin BD.
 *
 *  - solo superadmin ve todas las bancas y administra los accesos.
 *  - el resto (incluida administracion) solo las que tiene asignadas en usuarios_bancas; sin filas = ninguna.
 *
 * `BancasPermitidas` es `null` cuando no hay restricción (todas) o el conjunto de ids permitidos.
 */

export type BancasPermitidas = ReadonlySet<string> | null;

const ROLES_CON_TODAS_LAS_BANCAS: ReadonlySet<string> = new Set(['superadmin']);

export const MENSAJE_SIN_ACCESO_BANCA = 'No tienes acceso a esa cuenta/caja.';

export const MENSAJE_SOLO_ADMIN_TELEGRAM = 'Solo un superadmin puede cambiar el grupo de Telegram de una cuenta.';

/** El grupo de Telegram de una cuenta recibe avisos con saldos: solo quien ve todas las cuentas lo cambia. */
export function puedeCambiarTelegramBanca(rol: string): boolean {
  return veTodasLasBancas(rol);
}

export function veTodasLasBancas(rol: string): boolean {
  return ROLES_CON_TODAS_LAS_BANCAS.has(rol);
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

interface DetalleConBancas {
  movimiento: { bancaOrigenId: string; bancaDestinoId: string | null };
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
