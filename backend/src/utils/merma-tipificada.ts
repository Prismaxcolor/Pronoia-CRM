/**
 * Merma tipificada de transformaciones: lógica pura (sin BD).
 *
 * La merma derivada (entrada - suma de salidas, ver merma-transformacion.ts) se
 * puede desglosar opcionalmente por tipo: basura, plástico, tierra, hierro, otro.
 * Lo que no se tipifica se muestra como "sin clasificar".
 */
import type { FilaMerma } from './merma-transformacion.js';

export const TIPOS_MERMA = ['basura', 'plastico', 'tierra', 'hierro', 'otro'] as const;
export type TipoMerma = (typeof TIPOS_MERMA)[number];

/** Margen (kg) de redondeo al comparar lo tipificado con la merma derivada. */
export const TOLERANCIA_MERMA_KG = 0.01;

export interface DetalleMerma {
  tipo: TipoMerma;
  pesoKg: number;
}

export type MermaPorTipo = Record<TipoMerma, number>;

const redondear = (n: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};
const kg = (n: number) => redondear(n, 3) + 0; // + 0 evita -0
const pct = (parte: number, total: number) => (total > 0 ? redondear((parte / total) * 100, 2) + 0 : 0);

export function tipoMermaParaDetalle(valor: string): TipoMerma | null {
  return (TIPOS_MERMA as readonly string[]).includes(valor) ? (valor as TipoMerma) : null;
}

export function mermaPorTipoVacia(): MermaPorTipo {
  return { basura: 0, plastico: 0, tierra: 0, hierro: 0, otro: 0 };
}

/** Suma los renglones de un mismo tipo (un renglón por tipo), en el orden de TIPOS_MERMA.
 *  Descarta pesos no finitos o <= 0. No muta la entrada. */
export function consolidarDetalleMerma(detalle: readonly DetalleMerma[]): DetalleMerma[] {
  const suma = mermaPorTipoVacia();
  for (const d of detalle) {
    if (Number.isFinite(d.pesoKg) && d.pesoKg > 0) suma[d.tipo] += d.pesoKg;
  }
  return TIPOS_MERMA.filter(t => suma[t] > 0).map(t => ({ tipo: t, pesoKg: kg(suma[t]) }));
}

/** Mensaje de error si el desglose no es válido contra la merma derivada; null si lo es.
 *  Regla: suma tipificada <= merma derivada + 0,01 kg. Lista vacía siempre es válida. */
export function validarMermaTipificada(mermaDerivadaKg: number, detalle: readonly DetalleMerma[]): string | null {
  if (detalle.some(d => !Number.isFinite(d.pesoKg) || d.pesoKg <= 0)) {
    return 'Cada merma por tipo debe pesar más de 0 kg.';
  }
  const total = kg(consolidarDetalleMerma(detalle).reduce((a, d) => a + d.pesoKg, 0));
  if (total === 0) return null;
  const merma = Math.max(mermaDerivadaKg, 0);
  if (total > merma + TOLERANCIA_MERMA_KG) {
    return `La merma por tipo suma ${total.toFixed(2)} kg y supera la merma de la transformación (${merma.toFixed(2)} kg).`;
  }
  return null;
}

export interface DesgloseMerma {
  porTipo: MermaPorTipo;
  kgTipificado: number;
  /** Merma derivada que nadie clasificó (nunca negativa). */
  kgSinClasificar: number;
  /** Cuánto se pasa lo tipificado de la merma derivada (0 si cabe dentro de la tolerancia).
   *  Puede pasar si se editaron los pesos de la transformación después de tipificar. */
  excedeKg: number;
}

export function desglosarMerma(mermaDerivadaKg: number, detalle: readonly DetalleMerma[]): DesgloseMerma {
  const porTipo = mermaPorTipoVacia();
  for (const d of consolidarDetalleMerma(detalle)) porTipo[d.tipo] = d.pesoKg;
  const kgTipificado = kg(TIPOS_MERMA.reduce((a, t) => a + porTipo[t], 0));
  const merma = Math.max(mermaDerivadaKg, 0);
  const exceso = kg(kgTipificado - merma);
  return {
    porTipo,
    kgTipificado,
    kgSinClasificar: kg(Math.max(merma - kgTipificado, 0)),
    excedeKg: exceso > TOLERANCIA_MERMA_KG ? exceso : 0,
  };
}

export interface ParteMerma {
  kg: number;
  /** % sobre la merma total del conjunto. */
  pctDeMerma: number;
  /** % sobre los kilos de entrada del conjunto. */
  pctDeEntrada: number;
}

export interface TipoMermaResumen extends ParteMerma {
  tipo: TipoMerma;
}

export interface ResumenMermaPorTipo {
  transformaciones: number;
  kgEntrada: number;
  kgMerma: number;
  tipos: TipoMermaResumen[];
  sinClasificar: ParteMerma;
}

export interface ResumenMermaCategoria extends ResumenMermaPorTipo {
  categoria: string;
}

/** Desglose de la merma de un conjunto de filas: kg y % por tipo y "sin clasificar".
 *  Los % se calculan sobre sumas (no promedio de porcentajes). */
export function resumirMermaPorTipo(filas: readonly FilaMerma[]): ResumenMermaPorTipo {
  const kgEntrada = kg(filas.reduce((a, f) => a + f.kgEntrada, 0));
  const kgMerma = kg(filas.reduce((a, f) => a + f.kgMerma, 0));
  const parte = (kgParte: number): ParteMerma => ({
    kg: kg(kgParte),
    pctDeMerma: pct(kgParte, kgMerma),
    pctDeEntrada: pct(kgParte, kgEntrada),
  });
  const tipos = TIPOS_MERMA.map(tipo => ({
    tipo,
    ...parte(filas.reduce((a, f) => a + f.mermaPorTipo[tipo], 0)),
  }));
  return {
    transformaciones: filas.length,
    kgEntrada,
    kgMerma,
    tipos,
    sinClasificar: parte(filas.reduce((a, f) => a + f.kgSinClasificar, 0)),
  };
}

/** Lo mismo, pero separado por categoría de transformación (orden alfabético). */
export function resumirMermaPorCategoria(filas: readonly FilaMerma[]): ResumenMermaCategoria[] {
  const grupos = new Map<string, FilaMerma[]>();
  for (const f of filas) grupos.set(f.categoria, [...(grupos.get(f.categoria) ?? []), f]);
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([categoria, grupo]) => ({ categoria, ...resumirMermaPorTipo(grupo) }));
}
