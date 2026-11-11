/** Privacidad de Registros (lógica pura). Se prueba en backend/tests/wallet-registros-patas.test.ts y
 *  backend/tests/wallet-registros-correcciones.test.ts.
 *  Decisión: el ojo tachado de una cuenta oculta el monto de SUS filas (la pata/cuenta pertinente de cada fila). Los
 *  agregados (∑) se enmascaran con "ocultar cantidades" o cuando hay filtro de cuentas y TODAS las elegidas están ocultas:
 *  si no, el ∑ de una sola cuenta oculta se podría leer filtrándola. Los importes escritos dentro de la descripción se
 *  enmascaran igual que el monto de la fila. */

import type { Movimiento } from '@shared/types/index.js';
import { MONTO_OCULTO } from '../wallet-grupos';
import type { PrefsLectura } from '../wallet-prefs';
import type { FilaVirtual } from './registros-patas';

/** ¿La cuenta de esta fila está marcada como oculta? */
export function filaConCuentaOculta(fila: Pick<FilaVirtual, 'bancaId'>, cuentasOcultas: ReadonlySet<string>): boolean {
  return cuentasOcultas.has(fila.bancaId);
}

/** El texto del monto, o el enmascarado si se ocultan todas las cantidades o la cuenta de la fila está oculta. */
export function enmascararSiOculto(texto: string, ocultarCantidades: boolean, cuentaOculta: boolean): string {
  return ocultarCantidades || cuentaOculta ? MONTO_OCULTO : texto;
}

/** ¿Hay filtro de cuentas y todas las elegidas están ocultas? Entonces el ∑ revelaría lo que el ojo tachado esconde. */
export function sumaOculta(cuentasElegidas: readonly string[], cuentasOcultas: ReadonlySet<string>): boolean {
  return cuentasElegidas.length > 0 && cuentasElegidas.every(id => cuentasOcultas.has(id));
}

const NUMERO = String.raw`\d[\d.,]*\d|\d`;
const CODIGO_MONEDA = String.raw`(?:USD|VEF|VES|Bs)(?![\p{L}\d])`;
const ANTES = String.raw`(?:US\$|\$|(?<![\p{L}\d])(?:USD|VEF|VES|Bs)(?![\p{L}\d])\.?)\s*(?:${NUMERO})`;
const DESPUES = String.raw`(?<![\d.,])(?:${NUMERO})\s*(?:\$|(?<![\p{L}])${CODIGO_MONEDA})`;
const PATRON_IMPORTE = new RegExp(`${ANTES}|${DESPUES}`, 'giu');

/** Reemplaza los importes con símbolo o moneda ($, US$, USD, Bs, Bs., VEF, VES; delante o detrás) por el texto enmascarado.
 *  Números sueltos (facturas "C-0068", "#35", fechas) no se tocan. */
export function enmascararImportesEnTexto(texto: string): string {
  return texto.replace(PATRON_IMPORTE, MONTO_OCULTO);
}

/** Texto libre (descripción, nota) con sus importes enmascarados cuando corresponde. */
export function textoLibreSegunPrivacidad(texto: string, ocultar: boolean): string {
  return ocultar ? enmascararImportesEnTexto(texto) : texto;
}

/** ¿Se enmascaran los montos de este movimiento? Con ocultar cantidades o si CUALQUIERA de sus cuentas (origen o destino) está oculta. */
export function movimientoConMontoOculto(
  prefs: PrefsLectura,
  m: Pick<Movimiento, 'bancaOrigenId' | 'bancaDestinoId'>,
): boolean {
  if (prefs.ocultarCantidades) return true;
  return prefs.cuentasOcultas.has(m.bancaOrigenId) || (m.bancaDestinoId != null && prefs.cuentasOcultas.has(m.bancaDestinoId));
}
