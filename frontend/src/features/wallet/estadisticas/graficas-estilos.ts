/** Medidas y estilos compartidos por las gráficas de Estadísticas (y por sus leyendas, que deben mostrar el mismo trazo). */

import { colorDeSerie } from '../../../lib/paleta';
import type { Granularidad } from './estadisticas-logica';

export const ANCHO_GRAFICA = 640;
export const ALTO_GRAFICA = 240;
export const MARGEN_GRAFICA = { arriba: 10, abajo: 26, derecha: 8 };
export const MAX_ETIQUETAS_X = 7;
/** Ancho reservado al eje Y: con las cantidades ocultas no hay números en el eje. */
export const margenIzquierdo = (ocultar: boolean): number => (ocultar ? 8 : 48);

export interface EstiloCurva {
  etiqueta: string;
  color: string;
  /** stroke-dasharray: "" continuo, "2 5" punteado, "9 5" guiones. Distingue las curvas aunque no se vea el color. */
  trazo: string;
  grosor: number;
}

export const CURVA_ACTUAL: EstiloCurva = { etiqueta: 'Período actual', color: 'var(--color-w-acento)', trazo: '', grosor: 3 };
export const CURVA_ANTERIOR: EstiloCurva = { etiqueta: 'Período anterior (punteado)', color: 'var(--color-w-texto2)', trazo: '2 5', grosor: 2.5 };
export const CURVA_ANIO_PASADO: EstiloCurva = { etiqueta: 'Mismo período del año pasado (guiones)', color: colorDeSerie(1), trazo: '9 5', grosor: 2.5 };

/** Colores de la tendencia de gastos por tipo (los mismos de la Wallet clásica: pagos, adelantos, otros). */
export const COLOR_TIPO_PAGOS = colorDeSerie(0);
export const COLOR_TIPO_ADELANTOS = colorDeSerie(1);
export const COLOR_TIPO_OTROS = colorDeSerie(2);
export const COLOR_GASTO_TOTAL = 'var(--color-w-negativo)';

/** Cómo se nombra un tramo en el tooltip según la granularidad. */
export const PREFIJO_TRAMO: Readonly<Record<Granularidad, string>> = { dia: '', semana: 'Semana del ', mes: 'Mes ' };

export const SERIES_TIPO: ReadonlyArray<{ clave: 'pagos' | 'adelantos' | 'otros'; etiqueta: string; color: string }> = [
  { clave: 'pagos', etiqueta: 'Pagos', color: COLOR_TIPO_PAGOS },
  { clave: 'adelantos', etiqueta: 'Adelantos', color: COLOR_TIPO_ADELANTOS },
  { clave: 'otros', etiqueta: 'Otros egresos', color: COLOR_TIPO_OTROS },
];
