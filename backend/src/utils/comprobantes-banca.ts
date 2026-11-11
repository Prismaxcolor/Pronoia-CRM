/** Comprobantes de un pago/cobro repartido entre varias bancas: cada banca puede traer los suyos además de los generales. */

interface BancaConComprobantes {
  bancaId: string;
  comprobantes?: readonly string[];
}

/** Comprobantes propios de cada banca; las que no traen ninguno se omiten. */
export function comprobantesPorBanca(bancas: readonly BancaConComprobantes[]): Array<{ bancaId: string; comprobantes: string[] }> {
  return bancas
    .map(b => ({ bancaId: b.bancaId, comprobantes: [...new Set(b.comprobantes ?? [])] }))
    .filter(b => b.comprobantes.length > 0);
}

/** Generales + los de cada banca, sin repetidos y en ese orden: lo que se reenvía (Telegram, portal) de la operación. */
export function todosLosComprobantes(generales: readonly string[], bancas: readonly BancaConComprobantes[]): string[] {
  return [...new Set([...generales, ...bancas.flatMap(b => b.comprobantes ?? [])])];
}
