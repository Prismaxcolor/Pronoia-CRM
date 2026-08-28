import { apiFetch } from './api-client';
import type { TipoEntidad } from './estado-cuenta-service';

export interface BancaPagoDetalle {
  bancaId: string | null;
  bancaNombre: string | null;
  monto: number;
  moneda: string;
  montoUsd: number;
  referencia: string | null;
}

export interface ItemPagoDetalle {
  tipo: 'factura' | 'nota_debito' | 'nota_credito';
  /** Código de control del documento aplicado (C-/V-/ND-/NC-/NDV-/NCV-).
   *  Null si el documento referenciado ya no tiene numero. */
  codigo: string | null;
  montoUsd: number;
}

export interface PagoDetalle {
  grupoId: string;
  entidadTipo: TipoEntidad;
  entidadId: string;
  nombreEntidad: string;
  fecha: string;
  descripcion: string | null;
  comprobantes: string[];
  registradoPor: string | null;
  bancas: BancaPagoDetalle[];
  totalUsd: number;
  codigoPago: string | null;
  codigoAdelanto: string | null;
  /** Desglose por factura/nota aplicada — vacío en pagos registrados antes
   *  del Bloque 49, esa data nunca se guardó. */
  items: ItemPagoDetalle[];
}

/** Detalle completo de un pago/cobro para su comprobante imprimible (vista
 *  tipo "ticket", como obtenerNotaAjuste). Devuelve null si no existe o no
 *  pertenece a esta entidad. */
export async function obtenerPagoDetalle(
  tipo: TipoEntidad,
  entidadId: string,
  grupoId: string
): Promise<PagoDetalle | null> {
  const base = tipo === 'proveedor' ? '/api/proveedores' : '/api/clientes';
  try {
    const { pago } = await apiFetch<{ pago: PagoDetalle }>(`${base}/${entidadId}/pagos/${grupoId}`);
    return pago;
  } catch {
    return null;
  }
}
