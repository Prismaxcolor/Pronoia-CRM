/** Lógica pura de la Wallet nueva (sin React): grupos de cuentas, formato de montos y totales en USD.
 *  Se prueba en backend/tests/wallet-grupos.test.ts. Solo presentación: no toca saldos ni reglas de negocio. */

import type { Banca, GrupoWallet, TipoBanca } from '@shared/types/index.js';
import { usdDesdeBs } from '../../../../shared/types/equivalente-usd.js';
import { formatearNumero } from '../../lib/formato';

export interface DefGrupo {
  clave: GrupoWallet;
  etiqueta: string;
  /** Color del ícono de las cuentas del grupo. */
  color: string;
  /** true si el texto sobre ese color debe ir oscuro para leerse (fondos claros como el ámbar). */
  textoOscuro?: boolean;
}

/** Orden en que se muestran los grupos. */
export const GRUPOS: readonly DefGrupo[] = [
  { clave: 'efectivo', etiqueta: 'Efectivo', color: '#43A047' },
  { clave: 'corriente', etiqueta: 'Cuenta corriente', color: '#6D4C41' },
  { clave: 'ahorros', etiqueta: 'Cuenta de ahorros', color: '#AB47BC' },
  { clave: 'inversiones', etiqueta: 'Inversiones', color: '#039BE5' },
  { clave: 'general', etiqueta: 'Cuenta general', color: '#FFB300', textoOscuro: true },
];

const GRUPO_POR_TIPO: Record<TipoBanca, GrupoWallet> = {
  efectivo: 'efectivo',
  banco_nacional: 'corriente',
  banco_internacional: 'corriente',
  exchange: 'general',
};

/** Grupo guardado de la cuenta; si no tiene, se deduce del tipo. */
export function grupoDeBanca(banca: Pick<Banca, 'tipo' | 'grupoWallet'>): GrupoWallet {
  return banca.grupoWallet ?? GRUPO_POR_TIPO[banca.tipo] ?? 'general';
}

export function defGrupo(clave: GrupoWallet): DefGrupo {
  return GRUPOS.find(g => g.clave === clave) ?? GRUPOS[GRUPOS.length - 1];
}

export interface SeccionGrupo {
  grupo: DefGrupo;
  cuentas: Banca[];
}

/** Agrupa las cuentas en el orden de GRUPOS (omite los grupos vacíos) y conserva el orden recibido dentro de cada grupo. */
export function agruparCuentas(bancas: readonly Banca[]): SeccionGrupo[] {
  return GRUPOS
    .map(grupo => ({ grupo, cuentas: bancas.filter(b => grupoDeBanca(b) === grupo.clave) }))
    .filter(s => s.cuentas.length > 0);
}

/** "$", "Bs" o el código de la moneda. */
export function simboloMoneda(moneda: string): string {
  return moneda === 'USD' ? '$' : moneda === 'VES' ? 'Bs' : moneda;
}

/** Monto con su unidad y el signo delante: "$1.234,50", "-$97,00", "Bs 67.886,50". */
export function formatearMonto(monto: number, moneda: string): string {
  const simbolo = simboloMoneda(moneda);
  const numero = formatearNumero(Math.abs(monto), 2);
  const signo = monto < 0 && formatearNumero(monto, 2) !== '0,00' ? '-' : '';
  return simbolo.length > 1 ? `${signo}${simbolo} ${numero}` : `${signo}${simbolo}${numero}`;
}

/** Texto que reemplaza a un monto cuando se ocultan las cantidades. */
export const MONTO_OCULTO = '••••••';

export interface TotalUsd {
  totalUsd: number;
  /** Cuentas que no entran en la suma (Bs sin tasa disponible u otra moneda). */
  omitidas: number;
}

/**
 * Suma de saldos en USD: las cuentas en USD tal cual y las de Bs a la tasa dada (Bs por USD).
 * Una cuenta que no se puede convertir no se inventa: se cuenta en `omitidas`.
 */
export function totalEnUsd(bancas: readonly Pick<Banca, 'saldo' | 'moneda'>[], tasaBsPorUsd: number | null | undefined): TotalUsd {
  let totalUsd = 0;
  let omitidas = 0;
  for (const b of bancas) {
    if (b.moneda === 'USD') { totalUsd += b.saldo; continue; }
    const usd = b.moneda === 'VES' ? usdDesdeBs(b.saldo, tasaBsPorUsd) : null;
    if (usd === null) omitidas += 1; else totalUsd += usd;
  }
  return { totalUsd: Math.round((totalUsd + Number.EPSILON) * 100) / 100, omitidas };
}
