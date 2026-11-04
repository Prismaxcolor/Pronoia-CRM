/**
 * Cálculo de pesos del packing list. Duplicado intencional de frontend/src/lib/packing-list.ts
 * (el frontend no importa del backend). Si se cambia uno, cambiar el otro.
 */

export interface PesosItem {
  pesoBruto: number;
  pesoPaleta: number;
}

export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Neto = bruto − tara de la paleta. */
export function calcularNeto(pesoBruto: number, pesoPaleta: number): number {
  return redondear2(pesoBruto - pesoPaleta);
}

export function totalNeto(items: readonly PesosItem[]): number {
  return redondear2(items.reduce((acc, i) => acc + calcularNeto(i.pesoBruto, i.pesoPaleta), 0));
}
