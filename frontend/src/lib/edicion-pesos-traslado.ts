/**
 * Validación en pantalla de la edición de pesos de un traslado. Duplicado
 * intencional de backend/src/utils/edicion-pesos-traslado.ts (el frontend no
 * importa del backend); el servidor y la BD vuelven a validar.
 */

export interface LineaPesos {
  pesoBruto: number;
  tara: number;
  /** null mientras el traslado está pendiente. */
  pesoRecibido: number | null;
}

const TOLERANCIA_RECEPCION_KG = 0.01;

const redondear = (n: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export const netoLinea = (pesoBruto: number, tara: number): number => redondear(pesoBruto - tara, 4) + 0;

/** Mensaje de error si los pesos son incoherentes; null si cuadran. */
export function validarLineasTraslado(lineas: ReadonlyArray<LineaPesos>): string | null {
  for (const l of lineas) {
    const validos = Number.isFinite(l.pesoBruto) && l.pesoBruto >= 0 && Number.isFinite(l.tara) && l.tara >= 0
      && (l.pesoRecibido === null || Number.isFinite(l.pesoRecibido));
    if (!validos) return 'Peso bruto o tara inválidos: deben ser números mayores o iguales a 0.';
    const neto = netoLinea(l.pesoBruto, l.tara);
    if (redondear(neto, 2) <= 0) return 'El peso neto de cada línea debe ser mayor a 0.';
    if (l.pesoRecibido !== null) {
      if (l.pesoRecibido < 0) return 'El peso recibido no puede ser negativo.';
      if (redondear(l.pesoRecibido, 4) > redondear(neto + TOLERANCIA_RECEPCION_KG, 4)) {
        return `No se puede recibir más de lo que salió: ${neto.toFixed(2)} kg despachados.`;
      }
    }
  }
  return null;
}
