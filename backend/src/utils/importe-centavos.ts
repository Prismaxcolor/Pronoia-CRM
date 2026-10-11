/** Importes de dinero a centavos (2 decimales). */

const TOLERANCIA_FLOTANTE = 1e-6;

/** True si el número no tiene más de 2 decimales (tolera el error de coma flotante: 0.1 + 0.2). */
export function tieneMaximoDosDecimales(n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const centavos = n * 100;
  return Math.abs(centavos - Math.round(centavos)) < TOLERANCIA_FLOTANTE * Math.max(1, Math.abs(centavos));
}

export const MENSAJE_MAXIMO_DOS_DECIMALES = 'Usa como máximo 2 decimales (centavos).';
