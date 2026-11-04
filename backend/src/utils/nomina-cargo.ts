/**
 * Cargo del trabajador: arma la lista de sus últimos movimientos de nómina (pagos de nómina, préstamos y adelantos, cuotas
 * y reversas) a partir de filas ya leídas. Lógica pura, sin base de datos.
 *
 * Los movimientos en Bs llevan su equivalente en USD a la tasa Binance CONGELADA en el pago (nomina_pagos.tasa_binance:
 * la del mediodía de Caracas del día del pago, o la captura anterior más cercana). El equivalente se calcula aquí con esa
 * tasa guardada, no con ninguna tasa de hoy, así que no cambia con el tiempo.
 */
import type {
  CargoTrabajador, EstadoMovimientoCargo, EstadoNomina, MovimientoCargo, TipoPrestamo,
} from '../../../shared/types/nomina.js';
import { diaNegocio, formatearFechaNegocio } from './fecha-negocio.js';
import { equivalenteUsdDeBs } from './nomina-calculo.js';

/** Cuántos movimientos se devuelven (los más recientes). */
export const LIMITE_MOVIMIENTOS_CARGO = 100;

export interface FilaLineaCargo {
  /** Id del renglón: ubica su pago individual (nomina_pagos.linea_id). */
  lineaId: string;
  nominaId: string;
  nominaNumero: number;
  /** Lunes de la semana (AAAA-MM-DD). */
  semanaInicio: string;
  estadoNomina: EstadoNomina;
  /** Instante del cierre; null si la nómina nunca se cerró (esas no son movimientos). */
  cerradaEn: string | null;
  pagarUsd: number;
  pagarBs: number | null;
}

export interface FilaPagoCargo {
  nominaId: string;
  /** Renglón al que se pagó (pago individual); null si es el pago de toda la nómina. */
  lineaId: string | null;
  monedaPago: 'USD' | 'BS';
  fecha: string;
  /** El egreso del Wallet fue anulado (se anula junto con la nómina). */
  anulado: boolean;
  tasaBinance: number | null;
  tasaBinanceCapturada: string | null;
}

export interface FilaPrestamoCargo {
  id: string;
  numero: number;
  tipo: TipoPrestamo;
  montoUsd: number;
  saldoUsd: number;
  fecha: string;
  estado: 'ACTIVO' | 'PAGADO' | 'ANULADO';
}

export interface FilaCuotaCargo {
  id: string;
  tipo: 'CUOTA' | 'REVERSA';
  montoUsd: number;
  creadoEn: string;
  prestamoNumero: number;
  nominaNumero: number;
}

export interface EntradaCargo {
  lineas: readonly FilaLineaCargo[];
  pagos: readonly FilaPagoCargo[];
  prestamos: readonly FilaPrestamoCargo[];
  cuotas: readonly FilaCuotaCargo[];
}

const centavos = (n: number): number => Math.round(n * 100);

// Mismo formato que formatearNumeroNomina / formatearNumeroPrestamo de shared/types/nomina.ts (el backend no importa
// valores de shared: su build solo compila src/).
const numeroNomina = (n: number): string => `NOM-${String(n).padStart(4, '0')}`;
const numeroPrestamo = (n: number): string => `PRE-${String(n).padStart(4, '0')}`;

const conceptoNomina = (numero: number, semana: string): string =>
  `${numeroNomina(numero)} · semana del ${formatearFechaNegocio(semana)}`;

function estadoDePago(l: FilaLineaCargo, pago: FilaPagoCargo | undefined): EstadoMovimientoCargo {
  if (l.estadoNomina === 'ANULADA' || pago?.anulado) return 'ANULADO';
  return pago ? 'PAGADO' : 'PENDIENTE';
}

function movimientoDeLinea(
  l: FilaLineaCargo, moneda: 'USD' | 'BS', monto: number, pago: FilaPagoCargo | undefined,
): MovimientoCargo {
  const estado = estadoDePago(l, pago);
  const congelado = moneda === 'BS' && estado === 'PAGADO' && pago?.tasaBinance != null;
  return {
    id: `nomina-${l.nominaId}-${moneda}`,
    tipo: moneda === 'USD' ? 'PAGO_DIVISAS' : 'PAGO_BS',
    fecha: pago?.fecha ?? diaNegocio(l.cerradaEn) ?? l.semanaInicio,
    concepto: conceptoNomina(l.nominaNumero, l.semanaInicio),
    estado,
    montoUsd: moneda === 'USD' ? monto : null,
    montoBs: moneda === 'BS' ? monto : null,
    equivalenteUsd: congelado && pago?.tasaBinance ? equivalenteUsdDeBs(monto, pago.tasaBinance) : null,
    tasaBinance: congelado ? pago?.tasaBinance ?? null : null,
    tasaBinanceCapturada: congelado ? pago?.tasaBinanceCapturada ?? null : null,
  };
}

/** Movimientos de las nóminas cerradas (o anuladas después de cerrarse): una parte en divisas y/o una en Bs. */
function movimientosDeNomina(lineas: readonly FilaLineaCargo[], pagos: readonly FilaPagoCargo[]): MovimientoCargo[] {
  // El pago de la nómina completa cubre a todos sus renglones; el individual solo al suyo.
  const pagoDe = (l: FilaLineaCargo, moneda: 'USD' | 'BS') =>
    pagos.find(p => p.nominaId === l.nominaId && p.monedaPago === moneda && (p.lineaId === null || p.lineaId === l.lineaId));
  return lineas.filter(l => l.cerradaEn !== null).flatMap(l => [
    ...(l.pagarUsd > 0 ? [movimientoDeLinea(l, 'USD', l.pagarUsd, pagoDe(l, 'USD'))] : []),
    ...(l.pagarBs !== null && l.pagarBs > 0 ? [movimientoDeLinea(l, 'BS', l.pagarBs, pagoDe(l, 'BS'))] : []),
  ]);
}

function movimientoDePrestamo(p: FilaPrestamoCargo): MovimientoCargo {
  return {
    id: `prestamo-${p.id}`,
    tipo: p.tipo,
    fecha: p.fecha,
    concepto: numeroPrestamo(p.numero),
    estado: p.estado === 'ANULADO' ? 'ANULADO' : p.estado === 'PAGADO' ? 'PAGADO' : 'VIGENTE',
    montoUsd: p.montoUsd,
    montoBs: null,
    equivalenteUsd: null,
    tasaBinance: null,
    tasaBinanceCapturada: null,
  };
}

function movimientoDeCuota(c: FilaCuotaCargo): MovimientoCargo {
  return {
    id: `cuota-${c.id}`,
    tipo: c.tipo,
    fecha: diaNegocio(c.creadoEn) ?? c.creadoEn.slice(0, 10),
    concepto: `${numeroPrestamo(c.prestamoNumero)} · ${numeroNomina(c.nominaNumero)}`,
    estado: 'VIGENTE',
    montoUsd: c.montoUsd,
    montoBs: null,
    equivalenteUsd: null,
    tasaBinance: null,
    tasaBinanceCapturada: null,
  };
}

/** Del más reciente al más antiguo; a igual fecha, por id para que el orden sea estable. */
function masReciente(a: MovimientoCargo, b: MovimientoCargo): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function armarCargo(entrada: EntradaCargo): Pick<CargoTrabajador, 'movimientos' | 'saldoPrestamosUsd'> {
  const movimientos = [
    ...movimientosDeNomina(entrada.lineas, entrada.pagos),
    ...entrada.prestamos.map(movimientoDePrestamo),
    ...entrada.cuotas.map(movimientoDeCuota),
  ].sort(masReciente).slice(0, LIMITE_MOVIMIENTOS_CARGO);
  const saldo = entrada.prestamos.filter(p => p.estado === 'ACTIVO').reduce((a, p) => a + centavos(p.saldoUsd), 0);
  return { movimientos, saldoPrestamosUsd: saldo / 100 };
}
