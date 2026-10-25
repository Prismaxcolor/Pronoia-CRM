import { apiFetch } from './api-client';
import type { Movimiento } from '@shared/types/index.js';
import type { PagoDetalle } from './pago-detalle-service';

/** 'pago' = a proveedor; 'cobro' = de cliente. Es también el tipo de la llave de edición. */
export type TipoPagoCobro = 'pago' | 'cobro';

export interface BancaEdicion {
  bancaId: string;
  monto: number;
  moneda: 'USD' | 'VES';
  montoUsd: number;
  referencia?: string | null;
}

export interface ItemEdicion {
  tipo: 'factura' | 'nota_debito' | 'nota_credito' | 'adelanto';
  id: string;
  montoUsd: number;
}

/** Todo opcional: lo que no se envía no cambia. bancas + montoUsd + items viajan juntos (parte contable). */
export interface EditarPagoInput {
  descripcion?: string;
  referencia?: string;
  fecha?: string;
  comprobantes?: string[];
  bancas?: BancaEdicion[];
  montoUsd?: number;
  items?: ItemEdicion[];
  llaveEdicion?: string;
}

export interface ResultadoPagoEdicion {
  detalle: PagoDetalle;
  autorizadoPor: string | null;
  advertencia?: string;
}

interface RespuestaPago {
  pago?: PagoDetalle;
  cobro?: PagoDetalle;
  autorizadoPor: string | null;
  advertencia?: string;
}

const mensaje = (err: unknown, respaldo: string) => (err instanceof Error ? err.message : respaldo);

function normalizar(r: RespuestaPago): ResultadoPagoEdicion | { error: string } {
  const detalle = r.pago ?? r.cobro;
  if (!detalle) return { error: 'Respuesta inesperada del servidor.' };
  return { detalle, autorizadoPor: r.autorizadoPor, advertencia: r.advertencia };
}

const base = (tipo: TipoPagoCobro) => (tipo === 'pago' ? '/api/pagos' : '/api/cobros');

/** Anula un pago/cobro/cruce completo: revierte bancas, facturas, notas y adelantos. Exige llave salvo superadmin. */
export async function anularPagoCobro(
  tipo: TipoPagoCobro, grupoId: string, motivo: string, llaveEdicion?: string
): Promise<ResultadoPagoEdicion | { error: string }> {
  try {
    return normalizar(await apiFetch<RespuestaPago>(`${base(tipo)}/${grupoId}/anular`, {
      method: 'POST', body: { motivo, llaveEdicion: llaveEdicion || undefined },
    }));
  } catch (err) {
    return { error: mensaje(err, 'No se pudo anular.') };
  }
}

export async function editarPagoCobro(
  tipo: TipoPagoCobro, grupoId: string, input: EditarPagoInput
): Promise<ResultadoPagoEdicion | { error: string }> {
  try {
    return normalizar(await apiFetch<RespuestaPago>(`${base(tipo)}/${grupoId}`, {
      method: 'PATCH', body: { ...input, llaveEdicion: input.llaveEdicion || undefined },
    }));
  } catch (err) {
    return { error: mensaje(err, 'No se pudo guardar el cambio.') };
  }
}

export interface EditarMovimientoInput {
  descripcion?: string;
  referencia?: string;
  fecha?: string;
  comprobantes?: string[];
  bancaId?: string;
  bancaDestinoId?: string | null;
  monto?: number;
  moneda?: string;
  montoDestino?: number | null;
  proveedorId?: string | null;
  clienteId?: string | null;
  llaveEdicion?: string;
}

export async function anularMovimiento(
  id: string, motivo: string, llaveEdicion?: string
): Promise<{ movimiento: Movimiento; advertencia?: string } | { error: string }> {
  try {
    return await apiFetch<{ movimiento: Movimiento; advertencia?: string }>(`/api/cochinito/movimientos/${id}/anular`, {
      method: 'POST', body: { motivo, llaveEdicion: llaveEdicion || undefined },
    });
  } catch (err) {
    return { error: mensaje(err, 'No se pudo anular el movimiento.') };
  }
}

export async function editarMovimiento(
  id: string, input: EditarMovimientoInput
): Promise<{ movimiento: Movimiento; advertencia?: string } | { error: string }> {
  try {
    return await apiFetch<{ movimiento: Movimiento; advertencia?: string }>(`/api/cochinito/movimientos/${id}`, {
      method: 'PATCH', body: { ...input, llaveEdicion: input.llaveEdicion || undefined },
    });
  } catch (err) {
    return { error: mensaje(err, 'No se pudo guardar el movimiento.') };
  }
}
