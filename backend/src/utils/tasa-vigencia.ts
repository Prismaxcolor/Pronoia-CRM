/** Hora de corte de las tasas oficiales (BCV/Euro): 7:00 AM de Caracas.
 *  Caracas es UTC-4 fijo (sin horario de verano), así que 7:00 AM = 11:00 UTC. */
const HORA_CORTE_UTC = 11;

/** Próximo corte de las 7:00 AM Caracas estrictamente posterior a la captura. */
export function proximoCorteOficial(capturadaEn: Date): Date {
  const corte = new Date(Date.UTC(
    capturadaEn.getUTCFullYear(),
    capturadaEn.getUTCMonth(),
    capturadaEn.getUTCDate(),
    HORA_CORTE_UTC,
  ));
  if (corte.getTime() <= capturadaEn.getTime()) {
    return new Date(Date.UTC(
      corte.getUTCFullYear(),
      corte.getUTCMonth(),
      corte.getUTCDate() + 1,
      HORA_CORTE_UTC,
    ));
  }
  return corte;
}

/** Una captura de la tasa oficial vale hasta el siguiente corte de las 7:00 AM
 *  de Caracas; desde esa hora está vencida y la primera petición pide la nueva. */
export function tasaOficialVigente(capturadaEn: Date, ahora: Date): boolean {
  return ahora.getTime() < proximoCorteOficial(capturadaEn).getTime();
}
