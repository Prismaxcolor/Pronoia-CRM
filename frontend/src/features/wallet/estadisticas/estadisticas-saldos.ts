/** Lógica pura de saldos y activos de Estadísticas (sin React). Los saldos en Bs se convierten con la tasa dada (Bs por USD);
 *  sin tasa NO se inventa un equivalente: la cuenta queda con usd null y se avisa. Se prueba en backend/tests/wallet-estadisticas.test.ts. */

import type { Banca, GrupoWallet } from '@shared/types/index.js';
import { usdDesdeBs } from '../../../../../shared/types/equivalente-usd.js';
import { hexDeColorGuardado } from '../../../lib/color-banca';
import { GRUPOS, defGrupo, grupoDeBanca, type DefGrupo } from '../wallet-grupos';
import { redondear2 } from './estadisticas-logica';

export interface SaldoCuenta {
  id: string;
  nombre: string;
  moneda: string;
  grupo: GrupoWallet;
  /** Color del grupo de la cuenta. */
  color: string;
  /** Color propio de la cuenta; si no tiene, el de su grupo. */
  colorCuenta: string;
  saldo: number;
  /** Equivalente en USD; null si es Bs sin tasa o una moneda sin conversión. */
  usd: number | null;
}

function usdDeSaldo(b: Pick<Banca, 'saldo' | 'moneda'>, tasa: number | null | undefined): number | null {
  if (b.moneda === 'USD') return b.saldo;
  return b.moneda === 'VES' ? usdDesdeBs(b.saldo, tasa) : null;
}

/** Color de una cuenta: el suyo (paleta u hex); si no tiene, el de su grupo. */
export function colorDeCuenta(b: Pick<Banca, 'color' | 'tipo' | 'grupoWallet'>): string {
  return hexDeColorGuardado(b.color) ?? defGrupo(grupoDeBanca(b)).color;
}

/** Cuentas activas con su equivalente en USD, de mayor a menor (las no convertibles al final). */
export function saldosPorCuenta(bancas: readonly Banca[], tasa: number | null | undefined): SaldoCuenta[] {
  return bancas
    .filter(b => !b.archivada)
    .map(b => {
      const grupo = grupoDeBanca(b);
      return { id: b.id, nombre: b.nombre, moneda: b.moneda, grupo, color: defGrupo(grupo).color, colorCuenta: colorDeCuenta(b), saldo: b.saldo, usd: usdDeSaldo(b, tasa) };
    })
    .sort((a, b) => (b.usd ?? -Infinity) - (a.usd ?? -Infinity) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Saldos y activos cuentan solo las cuentas no archivadas (las archivadas se cargan únicamente para nombrar movimientos viejos). */
export const soloCuentasActivas = <T extends Pick<Banca, 'archivada'>>(bancas: readonly T[]): T[] => bancas.filter(b => !b.archivada);

export const saldosNegativos = (filas: readonly SaldoCuenta[]): SaldoCuenta[] => filas.filter(f => f.saldo < 0);

export interface ParteMoneda {
  moneda: string;
  /** Suma de saldos en SU PROPIA moneda. */
  saldo: number;
  cuentas: number;
  /** Peso en el total en USD (solo saldos positivos); null si no hay tasa para calcularlo. */
  pct: number | null;
  usd: number | null;
}

export interface SaldoPorMoneda {
  partes: ParteMoneda[];
  /** Total en USD de las cuentas convertibles. */
  totalUsd: number;
  /** Cuentas que no entran en el total (Bs sin tasa u otra moneda). */
  omitidas: number;
}

const ORDEN_MONEDA = ['USD', 'VES'];

/** Saldos separados por moneda, cada uno en su unidad; la conversión solo sirve para el total y las proporciones. */
export function saldoPorMoneda(bancas: readonly Banca[], tasa: number | null | undefined): SaldoPorMoneda {
  const filas = saldosPorCuenta(bancas, tasa);
  const monedas = [...new Set(filas.map(f => f.moneda))].sort((a, b) => (ORDEN_MONEDA.indexOf(a) + 1 || 99) - (ORDEN_MONEDA.indexOf(b) + 1 || 99));
  const convertidas = monedas.map(m => {
    const propias = filas.filter(f => f.moneda === m);
    const usd = propias.every(f => f.usd !== null) ? redondear2(propias.reduce((s, f) => s + (f.usd as number), 0)) : null;
    return { moneda: m, saldo: redondear2(propias.reduce((s, f) => s + f.saldo, 0)), cuentas: propias.length, usd, positivo: propias.reduce((s, f) => s + Math.max(f.usd ?? 0, 0), 0) };
  });
  const base = convertidas.reduce((s, p) => s + p.positivo, 0);
  const todasConvertidas = convertidas.every(p => p.usd !== null);
  const partes = convertidas.map(({ positivo, ...p }) => ({ ...p, pct: todasConvertidas && base > 0 ? (positivo / base) * 100 : null }));
  const convertibles = filas.filter(f => f.usd !== null);
  return {
    partes,
    totalUsd: redondear2(convertibles.reduce((s, f) => s + (f.usd as number), 0)),
    omitidas: filas.length - convertibles.length,
  };
}

export interface CuentaActivo extends SaldoCuenta {
  /** Participación de la cuenta en el total de activos (%). */
  pct: number;
}

export interface GrupoActivos {
  grupo: DefGrupo;
  totalUsd: number;
  pct: number;
  cuentas: CuentaActivo[];
}

export interface ResumenActivos {
  /** Suma en USD de las cuentas con saldo positivo. */
  totalUsd: number;
  inversionesUsd: number;
  /** null si no hay activos positivos convertibles. */
  pctInversiones: number | null;
  grupos: GrupoActivos[];
  /** Cuentas con saldo negativo (no cuentan como activo). */
  negativas: number;
  /** Cuentas que no se pudieron convertir a USD. */
  omitidas: number;
}

/** Activos = cuentas con saldo positivo convertible a USD; el % de inversiones es el del grupo "inversiones" sobre ese total. */
export function resumenActivos(bancas: readonly Banca[], tasa: number | null | undefined): ResumenActivos {
  const filas = saldosPorCuenta(bancas, tasa);
  const activos = filas.filter(f => f.usd !== null && f.usd > 0);
  const totalUsd = redondear2(activos.reduce((s, f) => s + (f.usd as number), 0));
  const pct = (v: number): number => (totalUsd > 0 ? (v / totalUsd) * 100 : 0);
  const grupos = GRUPOS.map(grupo => {
    const cuentas = activos.filter(f => f.grupo === grupo.clave).map(f => ({ ...f, pct: pct(f.usd as number) }));
    const total = redondear2(cuentas.reduce((s, c) => s + (c.usd as number), 0));
    return { grupo, totalUsd: total, pct: pct(total), cuentas };
  }).filter(g => g.cuentas.length > 0);
  const inversionesUsd = grupos.find(g => g.grupo.clave === 'inversiones')?.totalUsd ?? 0;
  return {
    totalUsd,
    inversionesUsd,
    pctInversiones: totalUsd > 0 ? pct(inversionesUsd) : null,
    grupos,
    negativas: filas.filter(f => f.saldo < 0).length,
    omitidas: filas.filter(f => f.usd === null).length,
  };
}
