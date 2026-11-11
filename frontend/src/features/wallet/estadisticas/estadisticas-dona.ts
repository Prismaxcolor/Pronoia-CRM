/** Lógica pura de la dona de Estadísticas: porciones (con "Otros"), privacidad por porción y colores distinguibles.
 *  Se prueba en backend/tests/wallet-estadisticas-revision.test.ts. */

import { COLOR_SIN_CATEGORIA } from './estadisticas-logica';

export const MAX_PORCIONES_DONA_W = 8;
/** Neutro de "Otros": distinto del gris de "Sin categoría" (aunque ambos sean neutros) y de los colores de categoría. */
export const COLOR_OTROS = '#A8A29E';
/** Distancia mínima (RGB, 0 a 441) para considerar que dos colores se distinguen a simple vista. */
const DISTANCIA_MINIMA = 60;
/** Reemplazos cuando un color choca con otro: contrastados entre sí y sin grises. */
const COLORES_DE_RESPALDO = ['#2563EB', '#E69F00', '#CC79A7', '#0F766E', '#6A3D9A', '#DC2626', '#56B4E9', '#8C6D46', '#65A30D', '#DB2777'];

export interface ItemDonaW {
  etiqueta: string;
  valor: number;
  color: string;
  /** El monto pertenece a una cuenta con el ojo cerrado: no se muestra. */
  oculto?: boolean;
}

export interface PorcionDonaW {
  etiqueta: string;
  valor: number;
  color: string;
  pct: number;
  esOtros: boolean;
  oculto: boolean;
}

type Rgb = readonly [number, number, number];

function aRgb(color: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const distancia = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const distinto = (c: Rgb, usados: readonly Rgb[]): boolean => usados.every(u => distancia(c, u) >= DISTANCIA_MINIMA);

/** Cada color queda distinguible de los anteriores y de los neutros `protegidos` (que conservan su color). Los colores que
 *  no son hexadecimales (variables CSS) no se tocan. Devuelve una lista nueva. */
export function diferenciarColores(colores: readonly string[], protegidos: readonly string[]): string[] {
  const usados: Rgb[] = protegidos.map(aRgb).filter((c): c is Rgb => c !== null);
  const pendientes = new Set(protegidos);
  return colores.map(color => {
    if (pendientes.delete(color)) return color;
    const rgb = aRgb(color);
    if (!rgb) return color;
    const elegido = distinto(rgb, usados) ? color : COLORES_DE_RESPALDO.find(c => distinto(aRgb(c) as Rgb, usados)) ?? color;
    usados.push(aRgb(elegido) as Rgb);
    return elegido;
  });
}

/** Hasta `max` porciones de mayor a menor; el resto se junta en "Otros" (al final, oculto si algo de lo agrupado lo estaba). */
export function porcionesDonaW(items: readonly ItemDonaW[], max = MAX_PORCIONES_DONA_W): PorcionDonaW[] {
  const validos = items.filter(i => Number.isFinite(i.valor) && i.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = validos.reduce((s, i) => s + i.valor, 0);
  if (total === 0) return [];
  const tope = Math.max(1, max);
  const principales = validos.length > tope ? validos.slice(0, tope) : validos;
  const resto = validos.length > tope ? validos.slice(tope) : [];
  const base = principales.map(i => ({ etiqueta: i.etiqueta, valor: i.valor, color: i.color, pct: (i.valor / total) * 100, esOtros: false, oculto: i.oculto === true }));
  if (resto.length > 0) {
    const valor = resto.reduce((s, i) => s + i.valor, 0);
    base.push({ etiqueta: 'Otros', valor, color: COLOR_OTROS, pct: (valor / total) * 100, esOtros: true, oculto: resto.some(i => i.oculto === true) });
  }
  const colores = diferenciarColores(base.map(p => p.color), [COLOR_SIN_CATEGORIA, COLOR_OTROS]);
  return base.map((p, i) => ({ ...p, color: colores[i] }));
}
