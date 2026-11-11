/** Lógica pura de la gestión de cuentas de la Wallet nueva (sin React): totales por moneda, saldos negativos,
 *  rutas y color de cada cuenta. Se prueba en backend/tests/wallet-cuentas-gestion.test.ts. */

import type { Banca, GrupoWallet } from '@shared/types/index.js';
import { hexDeColorGuardado } from '../../lib/color-banca';
import { defGrupo } from './wallet-grupos';

export interface TotalMoneda {
  moneda: string;
  total: number;
}

const ORDEN_MONEDAS = ['USD', 'VES'];
const LUMINANCIA_FONDO_CLARO = 0.6;

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function posicionMoneda(moneda: string): number {
  const i = ORDEN_MONEDAS.indexOf(moneda);
  return i === -1 ? ORDEN_MONEDAS.length : i;
}

/** Suma de saldos por moneda: USD, luego VES, luego las demás (alfabético). Nunca mezcla monedas. No muta la entrada. */
export function totalesPorMoneda(bancas: readonly Pick<Banca, 'saldo' | 'moneda'>[]): TotalMoneda[] {
  const mapa = new Map<string, number>();
  for (const b of bancas) mapa.set(b.moneda, (mapa.get(b.moneda) ?? 0) + b.saldo);
  return [...mapa.entries()]
    .map(([moneda, total]) => ({ moneda, total: redondear2(total) }))
    .sort((a, b) => posicionMoneda(a.moneda) - posicionMoneda(b.moneda) || a.moneda.localeCompare(b.moneda));
}

/** Cuentas activas con saldo menor que cero. */
export function conteoSaldosNegativos(bancas: readonly Pick<Banca, 'saldo' | 'archivada'>[]): number {
  return bancas.filter(b => !b.archivada && b.saldo < 0).length;
}

/** Registros filtrados por las cuentas dadas (o todos si no hay ninguna). */
export function rutaRegistros(ids: readonly string[]): string {
  return ids.length === 0 ? '/wallet/registros' : `/wallet/registros?banca=${ids.map(encodeURIComponent).join(',')}`;
}

export function rutaDetalleCuenta(id: string): string {
  return `/wallet/cuentas/${encodeURIComponent(id)}`;
}

export interface ColorCuenta {
  color: string;
  /** true si el texto sobre ese color debe ir oscuro para leerse. */
  textoOscuro: boolean;
}

function esClaro(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > LUMINANCIA_FONDO_CLARO;
}

/** Color de la cuenta: el suyo propio si lo tiene; si no, el de su grupo. */
export function colorCuenta(banca: Pick<Banca, 'color'>, grupo: GrupoWallet): ColorCuenta {
  const propio = hexDeColorGuardado(banca.color);
  if (propio) return { color: propio, textoOscuro: esClaro(propio) };
  const def = defGrupo(grupo);
  return { color: def.color, textoOscuro: def.textoOscuro === true };
}

/**
 * Desplazamiento (en el orden global de cuentas) para que `id` quede junto a su vecina del mismo grupo
 * en el sentido dado (-1 antes, +1 después). null si ya está en el extremo o no pertenece al grupo.
 * `grupo` debe ir en el mismo orden relativo que `orden`.
 */
export function desplazamientoEnGrupo(orden: readonly string[], grupo: readonly string[], id: string, sentido: -1 | 1): number | null {
  const pos = grupo.indexOf(id);
  const vecino = pos === -1 ? undefined : grupo[pos + sentido];
  if (vecino === undefined) return null;
  return orden.indexOf(vecino) - orden.indexOf(id);
}
