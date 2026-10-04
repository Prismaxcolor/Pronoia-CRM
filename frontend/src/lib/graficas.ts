/** Matemática pura de las gráficas SVG ligeras (escalas, ejes, rutas, porciones de dona). Sin React ni DOM:
 *  se prueba desde backend/tests. Los componentes de components/ui/graficas/* solo dibujan lo que esto calcula. */

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Redondeo a un valor "bonito" (1, 2, 5 x 10^n). Con `redondear` elige el más cercano; si no, el inmediato superior. */
export function numeroBonito(x: number, redondear: boolean): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  let nf: number;
  if (redondear) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

export interface EjeY {
  min: number;
  max: number;
  paso: number;
  ticks: number[];
}

/** Eje vertical que arranca en 0 (o en el mínimo negativo) y termina en un múltiplo bonito del paso. `maxTicks` ≈ cantidad de líneas guía. */
export function calcularEjeY(minDato: number, maxDato: number, maxTicks = 4): EjeY {
  const min = Math.min(0, Number.isFinite(minDato) ? minDato : 0);
  const max = Math.max(0, Number.isFinite(maxDato) ? maxDato : 0);
  if (max === 0 && min === 0) return { min: 0, max: 1, paso: 1, ticks: [0, 1] };
  const rango = numeroBonito(max - min, false);
  const paso = numeroBonito(rango / Math.max(1, maxTicks), true);
  const limpio = (n: number) => Number(n.toPrecision(12));
  const tMin = limpio(Math.floor(limpio(min / paso)) * paso);
  const tMax = limpio(Math.ceil(limpio(max / paso)) * paso);
  const ticks: number[] = [];
  for (let t = tMin; t <= tMax + paso / 2; t += paso) ticks.push(limpio(Math.round(t / paso) * paso));
  return { min: tMin, max: tMax, paso, ticks };
}

/** Escala lineal dominio -> rango (p. ej. valor -> píxel). Dominio degenerado devuelve el punto medio del rango. */
export function escalaLineal(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return v => r0 + (v - d0) * k;
}

export interface Margen { arriba: number; derecha: number; abajo: number; izquierda: number }

export interface Punto { x: number; y: number }

/** Posiciones de n puntos repartidos en [x0, x1] (con 1 solo punto va al centro). */
export function posicionesX(n: number, x0: number, x1: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(x0 + x1) / 2];
  return Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));
}

/** Ruta SVG de una polilínea ("M x y L x y ..."). Vacía si no hay puntos. Redondea a 2 decimales. */
export function rutaLinea(puntos: readonly Punto[]): string {
  return puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${r2(p.x)} ${r2(p.y)}`).join(' ');
}

/** Ruta cerrada del área bajo la línea hasta `yBase`. */
export function rutaArea(puntos: readonly Punto[], yBase: number): string {
  if (puntos.length === 0) return '';
  const ult = puntos[puntos.length - 1];
  return `${rutaLinea(puntos)} L${r2(ult.x)} ${r2(yBase)} L${r2(puntos[0].x)} ${r2(yBase)} Z`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Índice del punto cuya x está más cerca de `x`. -1 si no hay puntos. */
export function indiceMasCercano(xs: readonly number[], x: number): number {
  let mejor = -1;
  let dist = Infinity;
  xs.forEach((px, i) => {
    const d = Math.abs(px - x);
    if (d < dist) { dist = d; mejor = i; }
  });
  return mejor;
}

// ---------------------------------------------------------------- barras

/** Ancho (0-100 %) de cada barra horizontal respecto al máximo. Valores negativos o no finitos cuentan como 0. */
export function porcentajesDeMaximo(valores: readonly number[]): number[] {
  const limpios = valores.map(v => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...limpios);
  return limpios.map(v => (max === 0 ? 0 : (v / max) * 100));
}

export interface TramoApilado { indiceSerie: number; valor: number; desde: number; hasta: number }

/** Apila los valores de una categoría (cada serie sobre la anterior). Los negativos y no finitos se tratan como 0. */
export function apilarCategoria(valores: readonly number[]): { segmentos: TramoApilado[]; total: number } {
  let acum = 0;
  const segmentos = valores.map((v, i) => {
    const valor = Number.isFinite(v) && v > 0 ? v : 0;
    const s = { indiceSerie: i, valor, desde: acum, hasta: acum + valor };
    acum += valor;
    return s;
  });
  return { segmentos, total: acum };
}

/** Geometría de n barras en un ancho dado: ancho de cada barra y x inicial, con hueco proporcional. */
export function geometriaBarras(n: number, anchoTotal: number, proporcionHueco = 0.3): { ancho: number; paso: number; xs: number[] } {
  if (n <= 0 || anchoTotal <= 0) return { ancho: 0, paso: 0, xs: [] };
  const paso = anchoTotal / n;
  const ancho = paso * (1 - clamp(proporcionHueco, 0, 0.9));
  return { ancho, paso, xs: Array.from({ length: n }, (_, i) => i * paso + (paso - ancho) / 2) };
}

// ---------------------------------------------------------------- dona

export interface ItemDona { etiqueta: string; valor: number; color?: string }
export interface PorcionDona extends ItemDona { pct: number; esOtros: boolean }

export const MAX_PORCIONES_DONA = 5;

/** Máximo `max` porciones + "Otros" (suma del resto). Descarta valores <= 0. Ordena de mayor a menor (Otros al final).
 *  Una dona con más de 5 partes no se lee: por eso el tope es parte de la regla de estilo, no una opción. */
export function porcionesDona(items: readonly ItemDona[], max = MAX_PORCIONES_DONA, etiquetaOtros = 'Otros'): PorcionDona[] {
  const validos = items.filter(i => Number.isFinite(i.valor) && i.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = validos.reduce((s, i) => s + i.valor, 0);
  if (total === 0) return [];
  const tope = Math.max(1, Math.min(max, MAX_PORCIONES_DONA));
  const principales = validos.length > tope ? validos.slice(0, tope) : validos;
  const resto = validos.length > tope ? validos.slice(tope) : [];
  const porciones: PorcionDona[] = principales.map(i => ({ ...i, pct: (i.valor / total) * 100, esOtros: false }));
  if (resto.length > 0) {
    const valor = resto.reduce((s, i) => s + i.valor, 0);
    porciones.push({ etiqueta: etiquetaOtros, valor, pct: (valor / total) * 100, esOtros: true });
  }
  return porciones;
}

/** Ángulos [inicio, fin] en radianes de cada porción, empezando arriba (-π/2) y girando en sentido horario. */
export function angulosDona(porciones: ReadonlyArray<{ pct: number }>): Array<[number, number]> {
  let a = -Math.PI / 2;
  return porciones.map(p => {
    const ini = a;
    a += (p.pct / 100) * Math.PI * 2;
    return [ini, a];
  });
}

/** Ruta de un sector de anillo. Una porción de ~100 % se dibuja con dos medios arcos (un arco de 360° no se renderiza). */
export function rutaArco(cx: number, cy: number, rExt: number, rInt: number, a0: number, a1: number): string {
  const barrido = a1 - a0;
  const punto = (r: number, a: number) => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;
  if (barrido >= Math.PI * 2 - 1e-6) {
    const m = a0 + Math.PI;
    return `M${punto(rExt, a0)} A${rExt} ${rExt} 0 1 1 ${punto(rExt, m)} A${rExt} ${rExt} 0 1 1 ${punto(rExt, a0)} Z M${punto(rInt, a0)} A${rInt} ${rInt} 0 1 0 ${punto(rInt, m)} A${rInt} ${rInt} 0 1 0 ${punto(rInt, a0)} Z`;
  }
  const grande = barrido > Math.PI ? 1 : 0;
  return `M${punto(rExt, a0)} A${rExt} ${rExt} 0 ${grande} 1 ${punto(rExt, a1)} L${punto(rInt, a1)} A${rInt} ${rInt} 0 ${grande} 0 ${punto(rInt, a0)} Z`;
}

// ---------------------------------------------------------------- resúmenes

export interface ResumenSerie { total: number; promedio: number; min: number; max: number; indiceMin: number; indiceMax: number }

/** Total, promedio y extremos de una serie (ignora no finitos). null si no hay datos. */
export function resumirSerie(valores: readonly number[]): ResumenSerie | null {
  let total = 0, n = 0, min = Infinity, max = -Infinity, iMin = -1, iMax = -1;
  valores.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    total += v; n += 1;
    if (v < min) { min = v; iMin = i; }
    if (v > max) { max = v; iMax = i; }
  });
  return n === 0 ? null : { total, promedio: total / n, min, max, indiceMin: iMin, indiceMax: iMax };
}

/** Variación porcentual contra un valor base. null si la base es 0 o no hay dato. */
export function variacionPct(actual: number, base: number | null | undefined): number | null {
  if (base === null || base === undefined || !Number.isFinite(base) || !Number.isFinite(actual) || base === 0) return null;
  return ((actual - base) / Math.abs(base)) * 100;
}
