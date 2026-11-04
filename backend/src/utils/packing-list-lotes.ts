import type { ClaseLote, OpcionLotePacking } from '../../../shared/types/index.js';

/**
 * Lotes de exportación que se ofrecen en el packing list, con los kg que hay por almacén.
 * Todo es de lectura y de CONTROL INTERNO: no descuenta ni mueve inventario, y no sale en los PDF.
 */

/** Claves de color de lote. Duplicado a propósito de COLORES_LOTE (frontend/src/lib/packing-list.ts): si se cambia uno, cambiar el otro. */
export const CLAVES_COLOR_LOTE = ['green', 'black', 'blue', 'red', 'yellow', 'orange', 'purple', 'brown', 'white', 'gray'] as const;

const DIGITOS_LOTE = /^lote\s*(\d+)$/i;

/** Texto que se guarda en el ítem: "LOTE 1" -> "1" (los documentos imprimen "LOT 1" / "LOTE 1" según el idioma). */
export function valorLotePacking(nombre: string): string {
  const limpio = nombre.trim();
  const m = DIGITOS_LOTE.exec(limpio);
  return m ? m[1] : limpio;
}

export interface CandidatoLotePacking {
  nombre: string;
  activo: boolean;
  /** undefined = la BD aún no tiene la migración de clasificación. */
  clase: ClaseLote | undefined;
  /** Lote de catalizadores (PGM / LOTE 4): el packing es de PCB y no lo usa. */
  esCatalizadores: boolean;
}

/** Activo, de exportación (o, sin migración de clase, un lote numerado) y que no sea el de catalizadores. */
export function seOfreceEnPacking(l: CandidatoLotePacking): boolean {
  if (!l.activo || l.esCatalizadores) return false;
  return l.clase === undefined ? DIGITOS_LOTE.test(l.nombre.trim()) : l.clase === 'exportacion';
}

export interface LoteConStock {
  id: string;
  nombre: string;
  color: string | null;
  stockKg: number;
  /** true = no se pudo leer el stock de este lote: se ofrece sin kg y marcado, nunca como 0 kg. */
  stockNoLeido?: boolean;
  porAlmacen: ReadonlyArray<{ almacenId: string; almacenNombre: string; stockKg: number }>;
}

const porTexto = (a: string, b: string): number => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/** Una opción por (lote, almacén) con stock; un lote sin stock en ningún almacén queda como una opción en 0. */
export function armarOpcionesLotePacking(lotes: readonly LoteConStock[]): OpcionLotePacking[] {
  const opciones = lotes.flatMap((l): OpcionLotePacking[] => {
    const comun = { loteId: l.id, nombre: l.nombre, valor: valorLotePacking(l.nombre), colorPredeterminado: l.color };
    if (l.stockNoLeido) {
      return [{ ...comun, almacenId: null, almacenNombre: null, disponibleKg: null, disponibilidadNoLeida: true }];
    }
    if (l.porAlmacen.length === 0) {
      return [{ ...comun, almacenId: null, almacenNombre: null, disponibleKg: l.stockKg > 0 ? l.stockKg : 0 }];
    }
    return [...l.porAlmacen]
      .sort((a, b) => porTexto(a.almacenNombre, b.almacenNombre))
      .map(a => ({ ...comun, almacenId: a.almacenId, almacenNombre: a.almacenNombre, disponibleKg: a.stockKg }));
  });
  return opciones.sort((a, b) => porTexto(a.nombre, b.nombre) || porTexto(a.almacenNombre ?? '', b.almacenNombre ?? ''));
}

/**
 * Opciones para quien NO tiene permiso de inventario: solo el lote (nombre, valor y color), sin almacén ni kg.
 * Una opción por lote; el editor sigue funcionando pero no se compara con el inventario.
 */
export function armarOpcionesLoteSinDisponible(
  lotes: ReadonlyArray<Pick<LoteConStock, 'id' | 'nombre' | 'color'>>
): OpcionLotePacking[] {
  return lotes
    .map((l): OpcionLotePacking => ({
      loteId: l.id, nombre: l.nombre, valor: valorLotePacking(l.nombre), almacenId: null, almacenNombre: null,
      disponibleKg: null, colorPredeterminado: l.color,
    }))
    .sort((a, b) => porTexto(a.nombre, b.nombre));
}
