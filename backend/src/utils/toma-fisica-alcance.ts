/** Lógica pura del ALCANCE de una toma física de inventario.
 *
 *  - 'categoria': se cuentan productos de categorías "sin lote" (Ferroso, ...).
 *  - 'lote': se cuentan lotes completos (PCB, PGM, ...), uno por uno.
 *
 *  El alcance no tiene columna propia: las tomas existentes lo derivan de
 *  lote_ids / categorías, así que nada cambia para las ya cerradas. */

export type AlcanceToma = 'categoria' | 'lote';

export interface CategoriaAlcance {
  id: string;
  sinLote: boolean;
}

/** Una categoría se inventaría "por categoría" solo si está marcada sin lote Y
 *  ninguno de sus productos está anclado a un lote (producto_lotes). Si algún
 *  producto tiene lotes posibles, la categoría se cuenta por lote. */
export function categoriaSinLoteEfectivo(sinLoteFlag: boolean, tieneProductosAnclados: boolean): boolean {
  return sinLoteFlag && !tieneProductosAnclados;
}

export function derivarAlcance(loteIds: string[] | null, categoriasSinLote: boolean[]): AlcanceToma {
  if (loteIds && loteIds.length > 0) return 'lote';
  return categoriasSinLote.some(sinLote => !sinLote) ? 'lote' : 'categoria';
}

export function validarAlcance(input: {
  alcance: AlcanceToma;
  categorias: CategoriaAlcance[];
  loteIds: string[];
}): string | null {
  const { alcance, categorias, loteIds } = input;
  if (alcance === 'categoria') {
    if (categorias.length === 0) return 'Elige al menos una categoría a inventariar.';
    if (categorias.some(c => !c.sinLote)) {
      return 'Las categorías con lote (ej. PCB) se cuentan "Por lote": cambia el alcance.';
    }
    if (loteIds.length > 0) return 'El alcance "Por categoría" no admite lotes sueltos.';
    return null;
  }
  if (loteIds.length === 0) return 'Elige al menos un lote a inventariar.';
  if (categorias.length === 0) return 'Elige la categoría a la que pertenecen los lotes.';
  if (categorias.some(c => c.sinLote)) {
    return 'El alcance "Por lote" solo admite categorías con lote.';
  }
  return null;
}

export interface TomaAbiertaRef {
  id: string;
  codigo: string;
  almacenId: string;
  categoriaIds: string[];
  estado: 'abierta' | 'cerrada' | 'cancelada';
}

/** Misma regla que el RPC crear_toma_fisica_inventario (mismo almacén y
 *  categorías en común), solo que con el código de la toma para el mensaje. */
export function buscarTomaSolapada(
  nueva: { almacenId: string; categoriaIds: string[] },
  tomas: TomaAbiertaRef[]
): TomaAbiertaRef | null {
  return (
    tomas.find(
      t =>
        t.estado === 'abierta' &&
        t.almacenId === nueva.almacenId &&
        t.categoriaIds.some(c => nueva.categoriaIds.includes(c))
    ) ?? null
  );
}

export interface LineaResumenPlana {
  productoId: string | null;
  productoNombre: string | null;
  loteId: string | null;
  loteNombre: string | null;
  stockTeorico: number;
  stockReal: number;
  diferencia: number;
  cantidadPesajes: number;
}

/** Líneas "sin contar" para los lotes del alcance que todavía no tienen
 *  pesaje (resumen_toma_fisica solo lista los ya contados). Solo informativas:
 *  diferencia 0, y culminar no las ajusta (igual que antes). */
export function lineasLotesSinContar(
  loteIds: string[],
  lineas: Array<{ productoId: string | null; loteId: string | null }>,
  teoricoPorLote: Map<string, number>,
  nombrePorLote: Map<string, string>
): LineaResumenPlana[] {
  const presentes = new Set(lineas.filter(l => l.productoId === null).map(l => l.loteId));
  return loteIds
    .filter(id => !presentes.has(id))
    .map(id => ({
      productoId: null,
      productoNombre: null,
      loteId: id,
      loteNombre: nombrePorLote.get(id) ?? '—',
      stockTeorico: teoricoPorLote.get(id) ?? 0,
      stockReal: 0,
      diferencia: 0,
      cantidadPesajes: 0,
    }));
}
