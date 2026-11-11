/** Enlaces de Estadísticas hacia otras pantallas de la Wallet nueva. Lógica pura; se prueba en backend/tests/wallet-estadisticas-enlaces.test.ts. */

import type { ClavePeriodo } from '../wallet-periodos';

export const RUTA_ESTADISTICAS = '/wallet/estadisticas';
const RUTA_REGISTROS = '/wallet/registros';

export interface FiltroRegistros {
  periodo: ClavePeriodo;
  /** Id de categoría o subcategoría. */
  cat?: string;
  /** Id de cuenta. */
  banca?: string;
  tipo?: 'ingreso' | 'egreso';
}

/** Ruta de Registros con el filtro y el período (`?cat=<id>&tipo=egreso&sinanulados=1&p=30D`). Siempre oculta los anulados:
 *  Estadísticas no los cuenta, así que "N registros" coincide con las filas. El orden es filtro, anulados y período. */
export function rutaRegistros(f: FiltroRegistros): string {
  const params = new URLSearchParams();
  if (f.cat) params.set('cat', f.cat);
  if (f.banca) params.set('banca', f.banca);
  if (f.tipo) params.set('tipo', f.tipo);
  params.set('sinanulados', '1');
  params.set('p', f.periodo);
  return `${RUTA_REGISTROS}?${params.toString()}`;
}

/** Estado de navegación hacia el detalle de un movimiento: la lista de ids (para anterior/siguiente) y la pantalla de origen,
 *  de modo que "volver" regrese a Estadísticas con su pestaña y período. */
export interface EstadoDetalleDesdeEstadisticas {
  navegacion: string[];
  origen: string;
}

/** `search` es el de la URL actual ("?t=gastos&p=7D" o ""). */
export function estadoDetalle(ids: readonly string[], search: string): EstadoDetalleDesdeEstadisticas {
  return { navegacion: [...ids], origen: `${RUTA_ESTADISTICAS}${search}` };
}
