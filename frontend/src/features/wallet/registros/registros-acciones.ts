/** Acciones de cada fila de Registros (lógica pura). Se prueba en backend/tests/wallet-registros-acciones.test.ts.
 *  Replica las reglas de la tabla de la Wallet clásica (TablaMovimientos + CochinitPage): editar/anular solo en movimientos
 *  manuales vigentes que no son cargo de comisión; cambiar categoría solo en ingresos/egresos con permiso de editar y
 *  categorías existentes; completar/cobrar solo transferencias de mesa en proceso o parciales con permiso de editar y de
 *  ver la mesa. Añade la regla por cuenta: sin autorización sobre la cuenta, editar y anular quedan desactivadas con motivo. */

import type { Movimiento } from '@shared/types/index.js';
import { esCargoDeComision, esComisionDeMesa, esManualVigente, esTransferenciaEnProceso } from '../../cochinito/detalle-movimiento';

export type ClaveAccion = 'detalle' | 'cobrar' | 'editar' | 'categoria' | 'anular';

export interface AccionFila {
  clave: ClaveAccion;
  etiqueta: string;
  desactivada: boolean;
  /** Por qué está desactivada (se dice en un toast al intentarla). */
  motivo: string | null;
  peligro?: boolean;
}

export interface ContextoAcciones {
  /** Permiso `cochinito.editar` del usuario. */
  puedeEditar: boolean;
  /** Permiso `mesa_cambio.ver` del usuario. */
  puedeVerMesa: boolean;
  /** Existe al menos una categoría para elegir. */
  hayCategorias: boolean;
  /** Cuentas sobre las que el usuario solo tiene consulta (Banca.puedeEditar === false). */
  cuentasNoEditables: ReadonlySet<string>;
  /** Cuentas que el usuario ve (el backend filtra por permiso). Si falta alguna punta del movimiento, editar y anular se
   *  desactivan. Omitido = no se comprueba. */
  cuentasVisibles?: ReadonlySet<string>;
}

export interface AccionesFila {
  acciones: AccionFila[];
  /** Texto de apoyo cuando no hay editar/anular (comisión, movimiento de un pago). null si no aplica. */
  nota: string | null;
}

export const MOTIVO_SIN_AUTORIZACION_EDITAR = 'No tienes autorización para EDITAR este Registro.';
export const MOTIVO_SIN_AUTORIZACION_ANULAR = 'No tienes autorización para ANULAR este Registro.';
export const MOTIVO_SIN_ACCESO_CUENTA = 'No tienes acceso a una de las cuentas';

const NOTA_COMISION_MESA = 'Es la comisión de una transferencia con mesa de cambio: se anula junto con ella.';
const NOTA_COMISION_BANCARIA = 'Es la comisión bancaria de otro movimiento: se anula junto con él.';
const NOTA_DESDE_PAGO = 'Pertenece a un pago o cobro: edítalo o anúlalo desde su comprobante en el estado de cuenta.';

const accion = (clave: ClaveAccion, etiqueta: string, extra: Partial<AccionFila> = {}): AccionFila =>
  ({ clave, etiqueta, desactivada: false, motivo: null, ...extra });

function extremos(m: Movimiento): string[] {
  return m.tipo === 'transferencia' && m.bancaDestinoId != null ? [m.bancaOrigenId, m.bancaDestinoId] : [m.bancaOrigenId];
}

/** ¿El usuario ve todas las cuentas del movimiento (origen y, si hay, destino)? */
function veTodasLasCuentas(m: Movimiento, visibles: ReadonlySet<string> | undefined): boolean {
  return visibles === undefined || extremos(m).every(id => visibles.has(id));
}

/** ¿El usuario tiene autorización de edición sobre las cuentas del movimiento? */
function cuentasAutorizadas(m: Movimiento, noEditables: ReadonlySet<string>): boolean {
  return !extremos(m).some(id => noEditables.has(id));
}

function accionesDeEdicion(m: Movimiento, ctx: ContextoAcciones): AccionFila[] {
  const sinAcceso = !veTodasLasCuentas(m, ctx.cuentasVisibles);
  const sinAutorizar = !cuentasAutorizadas(m, ctx.cuentasNoEditables);
  const bloqueo = (motivoAutorizacion: string): Partial<AccionFila> =>
    sinAcceso ? { desactivada: true, motivo: MOTIVO_SIN_ACCESO_CUENTA }
      : sinAutorizar ? { desactivada: true, motivo: motivoAutorizacion } : {};
  const lista: AccionFila[] = [accion('editar', 'Editar', bloqueo(MOTIVO_SIN_AUTORIZACION_EDITAR))];
  if (m.tipo !== 'transferencia' && ctx.puedeEditar && ctx.hayCategorias) lista.push(accion('categoria', 'Cambiar categoría'));
  lista.push(accion('anular', 'Anular', { peligro: true, ...bloqueo(MOTIVO_SIN_AUTORIZACION_ANULAR) }));
  return lista;
}

function notaSinEdicion(m: Movimiento): string | null {
  if (m.anulado) return null;
  if (esCargoDeComision(m)) return esComisionDeMesa(m) ? NOTA_COMISION_MESA : NOTA_COMISION_BANCARIA;
  return NOTA_DESDE_PAGO;
}

/** Acciones posibles del movimiento para este usuario, en el orden del menú. */
export function accionesPosibles(m: Movimiento, ctx: ContextoAcciones): AccionesFila {
  const acciones: AccionFila[] = [accion('detalle', 'Ver detalle')];
  if (esTransferenciaEnProceso(m) && ctx.puedeEditar && ctx.puedeVerMesa) {
    acciones.push(accion('cobrar', m.mesaEstado === 'parcial' ? 'Cobrar el resto' : 'Completar transferencia'));
  }
  const editable = !esCargoDeComision(m) && esManualVigente(m);
  if (editable) return { acciones: [...acciones, ...accionesDeEdicion(m, ctx)], nota: null };
  return { acciones, nota: notaSinEdicion(m) };
}
