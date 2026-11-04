/**
 * Cálculo puro de la ganancia de una transformación:
 *   ganancia = Σ(peso neto de salida × precio de salida) − (peso de entrada × costo unitario)
 *
 * Duplicado intencional de backend/src/utils/ganancia-transformacion.ts (el
 * frontend no importa del backend). Si se cambia una, cambiar la otra.
 */

export interface SalidaValorada {
  pesoNeto: number;
  precioUnitario: number | null;
}

export interface ResultadoGanancia {
  valorSalidas: number;
  costo: number | null;
  ganancia: number | null;
  completo: boolean;
}

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const esPrecio = (p: number | null): p is number => typeof p === 'number' && Number.isFinite(p);

export function calcularGananciaTransformacion(
  pesoEntrada: number,
  costoUnitario: number | null,
  salidas: SalidaValorada[]
): ResultadoGanancia {
  const valorSalidas = redondear2(
    salidas.reduce((acc, s) => (esPrecio(s.precioUnitario) ? acc + s.pesoNeto * s.precioUnitario : acc), 0)
  );
  const costo = esPrecio(costoUnitario) ? redondear2(pesoEntrada * costoUnitario) : null;
  const completo = costo !== null && salidas.length > 0 && salidas.every(s => esPrecio(s.precioUnitario));
  return { valorSalidas, costo, ganancia: completo ? redondear2(valorSalidas - (costo as number)) : null, completo };
}
