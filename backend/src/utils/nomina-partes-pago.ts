type Fila = Record<string, unknown>;

const numeroONull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * Lo que se paga de un renglón en cada moneda. Los renglones anteriores a los dos sueldos (migration_nomina_dos_sueldos.sql)
 * se pagaban enteros en UNA moneda: si la migración aún no los migró, se deduce de su moneda de pago.
 */
export function partesDePago(row: Fila): { pagarUsd: number; pagarBs: number | null; equivalenteBsUsd: number | null } {
  if (row.pagar_usd != null) {
    const pagarBs = numeroONull(row.pagar_bs);
    return { pagarUsd: Number(row.pagar_usd), pagarBs, equivalenteBsUsd: pagarBs === null ? null : Math.round((Number(row.total_usd) - Number(row.pagar_usd)) * 100) / 100 };
  }
  const enBs = row.moneda_pago === 'BS';
  return {
    pagarUsd: enBs ? 0 : Number(row.total_usd),
    pagarBs: enBs ? numeroONull(row.total_bs) : 0,
    equivalenteBsUsd: enBs ? Number(row.total_usd) : 0,
  };
}
