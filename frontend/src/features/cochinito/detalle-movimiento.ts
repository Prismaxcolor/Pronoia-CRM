import { correlativoMovimiento } from '../../lib/cochinito-kpis';
import type { Movimiento } from '@shared/types/index.js';

const SIN_NUMERO = '—';
const DIGITOS_NUMERO_MANUAL = 6;
const PREFIJO_WALLET = 'MV';
const DIGITOS_WALLET = 4;

export const ETIQUETA_TIPO_MOVIMIENTO = { ingreso: 'Ingreso', egreso: 'Egreso', transferencia: 'Transferencia' } as const;
export const ETIQUETA_SUBTIPO_MOVIMIENTO = { pago: 'Pago', adelanto: 'Adelanto', cobro: 'Cobro', anticipo: 'Anticipo' } as const;

/** Ruta del detalle de un movimiento. */
export const rutaDetalleMovimiento = (id: string): string => `/cochinito/movimientos/${id}`;

/** Correlativo del sistema de un movimiento manual de Wallet: 5 -> "MV-0005". */
export const formatCodigoMovimientoWallet = (numeroSistema: number): string =>
  `${PREFIJO_WALLET}-${String(numeroSistema).padStart(DIGITOS_WALLET, '0')}`;

/**
 * N° del movimiento. Los pagos, adelantos, cobros y anticipos conservan su correlativo propio (PG-0001, AD-0001...).
 * Los movimientos manuales de Wallet usan el correlativo del sistema (MV-0001); si no lo tienen (movimientos
 * anteriores a la migración) se cae al `numero` con formato N000123. Sin número: "—".
 */
export function numeroMovimiento(m: Pick<Movimiento, 'subtipo' | 'numero'> & { numeroSistema?: number | null }): string {
  const correlativo = correlativoMovimiento(m);
  if (correlativo !== SIN_NUMERO) return correlativo;
  if (m.numeroSistema != null) return formatCodigoMovimientoWallet(m.numeroSistema);
  return m.numero == null ? SIN_NUMERO : `N${String(m.numero).padStart(DIGITOS_NUMERO_MANUAL, '0')}`;
}

/** Bolívares por dólar implícitos en el movimiento; null si no aplica (ya está en USD o falta el equivalente). */
export function tasaDe(m: Pick<Movimiento, 'monto' | 'moneda' | 'montoUsd'>): number | null {
  if (m.moneda === 'USD' || m.montoUsd == null || !(m.montoUsd > 0) || !(m.monto > 0)) return null;
  return m.monto / m.montoUsd;
}

/** Solo los movimientos manuales vigentes se editan o anulan desde Wallet; los de un pago o cobro, desde su comprobante. */
export const esManualVigente = (m: Pick<Movimiento, 'anulado' | 'grupoId' | 'subtipo'>): boolean =>
  !m.anulado && !m.grupoId && !m.subtipo;

/** Ruta del comprobante de pago/cobro/cruce al que pertenece el movimiento; null si es un movimiento suelto. */
export function rutaComprobanteOperacion(m: Pick<Movimiento, 'grupoId' | 'proveedorId' | 'clienteId'>): string | null {
  if (!m.grupoId) return null;
  if (m.proveedorId) return `/proveedores/${m.proveedorId}/pagos/${m.grupoId}`;
  if (m.clienteId) return `/clientes/${m.clienteId}/pagos/${m.grupoId}`;
  return null;
}

/** Recurso cuyo permiso hace falta para abrir el comprobante de la operación. */
export const recursoComprobanteOperacion = (m: Pick<Movimiento, 'proveedorId'>): 'proveedores' | 'clientes' =>
  m.proveedorId ? 'proveedores' : 'clientes';

/** Cómo llamar a la operación de la que forma parte el movimiento. */
export function etiquetaOperacion(m: Pick<Movimiento, 'subtipo' | 'proveedorId'>): string {
  if (m.subtipo === 'pago' || m.subtipo === 'adelanto') return 'pago a proveedor';
  if (m.subtipo === 'cobro' || m.subtipo === 'anticipo') return 'cobro a cliente';
  return m.proveedorId ? 'pago o cruce con proveedor' : 'cobro o cruce con cliente';
}

/** Título del documento al compartir: el archivo queda como "Movimiento-N000123-<tercero o banca>.png". */
export function tituloCompartirMovimiento(m: Pick<Movimiento, 'subtipo' | 'numero'> & { numeroSistema?: number | null }, terceroOBanca: string | null): string {
  const numero = numeroMovimiento(m);
  return ['Movimiento', numero === SIN_NUMERO ? null : numero, terceroOBanca].filter(Boolean).join(' ');
}
