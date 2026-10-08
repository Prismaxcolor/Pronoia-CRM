/**
 * Formato es-VE y fechas relativas para BLOB.
 *
 * Los modelos pequeños se equivocan al dar formato a las cifras (p. ej. "9,87 toneladas" en vez de
 * "9.871,2 kg"), así que las herramientas devuelven también el texto ya formateado y el modelo solo
 * lo copia. Miles con punto, decimales con coma, kg como unidad.
 */

/** Número con miles en punto y decimales en coma; `decimales` es el máximo (o el exacto con `fijos`). */
export function formatearNumero(valor: unknown, decimales = 2, fijos = false): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '0';
  const f = 10 ** decimales;
  const redondeado = Math.round((Math.abs(n) + Number.EPSILON) * f) / f;
  const [entera = '0', frac = ''] = (fijos ? redondeado.toFixed(decimales) : String(redondeado)).split('.');
  const conMiles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const signo = n < 0 && redondeado !== 0 ? '-' : '';
  return `${signo}${conMiles}${frac ? `,${frac}` : ''}`;
}

/** "9.871,2 kg" (hasta 2 decimales, sin ceros sobrantes). */
export const formatearKg = (kg: unknown): string => `${formatearNumero(kg, 2)} kg`;

/** "USD 1.234,50" (siempre 2 decimales); el signo negativo va delante: "-USD 20,00". */
export function formatearMonto(monto: unknown, moneda = 'USD'): string {
  const texto = formatearNumero(monto, 2, true);
  return texto.startsWith('-') ? `-${moneda} ${texto.slice(1)}` : `${moneda} ${texto}`;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export interface RangosRelativos {
  hoy: string;
  diaSemana: string;
  ayer: string;
  /** Lunes de la semana en curso. */
  semanaDesde: string;
  mesDesde: string;
  mesPasadoDesde: string;
  mesPasadoHasta: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Rangos para "hoy", "ayer", "esta semana" (lunes a hoy), "este mes" y "el mes pasado". */
export function rangosRelativos(hoy: string): RangosRelativos {
  const [a, m, d] = hoy.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(a, m - 1, d));
  const dow = base.getUTCDay();
  const dia = (delta: number) => iso(new Date(Date.UTC(a, m - 1, d + delta)));
  return {
    hoy,
    diaSemana: DIAS[dow]!,
    ayer: dia(-1),
    semanaDesde: dia(-((dow + 6) % 7)),
    mesDesde: iso(new Date(Date.UTC(a, m - 1, 1))),
    mesPasadoDesde: iso(new Date(Date.UTC(a, m - 2, 1))),
    mesPasadoHasta: iso(new Date(Date.UTC(a, m - 1, 0))),
  };
}
