/** Línea mínima de un ticket de pesaje o traslado (una pesada). */
export interface LineaMaterial {
  productoId: string | null;
  nombreProducto?: string | null;
  loteId?: string | null;
  nombreLote?: string | null;
}

function claveMaterial(l: LineaMaterial, idx: number): string {
  if (l.loteId) return `lote:${l.loteId}`;
  if (l.productoId) return `prod:${l.productoId}`;
  return `fila:${idx}`;
}

/** Cantidad de materiales distintos (productos o lotes únicos), no de pesadas. */
export function contarMaterialesDistintos(lineas: readonly LineaMaterial[]): number {
  return new Set(lineas.map(claveMaterial)).size;
}

/** Texto para la columna "Materiales": el nombre si es uno solo, "N materiales" si varios. */
export function resumenMateriales(lineas: readonly LineaMaterial[]): string {
  const unicas = new Map<string, LineaMaterial>();
  lineas.forEach((l, i) => { const k = claveMaterial(l, i); if (!unicas.has(k)) unicas.set(k, l); });
  if (unicas.size === 0) return '—';
  if (unicas.size === 1) {
    const l = [...unicas.values()][0];
    return l.loteId ? `${l.nombreLote ?? 'Lote'} (lote completo)` : l.nombreProducto ?? 'material';
  }
  return `${unicas.size} materiales`;
}
