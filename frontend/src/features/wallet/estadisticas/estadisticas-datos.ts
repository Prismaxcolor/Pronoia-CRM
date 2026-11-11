/** Datos de movimientos de Estadísticas: recorte de la copia guardada (el MISMO que usa Registros, porque comparten la
 *  clave de la caché) y texto del aviso cuando se muestran datos guardados. Lógica pura; se prueba en
 *  backend/tests/wallet-estadisticas-revision.test.ts. */

import type { Movimiento } from '@shared/types/index.js';
import { LIMITES_CACHE, recortarCampo, ultimasFilas } from '../../../lib/offline/lectura-logica';

export const MAX_MOVIMIENTOS_GUARDADOS = LIMITES_CACHE.maxMovimientos;

/** Lo que se guarda en la caché de `/api/cochinito/movimientos`: las últimas filas por fecha. Con red la pantalla sigue
 *  viendo la respuesta completa; esto solo afecta a la copia guardada. No muta lo recibido. */
export function recortarMovimientosGuardados<T extends { movimientos: Movimiento[] }>(datos: T): T {
  return recortarCampo(datos, 'movimientos', f => ultimasFilas(f as Movimiento[], MAX_MOVIMIENTOS_GUARDADOS, m => m.fecha));
}

const dosDigitos = (n: number): string => String(n).padStart(2, '0');

/** "11/11/2026 09:05" en hora local. */
function fechaHora(ms: number): string {
  const d = new Date(ms);
  return `${dosDigitos(d.getDate())}/${dosDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
}

/** Aviso de Flujo, Gastos e Informes cuando los datos vienen de la copia guardada (recortada). */
export function textoDatosGuardados(descargadoEn: number): string {
  return `Estás viendo datos guardados (del ${fechaHora(descargadoEn)}) y solo incluyen los últimos ${MAX_MOVIMIENTOS_GUARDADOS} movimientos; los totales pueden estar incompletos.`;
}
