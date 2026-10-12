/**
 * Nómina: personal (administrativo / operativo), nómina semanal por tipo y préstamos/adelantos.
 * Fase 1: solo registro y cálculo; no mueve dinero ni toca Wallet.
 *
 * Son DATOS PERSONALES SENSIBLES: solo salen por /api/nomina/* con el permiso de módulo 'nomina'.
 * Las fórmulas viven en backend/src/utils/nomina-calculo.ts (copia para la vista previa: ./nomina-calculo.ts).
 */
import type { MonedaPago, TotalesNomina } from './nomina-calculo.js';

export type { MonedaPago, TotalesNomina };

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
  /** Monto base por día trabajado, en USD. */
  pagoDiarioUsd: number;
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
  monedaPago: MonedaPago;
  diasTrabajados: number;
  montoBaseUsd: number;
  totalBrutoUsd: number;
  montoRefBs: number | null;
  bonificacionUsd: number;
  descuentoTrabajoUsd: number;
  descuentoPrestamoUsd: number;
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
  pagoDiarioUsd: number;
  monedaPagoSugerida: MonedaPago;
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
