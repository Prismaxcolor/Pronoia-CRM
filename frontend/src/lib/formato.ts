/** Formato es-VE unificado para toda la app: miles con punto, decimales con coma, unidad siempre visible.
 *  Lógica pura (sin React ni DOM) para poder probarla desde backend/tests.
 *  Los nombres históricos (formatearNumero, formatearKg, formatearUsd, formatearPct, esFechaIso) se re-exportan
 *  desde lib/inventario-nuevo.ts para no romper a quien ya los importa. */

/** Separador de miles "." y decimal "," (es-VE). Manual a propósito: Intl en es omite el separador en 4 cifras. */
export function formatearNumero(n: number, decimales = 0): string {
  if (!Number.isFinite(n)) return '—';
  const factor = 10 ** decimales;
  const redondeado = Math.round((Math.abs(n) + Number.EPSILON) * factor) / factor;
  const [entera, dec] = redondeado.toFixed(decimales).split('.');
  const conMiles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const signo = n < 0 && redondeado !== 0 ? '-' : '';
  return `${signo}${conMiles}${dec ? `,${dec}` : ''}`;
}

/** Kilos exactos: mínimo 2 decimales y hasta 3 si el dato los tiene (11,735). Nunca redondea a entero. */
export function formatearCantidadKg(n: number): string {
  const texto = formatearNumero(n, 3);
  return texto.endsWith('0') && texto.includes(',') ? texto.slice(0, -1) : texto;
}
export const formatearKg = (n: number): string => `${formatearCantidadKg(n)} kg`;
export const formatearKgDecimales = (n: number, decimales = 2): string => `${formatearNumero(n, decimales)} kg`;
export const formatearUsd = (n: number): string => `USD ${formatearNumero(n, 0)}`;
export const formatearUsdDecimales = (n: number, decimales = 2): string => `USD ${formatearNumero(n, decimales)}`;
export const formatearPct = (n: number, decimales = 1): string => `${formatearNumero(n, decimales)} %`;

/** Cambio con signo explícito: "+1,5", "-2", "0". Para deltas (no para totales). */
export function formatearDelta(n: number, decimales = 1): string {
  if (!Number.isFinite(n)) return '—';
  const base = formatearNumero(n, decimales);
  return n > 0 && base !== '0' && !base.startsWith('0,0') ? `+${base}` : base;
}

/** Número compacto para ejes y espacios chicos: 950, "1,2 mil", "3,4 M". Siempre es-VE. */
export function formatearCompacto(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const corto = (v: number, dec: number) => formatearNumero(v, Number.isInteger(Number(v.toFixed(dec))) ? 0 : dec);
  if (abs >= 1e6) return `${corto(n / 1e6, abs >= 1e7 ? 0 : 1)} M`;
  if (abs >= 1e4) return `${formatearNumero(n / 1e3, 0)} mil`;
  if (abs >= 1e3) return `${corto(n / 1e3, 1)} mil`;
  return formatearNumero(n, abs < 10 && !Number.isInteger(n) ? 1 : 0);
}

import { diaNegocio } from './fecha-negocio';

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha ISO "AAAA-MM-DD" válida (calendario real: rechaza 2026-02-31). */
export function esFechaIso(valor: string | null | undefined): valor is string {
  if (!valor || !FECHA_RE.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

const dosDigitos = (n: number) => String(n).padStart(2, '0');

/** Parte "AAAA-MM-DD" de un ISO (con o sin hora) o de un Date (según el reloj local). null si no es interpretable. */
function partesFecha(valor: string | Date | null | undefined): { a: string; m: string; d: string } | null {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return { a: String(valor.getFullYear()), m: dosDigitos(valor.getMonth() + 1), d: dosDigitos(valor.getDate()) };
  }
  if (typeof valor !== 'string') return null;
  // Un instante (timestamptz con Z u offset) se pasa al día de la zona de negocio; una fecha pura se toma tal cual.
  const dia = diaNegocio(valor) ?? valor.slice(0, 10);
  if (!esFechaIso(dia)) return null;
  return { a: dia.slice(0, 4), m: dia.slice(5, 7), d: dia.slice(8, 10) };
}

/** "04/10/2026". Fecha pura: tal cual. Instante (timestamptz): día en la zona de negocio (Caracas). Sin dato: "—". */
export function formatearFecha(valor: string | Date | null | undefined): string {
  const p = partesFecha(valor);
  return p ? `${p.d}/${p.m}/${p.a}` : '—';
}

/** "04/10" para ejes y espacios chicos. */
export function formatearFechaCorta(valor: string | Date | null | undefined): string {
  const p = partesFecha(valor);
  return p ? `${p.d}/${p.m}` : '—';
}

export {
  ZONA_NEGOCIO,
  hoyNegocio,
  diaNegocio,
  formatearFechaNegocio,
  formatearHoraNegocio,
  formatearFechaHora,
  fechaConHora,
  nombreYMomento,
  leyendaRegistro,
  leyendaUltimaEdicion,
} from './fecha-negocio';
