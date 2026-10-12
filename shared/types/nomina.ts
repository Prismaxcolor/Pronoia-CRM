/**
 * Nómina: personal (administrativo / operativo), nómina semanal por tipo y préstamos/adelantos.
 * Fase 1: solo registro y cálculo; no mueve dinero ni toca Wallet.
 *
 * Son DATOS PERSONALES SENSIBLES: solo salen por /api/nomina/* con el permiso de módulo 'nomina'.
 * Las fórmulas viven en backend/src/utils/nomina-calculo.ts (copia para la vista previa: ./nomina-calculo.ts).
 */
import type { MonedaLinea, MonedaPago, TotalesNomina } from './nomina-calculo.js';

export type { MonedaLinea, MonedaPago, TotalesNomina };

export const TIPOS_TRABAJADOR = ['ADMINISTRATIVO', 'OPERATIVO'] as const;
export type TipoTrabajador = (typeof TIPOS_TRABAJADOR)[number];

export const ETIQUETA_TIPO_TRABAJADOR: Record<TipoTrabajador, string> = {
  ADMINISTRATIVO: 'Personal administrativo',
  OPERATIVO: 'Personal operativo',
};

export const ETIQUETA_MONEDA_PAGO: Record<MonedaPago, string> = {
  USD: 'Divisas (USD)',
  BS: 'Bolívares (Bs)',
};

export const ETIQUETA_MONEDA_LINEA: Record<MonedaLinea, string> = {
  USD: 'Divisas',
  BS: 'Bolívares',
  MIXTO: 'Divisas y Bs',
};

export interface Trabajador {
  id: string;
  tipo: TipoTrabajador;
  nombres: string;
  apellidos: string;
  cedula: string;
  rif: string | null;
  telefono: string | null;
  direccion: string | null;
  contactoEmergenciaNombre: string | null;
  contactoEmergenciaTelefono: string | null;
  pagoMovilBanco: string | null;
  pagoMovilTelefono: string | null;
  pagoMovilCedula: string | null;
  binanceCorreoId: string | null;
  /** Sueldo diario en divisas (USD): la parte que se paga en efectivo o Binance. */
  pagoDiarioUsd: number;
  /** Sueldo diario en bolívares (Bs): la otra parte del sueldo, pagada en Bs. */
  pagoDiarioBs: number;
  activo: boolean;
  creadoEn: string;
}

export const TIPOS_PRESTAMO = ['PRESTAMO', 'ADELANTO'] as const;
export type TipoPrestamo = (typeof TIPOS_PRESTAMO)[number];
export type EstadoPrestamo = 'ACTIVO' | 'PAGADO' | 'ANULADO';

export const ETIQUETA_TIPO_PRESTAMO: Record<TipoPrestamo, string> = { PRESTAMO: 'Préstamo', ADELANTO: 'Adelanto' };
export const ETIQUETA_ESTADO_PRESTAMO: Record<EstadoPrestamo, string> = { ACTIVO: 'Activo', PAGADO: 'Pagado', ANULADO: 'Anulado' };

export interface Prestamo {
  id: string;
  numero: number;
  trabajadorId: string;
  trabajadorNombre: string;
  tipo: TipoPrestamo;
  montoUsd: number;
  /** Lo que falta por descontar, en USD. */
  saldoUsd: number;
  cuotaSemanalUsd: number | null;
  fecha: string;
  nota: string | null;
  estado: EstadoPrestamo;
  anuladoMotivo: string | null;
}

export type EstadoNomina = 'BORRADOR' | 'CERRADA' | 'ANULADA';
export const ETIQUETA_ESTADO_NOMINA: Record<EstadoNomina, string> = { BORRADOR: 'Borrador', CERRADA: 'Cerrada', ANULADA: 'Anulada' };

export interface CuotaLinea {
  prestamoId: string;
  prestamoNumero: number;
  montoUsd: number;
}

export interface LineaNomina {
  trabajadorId: string;
  trabajadorNombre: string;
  /** Cómo cobra esa semana: solo divisas, solo Bs o las dos partes (la deduce el servidor de los montos a pagar). */
  monedaPago: MonedaLinea;
  diasTrabajados: number;
  /** Sueldo diario en divisas (USD) de esa semana. */
  montoBaseUsd: number;
  /** Sueldo diario en Bs de esa semana. */
  montoBaseBs: number;
  /** Bruto total en USD (divisas + Bs / tasa). */
  totalBrutoUsd: number;
  brutoBs: number;
  montoRefBs: number | null;
  bonificacionUsd: number;
  descuentoTrabajoUsd: number;
  descuentoPrestamoUsd: number;
  /** Lo que se paga en divisas (USD). */
  pagarUsd: number;
  /** Lo que se paga en Bs; null si no hay tasa. */
  pagarBs: number | null;
  /** Lo que valen en USD los Bs a pagar (a la tasa de la nómina). */
  equivalenteBsUsd: number | null;
  totalUsd: number;
  totalBs: number | null;
  nota: string | null;
  cuotas: CuotaLinea[];
}

/**
 * Pago (fase 2) de una nómina cerrada desde el Wallet: un egreso por moneda de pago. No lleva datos personales:
 * solo la cuenta, los montos y el movimiento del Wallet.
 */
export interface PagoNomina {
  id: string;
  monedaPago: MonedaPago;
  bancaId: string;
  bancaNombre: string;
  /** Egreso del Wallet que pagó este grupo (enlace al detalle del movimiento). */
  movimientoId: string;
  /** Correlativo MV del egreso; null si la migración del correlativo no estaba aplicada. */
  movimientoNumero: number | null;
  /** true si el egreso fue anulado (se anula junto con la nómina). */
  anulado: boolean;
  /** Monto en la moneda de la cuenta (USD o Bs). */
  monto: number;
  montoUsd: number;
  cantidad: number;
  fecha: string;
  referencia: string | null;
  pagadoEn: string;
  /**
   * Solo pagos en Bs: tasa Binance (Bs por USD) vigente al mediodía de Caracas del día del pago, congelada al pagar
   * (o la captura anterior más cercana; ver `tasaBinanceCapturada`). null si no había ninguna o el pago es en USD.
   */
  tasaBinance: number | null;
  /** Momento en que se capturó esa tasa (ISO). Si no es del mismo día del pago, la pantalla lo avisa. */
  tasaBinanceCapturada: string | null;
  /** Monto en Bs / tasa Binance, al centavo; null si no hay tasa. */
  equivalenteBinanceUsd: number | null;
}

export interface Nomina {
  id: string;
  numero: number;
  tipo: TipoTrabajador;
  /** Lunes de la semana (AAAA-MM-DD). */
  semanaInicio: string;
  tasaBs: number | null;
  estado: EstadoNomina;
  /** Sube en cada guardado: evita pisar los cambios de otra persona. */
  version: number;
  totales: TotalesNomina;
  lineas: LineaNomina[];
  cerradaEn: string | null;
  anuladaMotivo: string | null;
  anuladaEn: string | null;
  /** Pagos desde el Wallet (vacío mientras no se haya pagado). */
  pagos: PagoNomina[];
}

export interface NominaResumen {
  id: string;
  numero: number;
  tipo: TipoTrabajador;
  semanaInicio: string;
  tasaBs: number | null;
  estado: EstadoNomina;
  totales: TotalesNomina;
}

export interface PrestamoCandidato {
  id: string;
  numero: number;
  tipo: TipoPrestamo;
  saldoUsd: number;
  cuotaSemanalUsd: number | null;
  cuotaSugeridaUsd: number;
}

/** Trabajador activo que se puede agregar a la nómina de una semana, con lo que el formulario necesita para proponer los montos. */
export interface CandidatoNomina {
  trabajadorId: string;
  nombre: string;
  /** Sueldo diario en divisas (USD) de la ficha. */
  pagoDiarioUsd: number;
  /** Sueldo diario en Bs de la ficha. */
  pagoDiarioBs: number;
  prestamos: PrestamoCandidato[];
}

export interface NominaSemana {
  nomina: Nomina | null;
  candidatos: CandidatoNomina[];
}

export function formatearNumeroNomina(numero: number): string {
  return `NOM-${String(numero).padStart(4, '0')}`;
}

export function formatearNumeroPrestamo(numero: number): string {
  return `PRE-${String(numero).padStart(4, '0')}`;
}

export function nombreCompleto(t: { nombres: string; apellidos: string }): string {
  return `${t.nombres} ${t.apellidos}`.trim();
}

// --- Cargo del trabajador (últimos movimientos) -----------------------------------------------------------------------

export type TipoMovimientoCargo = 'PAGO_DIVISAS' | 'PAGO_BS' | 'PRESTAMO' | 'ADELANTO' | 'CUOTA' | 'REVERSA';

export const ETIQUETA_MOVIMIENTO_CARGO: Record<TipoMovimientoCargo, string> = {
  PAGO_DIVISAS: 'Pago de nómina en divisas',
  PAGO_BS: 'Pago de nómina en bolívares',
  PRESTAMO: 'Préstamo',
  ADELANTO: 'Adelanto',
  CUOTA: 'Cuota de préstamo',
  REVERSA: 'Reversa de cuota',
};

/** PENDIENTE: nómina cerrada y aún sin pagar desde el Wallet. ANULADO: la nómina o el préstamo se anularon. */
export type EstadoMovimientoCargo = 'PAGADO' | 'PENDIENTE' | 'VIGENTE' | 'ANULADO';

/**
 * Un movimiento del cargo del trabajador. Los de Bs llevan su equivalente en USD a la tasa Binance congelada al pagar
 * (`equivalenteUsd`); los de USD no necesitan conversión.
 */
export interface MovimientoCargo {
  /** Clave estable para la lista. */
  id: string;
  tipo: TipoMovimientoCargo;
  /** AAAA-MM-DD. */
  fecha: string;
  /** Texto corto sin datos personales: «NOM-0007 · semana del 05/10/2026», «PRE-0002», etc. */
  concepto: string;
  estado: EstadoMovimientoCargo;
  montoUsd: number | null;
  montoBs: number | null;
  /** Solo movimientos en Bs ya pagados: montoBs / tasaBinance. */
  equivalenteUsd: number | null;
  tasaBinance: number | null;
  tasaBinanceCapturada: string | null;
}

export interface CargoTrabajador {
  trabajadorId: string;
  nombre: string;
  /** Suma del saldo pendiente de sus préstamos y adelantos activos (USD). */
  saldoPrestamosUsd: number;
  /** Del más reciente al más antiguo; el servidor limita la cantidad. */
  movimientos: MovimientoCargo[];
}
