/** Coherencia entre `monto` (moneda de la cuenta), `montoUsd` y la tasa de una línea de pago o cobro.
 *  Función pura: la lectura de tasas vigentes vive en services/montos-pago-service.ts. */

/** Desviación máxima tolerada entre la tasa implícita (monto / montoUsd) y el rango de las tasas vigentes
 *  (BCV y Binance): cubre una tasa manual pactada con un cambista, pero atrapa un cero de más. */
export const TOLERANCIA_TASA_IMPLICITA = 0.25;
/** Desviación máxima tolerada cuando la línea trae su propia tasa explícita (solo el redondeo a centavos). */
export const TOLERANCIA_TASA_EXPLICITA = 0.01;
/** Diferencia máxima entre monto y montoUsd en una cuenta en USD (redondeo a centavos). */
export const TOLERANCIA_USD_CENTAVOS = 0.01;
/** Margen para el error de coma flotante al comparar importes (100.01 - 100 no es exactamente 0.01). */
const EPSILON_FLOTANTE = 1e-9;

export interface LineaMonto {
  monto: number;
  montoUsd: number;
  moneda: 'USD' | 'VES';
  /** Bs por USD que la persona pactó; si viene, es la referencia en lugar de las tasas vigentes. */
  tasa?: number | null;
}

export interface OpcionesCoherencia {
  /** Tasas vigentes (Bs por USD). Vacío = no se puede cruzar y solo se validan las reglas propias de la línea. */
  tasasVigentes: readonly number[];
  toleranciaImplicita?: number;
  toleranciaExplicita?: number;
}

const formatoTasa = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

function validarUsd(l: LineaMonto): string | null {
  if (Math.abs(l.monto - l.montoUsd) > TOLERANCIA_USD_CENTAVOS + EPSILON_FLOTANTE) {
    return `En una cuenta en dólares el monto en USD ($${l.montoUsd.toFixed(2)}) debe ser igual al monto ($${l.monto.toFixed(2)}).`;
  }
  return null;
}

function validarContraTasaExplicita(implicita: number, tasa: number, tolerancia: number): string | null {
  if (Math.abs(implicita - tasa) / tasa <= tolerancia) return null;
  return `El monto en Bs no corresponde a la tasa indicada (${formatoTasa(tasa)} Bs por USD): resulta en ${formatoTasa(implicita)} Bs por USD.`;
}

function validarContraTasasVigentes(implicita: number, vigentes: readonly number[], tolerancia: number): string | null {
  const minimo = Math.min(...vigentes) * (1 - tolerancia);
  const maximo = Math.max(...vigentes) * (1 + tolerancia);
  if (implicita >= minimo && implicita <= maximo) return null;
  return `El monto en Bs y el monto en USD implican una tasa de ${formatoTasa(implicita)} Bs por USD, fuera de lo razonable `
    + `(tasas vigentes entre ${formatoTasa(Math.min(...vigentes))} y ${formatoTasa(Math.max(...vigentes))} Bs, tolerancia ${Math.round(tolerancia * 100)}%). `
    + 'Revisa los montos.';
}

/** Devuelve el mensaje de rechazo (español) o null si la línea es coherente. */
export function validarCoherenciaMonto(l: LineaMonto, o: OpcionesCoherencia): string | null {
  if (l.moneda === 'USD') return validarUsd(l);
  if (l.montoUsd <= 0) return null; // el esquema ya exige montoUsd > 0 donde corresponde
  const implicita = l.monto / l.montoUsd;
  if (l.tasa && l.tasa > 0) return validarContraTasaExplicita(implicita, l.tasa, o.toleranciaExplicita ?? TOLERANCIA_TASA_EXPLICITA);
  if (o.tasasVigentes.length === 0) return null;
  return validarContraTasasVigentes(implicita, o.tasasVigentes, o.toleranciaImplicita ?? TOLERANCIA_TASA_IMPLICITA);
}
