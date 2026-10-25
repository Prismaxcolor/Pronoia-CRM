/**
 * Embalado por kilos de un lote: lógica pura (sin BD).
 *
 * Un lote puede tener una parte embalada/lista y otra todavía en saca. El
 * embalado se registra por kilos (lote_embalajes) y NO descuenta stock: es una
 * marca sobre el stock del lote. Como el stock baja cuando se despacha, se
 * vende o se transforma, el resumen recorta lo embalado al stock real y avisa
 * ("embalado > stock") sin bloquear ninguna operación existente.
 */

/** Margen (kg) de redondeo al decidir si lo embalado excede el stock. */
export const TOLERANCIA_EMBALADO_KG = 0.01;

export interface EmbalajeParaResumen {
  almacenId: string | null;
  pesoKg: number;
  anulado: boolean;
}

export interface ResumenEmbalado {
  stockKg: number;
  /** Suma de embalajes vigentes tal como se marcaron (puede exceder el stock). */
  embaladoMarcadoKg: number;
  /** Lo embalado que el stock actual respalda: min(marcado, stock). */
  embaladoKg: number;
  /** stock - embalado (nunca negativo). */
  enSacaKg: number;
  /** Los embalajes vigentes superan el stock actual. */
  embaladoMayorQueStock: boolean;
  /** Cuánto se pasa (0 si no se pasa). */
  excesoKg: number;
}

export interface ResumenEmbaladoAlmacen extends ResumenEmbalado {
  almacenId: string;
}

const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000 + 0;

function sumaVigente(embalajes: readonly EmbalajeParaResumen[]): number {
  return redondear(
    embalajes.reduce((a, e) => (!e.anulado && Number.isFinite(e.pesoKg) && e.pesoKg > 0 ? a + e.pesoKg : a), 0)
  );
}

/** Resumen de un conjunto de kilos de stock frente a los embalajes que le tocan. */
export function resumirEmbalado(stockKg: number, embalajes: readonly EmbalajeParaResumen[]): ResumenEmbalado {
  const stock = redondear(Number.isFinite(stockKg) ? stockKg : 0);
  const marcado = sumaVigente(embalajes);
  const respaldado = Math.max(stock, 0);
  const embalado = redondear(Math.min(marcado, respaldado));
  const exceso = redondear(Math.max(marcado - respaldado, 0));
  return {
    stockKg: stock,
    embaladoMarcadoKg: marcado,
    embaladoKg: embalado,
    enSacaKg: redondear(Math.max(respaldado - embalado, 0)),
    embaladoMayorQueStock: exceso > TOLERANCIA_EMBALADO_KG,
    excesoKg: exceso > TOLERANCIA_EMBALADO_KG ? exceso : 0,
  };
}

/** Resumen por almacén: cada uno con su stock del lote y sus embalajes (los de almacén null no entran aquí). */
export function resumirEmbaladoPorAlmacen(
  stockPorAlmacen: ReadonlyArray<{ almacenId: string; stockKg: number }>,
  embalajes: readonly EmbalajeParaResumen[]
): ResumenEmbaladoAlmacen[] {
  const almacenes = new Set([
    ...stockPorAlmacen.map(s => s.almacenId),
    ...embalajes.filter(e => !e.anulado && e.almacenId).map(e => e.almacenId as string),
  ]);
  return [...almacenes].sort().map(almacenId => ({
    almacenId,
    ...resumirEmbalado(
      stockPorAlmacen.find(s => s.almacenId === almacenId)?.stockKg ?? 0,
      embalajes.filter(e => e.almacenId === almacenId)
    ),
  }));
}
