/**
 * Lógica pura del formulario "Con mesa de cambio" (sin React): lectura de números, comisión y vista previa.
 * El cálculo vive en shared/types/mesa-cambio-transferencia (ruta relativa: así también lo cargan los tests del backend) (espejo de la validación del servidor y de la RPC SQL).
 */
import {
  planificarTransferenciaMesa, type ComisionInput, type PlanTransferenciaMesa,
} from '../../../../shared/types/mesa-cambio-transferencia.js';

export type ModoComisionFormulario = 'ninguna' | 'porcentaje' | 'monto';

export interface FormularioMesa {
  /** Sin valor por defecto: hay que elegirlo. */
  cambistaId: string;
  modo: ModoComisionFormulario;
  valor: string;
  /** Equivalente en USD escrito a mano (solo cuando ninguna de las dos cuentas está en USD). */
  montoUsd: string;
}

export const FORMULARIO_MESA_VACIO: FormularioMesa = { cambistaId: '', modo: 'ninguna', valor: '', montoUsd: '' };

/** Número desde un texto con coma o punto decimal; null si está vacío o no es un número. */
export function leerNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Comisión elegida. Con un modo elegido y un valor vacío o ilegible queda NaN para que el plan lo rechace (no se asume 0). */
export function comisionDeFormulario(f: Pick<FormularioMesa, 'modo' | 'valor'>): ComisionInput | null {
  if (f.modo === 'ninguna') return null;
  return { modo: f.modo, valor: leerNumero(f.valor) ?? Number.NaN };
}

export interface EntradaPlanFormulario {
  monedaOrigen: string;
  monedaDestino: string;
  monto: number;
  montoDestino: number | null;
  saldoOrigen: number;
}

/**
 * El equivalente en USD escrito a mano solo vale cuando NINGUNA de las dos cuentas es USD (el servidor lo rechaza
 * si no): si la persona lo escribió y luego cambió a una cuenta en USD, se descarta en lugar de enviarlo.
 */
function montoUsdManualEfectivo(f: Pick<FormularioMesa, 'montoUsd'>, monedaOrigen: string, monedaDestino: string): number | null {
  return monedaOrigen === 'USD' || monedaDestino === 'USD' ? null : leerNumero(f.montoUsd);
}

/** Vista previa / validación: comisión, neto que recibirá el destino y USD pendientes por cobrar al cambista. */
export function planDeFormulario(f: FormularioMesa, e: EntradaPlanFormulario): PlanTransferenciaMesa {
  return planificarTransferenciaMesa({
    ...e, montoUsdManual: montoUsdManualEfectivo(f, e.monedaOrigen, e.monedaDestino), comision: comisionDeFormulario(f),
  });
}

export interface DatosTransferencia {
  bancaId: string;
  bancaDestinoId: string;
  monto: number;
  montoDestino: number | null;
  descripcion: string;
  referencia: string;
  fecha: string;
  comprobantes: string[];
  monedaOrigen: string;
  monedaDestino: string;
  /** UUID de este intento de registro: un doble clic o reintento con el mismo id no crea otra transferencia. */
  clientRequestId?: string;
}

/** Cuerpo de POST /api/cochinito/movimientos/mesa-cambio. */
export function cuerpoTransferenciaMesa(f: FormularioMesa, d: DatosTransferencia) {
  return {
    ...(d.clientRequestId ? { clientRequestId: d.clientRequestId } : {}),
    cambistaId: f.cambistaId,
    bancaId: d.bancaId,
    bancaDestinoId: d.bancaDestinoId,
    monto: d.monto,
    montoDestino: d.montoDestino,
    montoUsd: montoUsdManualEfectivo(f, d.monedaOrigen, d.monedaDestino),
    comision: comisionDeFormulario(f),
    descripcion: d.descripcion.trim(),
    referencia: d.referencia.trim(),
    fecha: d.fecha,
    comprobantes: d.comprobantes,
  };
}
