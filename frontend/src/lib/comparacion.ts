/** Comparación de un valor contra el del periodo anterior, con semántica bueno/malo (lógica pura). La usa TarjetaKpi.
 *  Se re-exporta desde lib/inventario-nuevo.ts para no romper importadores. */

export type TonoComparacion = 'bueno' | 'malo' | 'neutro';
export type MejorCuando = 'sube' | 'baja';

export interface ComparacionPeriodo {
  direccion: 'sube' | 'baja' | 'igual';
  delta: number;
  /** null si el periodo anterior era 0 (no se puede dividir). */
  deltaPct: number | null;
  tono: TonoComparacion;
}

const EPS_IGUAL = 1e-9;

/** Compara el valor actual con el del periodo anterior. Sin dato anterior (null/undefined/NaN) devuelve null:
 *  la pantalla muestra "—" y no inventa nada. */
export function compararConPeriodoAnterior(
  actual: number,
  anterior: number | null | undefined,
  mejorCuando: MejorCuando,
): ComparacionPeriodo | null {
  if (anterior == null || !Number.isFinite(anterior) || !Number.isFinite(actual)) return null;
  const delta = actual - anterior;
  if (Math.abs(delta) < EPS_IGUAL) return { direccion: 'igual', delta: 0, deltaPct: anterior === 0 ? null : 0, tono: 'neutro' };
  const direccion = delta > 0 ? 'sube' : 'baja';
  const deltaPct = anterior === 0 ? null : (delta / Math.abs(anterior)) * 100;
  const esBueno = (direccion === 'sube') === (mejorCuando === 'sube');
  return { direccion, delta, deltaPct, tono: esBueno ? 'bueno' : 'malo' };
}
