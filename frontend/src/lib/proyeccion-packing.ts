import type { FilaPackingList } from './packing-list';
import { calcularNeto, redondear2 } from './packing-list';

/**
 * Proyección de exportación (interna): valor estimado por lote = kg netos × USD/kg ingresado a mano.
 * Pura y sin dependencias de React; la usan el editor y los tests.
 */

export interface KgLote {
  lote: string;
  kg: number;
}

export interface LineaProyeccion extends KgLote {
  valorKgUsd: number | null;
  totalUsd: number;
}

export interface ResumenProyeccion {
  lineas: LineaProyeccion[];
  totalKg: number;
  totalUsd: number;
}

/** Kg netos por lote, en orden de aparición. Los ítems sin lote se agrupan bajo la clave ''. */
export function kgPorLote(filas: readonly FilaPackingList[]): KgLote[] {
  const acumulado = filas.reduce((mapa, f) => {
    const clave = f.lote?.trim() ?? '';
    return new Map(mapa).set(clave, redondear2((mapa.get(clave) ?? 0) + calcularNeto(f.pesoBruto, f.pesoPaleta)));
  }, new Map<string, number>());
  return [...acumulado].map(([lote, kg]) => ({ lote, kg }));
}

/** Total por lote y totales generales. Un lote sin valor cuenta sus kg pero suma 0 USD. */
export function calcularProyeccion(kgs: readonly KgLote[], valores: Readonly<Record<string, number | null | undefined>>): ResumenProyeccion {
  const lineas = kgs.map(({ lote, kg }) => {
    const valorKgUsd = valores[lote] ?? null;
    return { lote, kg, valorKgUsd, totalUsd: valorKgUsd === null ? 0 : redondear2(kg * valorKgUsd) };
  });
  return {
    lineas,
    totalKg: redondear2(lineas.reduce((s, l) => s + l.kg, 0)),
    totalUsd: redondear2(lineas.reduce((s, l) => s + l.totalUsd, 0)),
  };
}

/** Lee un valor USD/kg escrito a mano ("2,5", "1.279,5" o "2.5"), hasta 4 decimales. Vacío o inválido = null. */
export function parsearValorKg(texto: string): number | null {
  const t = texto.trim();
  if (t === '') return null;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,4})?$/.test(normalizado)) return null;
  const n = Number(normalizado);
  return Number.isFinite(n) && n <= 1_000_000 ? n : null;
}

/** 2.5 -> "2,5" (el campo se edita como texto con coma decimal). */
export const textoValorKg = (n: number): string => String(n).replace('.', ',');
