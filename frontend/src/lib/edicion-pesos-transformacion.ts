/**
 * Cálculo en pantalla de la edición de pesos de una transformación (neto, merma
 * y validación) antes de guardar. Duplicado intencional de
 * backend/src/utils/edicion-pesos-transformacion.ts (el frontend no importa del
 * backend). El servidor y la BD vuelven a validar: si se cambia una regla,
 * cambiar las tres.
 */

export interface PesosEntrada { pesoBruto: number; tara: number }

const TOLERANCIA_BALANCE_KG = 0.01;

const redondear = (n: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export const netoDe = (pesoBruto: number, tara: number): number => redondear(pesoBruto - tara, 4) + 0;

export function calcularMermaEdicion(entrada: PesosEntrada, salidas: ReadonlyArray<PesosEntrada>) {
  const netoEntrada = netoDe(entrada.pesoBruto, entrada.tara);
  const totalSalidas = redondear(salidas.reduce((a, s) => a + netoDe(s.pesoBruto, s.tara), 0), 4) + 0;
  return { netoEntrada, totalSalidas, merma: redondear(netoEntrada - totalSalidas, 4) + 0 };
}

const esValido = (n: number): boolean => Number.isFinite(n) && n >= 0;

/** Mensaje de error si los pesos son incoherentes; null si cuadran. */
export function validarPesosEdicion(entrada: PesosEntrada, salidas: ReadonlyArray<PesosEntrada>): string | null {
  if (![entrada, ...salidas].every(p => esValido(p.pesoBruto) && esValido(p.tara))) {
    return 'Peso bruto o tara inválidos: deben ser números mayores o iguales a 0.';
  }
  const { netoEntrada, totalSalidas } = calcularMermaEdicion(entrada, salidas);
  if (netoEntrada <= 0) return 'El peso neto de entrada debe ser mayor a 0.';
  if (salidas.some(s => redondear(netoDe(s.pesoBruto, s.tara), 2) <= 0)) {
    return 'El peso neto de cada salida debe ser mayor a 0.';
  }
  if (totalSalidas > redondear(netoEntrada + TOLERANCIA_BALANCE_KG, 4)) {
    return `Las salidas suman ${totalSalidas.toFixed(2)} kg y superan el peso neto de entrada (${netoEntrada.toFixed(2)} kg).`;
  }
  return null;
}
