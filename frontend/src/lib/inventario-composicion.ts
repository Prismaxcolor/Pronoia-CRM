/** Lógica pura de la sub-tabla "Composición del lote" (qué productos forman un lote y cuántos kg hay de cada uno).
 *  Sin React ni DOM para poder probarla desde backend/tests/inventario-composicion.test.ts. */

export interface ItemComposicion {
  productoId: string;
  producto: string;
  categoria: string | null;
  kgActual: number;
  kgCompradoPeriodo: number;
}

export interface FiltrosComposicion {
  desde?: string;
  hasta?: string;
  almacenId?: string;
}

export interface ItemComposicionConPct extends ItemComposicion {
  /** Porcentaje del total de kg actuales del lote (0 a 100). */
  pct: number;
}

export interface TotalesComposicion {
  kgActual: number;
  kgCompradoPeriodo: number;
}

export const TEXTO_APROXIMADO_ESTANDAR =
  'Estas cifras son una estimación: parte del material llegó al lote por una transformación y el sistema lo reparte en proporción a lo que entró.';

const numeroSeguro = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Clave de caché: cambia si cambia el lote, el rango de fechas o el almacén. */
export function claveComposicion(loteId: string, filtros: FiltrosComposicion): string {
  return [loteId, filtros.desde ?? '', filtros.hasta ?? '', filtros.almacenId ?? ''].join('|');
}

/** Ordena por kg actuales de mayor a menor (desempate por nombre) y calcula el % de cada producto sobre el total.
 *  No modifica la lista recibida. */
export function ordenarYCalcularPct(items: readonly ItemComposicion[], baseKg?: number): ItemComposicionConPct[] {
  const limpios = items.map(i => ({ ...i, kgActual: numeroSeguro(i.kgActual), kgCompradoPeriodo: numeroSeguro(i.kgCompradoPeriodo) }));
  const sumaItems = limpios.reduce((s, i) => s + i.kgActual, 0);
  const total = baseKg !== undefined && numeroSeguro(baseKg) > 0 ? Math.max(numeroSeguro(baseKg), sumaItems) : sumaItems;
  return limpios
    .map(i => ({ ...i, pct: total > 0 ? (i.kgActual / total) * 100 : 0 }))
    .sort((a, b) => b.kgActual - a.kgActual || a.producto.localeCompare(b.producto, 'es'));
}

/** Totales calculados desde las filas (se usan si el backend no los manda o para comprobar que cuadran). */
export function totalizarComposicion(items: readonly ItemComposicion[]): TotalesComposicion {
  return items.reduce<TotalesComposicion>(
    (t, i) => ({ kgActual: t.kgActual + numeroSeguro(i.kgActual), kgCompradoPeriodo: t.kgCompradoPeriodo + numeroSeguro(i.kgCompradoPeriodo) }),
    { kgActual: 0, kgCompradoPeriodo: 0 },
  );
}

/** Texto del aviso de cifras aproximadas: usa la nota del backend si trae contenido; si no, el texto estándar. */
export function textoAvisoAproximado(nota: string | null | undefined): string {
  const limpia = typeof nota === 'string' ? nota.trim() : '';
  return limpia || TEXTO_APROXIMADO_ESTANDAR;
}

/** Una composición está vacía si no hay filas o ninguna tiene kilos en el lote ni compras en el periodo. */
export function composicionVacia(items: readonly ItemComposicion[]): boolean {
  return items.every(i => numeroSeguro(i.kgActual) <= 0 && numeroSeguro(i.kgCompradoPeriodo) <= 0);
}

/** Kilos mínimos para mostrar la fila "Sin detalle por producto" (evita ruido por redondeos). */
export const UMBRAL_SIN_DETALLE_KG = 0.05;
/** Con más de esta parte del lote sin detalle se muestra un aviso arriba. */
export const UMBRAL_AVISO_SIN_DETALLE_PCT = 20;

export interface SinDetalle {
  kg: number;
  /** Porcentaje del stock total del lote (0 a 100). */
  pct: number;
  /** true si supera el umbral que justifica el aviso. */
  esAlto: boolean;
}

/** Kilos del lote que no se pueden repartir por producto (kgLote - suma por producto). null si no hay dato o no llega al umbral. */
export function calcularSinDetalle(kgLote: number | undefined | null, kgConProducto: number): SinDetalle | null {
  if (typeof kgLote !== 'number' || !Number.isFinite(kgLote) || kgLote <= 0) return null;
  const kg = kgLote - numeroSeguro(kgConProducto);
  if (kg <= UMBRAL_SIN_DETALLE_KG) return null;
  const pct = (kg / kgLote) * 100;
  return { kg, pct, esAlto: pct > UMBRAL_AVISO_SIN_DETALLE_PCT };
}
