/** Lógica pura de la pestaña Informes: variaciones acotadas para mostrar, signo de los gastos y categorías sin movimiento.
 *  No cambia ningún cálculo de ingresos/gastos/flujo. Se prueba en backend/tests/wallet-estadisticas-informes.test.ts. */

import type { CategoriaWallet } from '@shared/types/index.js';
import { formatearDelta } from '../../../lib/formato';
import { COLOR_SIN_CATEGORIA, conVariacion, redondear2, type FilaCategoria } from './estadisticas-logica';

/** Por encima de este valor absoluto una variación se muestra como "> +1000 %" (el cálculo no cambia, solo lo que se ve). */
export const TOPE_VARIACION_PCT = 1000;

export interface TextoVariacion {
  texto: string;
  /** true si el valor real superó el tope y se muestra acotado. */
  acotada: boolean;
}

export function textoVariacion(pct: number, decimales = 1): TextoVariacion {
  if (pct > TOPE_VARIACION_PCT) return { texto: `> +${TOPE_VARIACION_PCT} %`, acotada: true };
  if (pct < -TOPE_VARIACION_PCT) return { texto: `< -${TOPE_VARIACION_PCT} %`, acotada: true };
  return { texto: `${formatearDelta(pct, decimales)} %`, acotada: false };
}

/** Los gastos se muestran con signo menos; el cero no lleva signo. */
export const montoConSigno = (usd: number, tipo: 'ingreso' | 'egreso'): number => (tipo === 'egreso' && usd !== 0 ? -Math.abs(usd) : usd);

/** Ingresos − gastos, redondeado a centavos. */
export const flujoDeEfectivo = (ingresos: number, egresos: number): number => redondear2(ingresos - egresos);

/** Categorías (de primer nivel, activas y del tipo pedido) que no tuvieron movimiento en `conMovimiento`, como filas en cero.
 *  Con `anteriores` se les calcula la variación (p. ej. -100 % si el período anterior sí tuvo movimiento). */
export function categoriasSinMovimiento(
  indice: ReadonlyMap<string, CategoriaWallet>,
  conMovimiento: readonly FilaCategoria[],
  tipo: 'ingreso' | 'egreso',
  anteriores: readonly FilaCategoria[] | null,
): FilaCategoria[] {
  const usadas = new Set(conMovimiento.map(f => f.clave));
  const aceptado = tipo === 'ingreso' ? 'INGRESO' : 'EGRESO';
  const filas: FilaCategoria[] = [...indice.values()]
    .filter(c => c.padreId === null && c.activo && !usadas.has(c.id) && (c.tipo === 'AMBOS' || c.tipo === aceptado))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map(c => ({
      id: c.id, clave: c.id, nombre: c.nombre, color: c.color || COLOR_SIN_CATEGORIA, usd: 0, cantidad: 0, hijas: [], variacion: null,
      ...(c.imagenUrl ? { imagenUrl: c.imagenUrl } : {}),
    }));
  return conVariacion(filas, anteriores);
}
