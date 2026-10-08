import { leerGet } from './lectura-service';
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
  /** Id del documento aplicado (factura, nota o grupo del adelanto). */
  id: string;
  tipo: 'factura' | 'nota_debito' | 'nota_credito' | 'adelanto';
  /** Código de control del documento aplicado (C-/V-/ND-/NC-/NDV-/NCV-).
   *  Null si el documento referenciado ya no tiene numero. */
  codigo: string | null;
  montoUsd: number;
}

export interface FilaResumenPago {
  clave: 'totalFacturas' | 'notasDebito' | 'adelantos' | 'notasCredito' | 'saldoPendiente' | 'pagado';
  etiqueta: string;
  /** USD, nunca negativo; `signo` dice si suma o resta. */
  montoUsd: number;
  signo: '' | '+' | '-';
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
  /** Instante (timestamptz) en que se registró el pago/cobro. */
  registradoEn?: string | null;
  bancas: BancaPagoDetalle[];
  totalUsd: number;
  codigoPago: string | null;
  codigoAdelanto: string | null;
  /** CR-/CRV- cuando la operación fue un cruce sin movimiento de dinero. */
  codigoCruce: string | null;
  /** Desglose por factura/nota aplicada — vacío en pagos registrados antes
   *  del Bloque 49, esa data nunca se guardó. */
  items: ItemPagoDetalle[];
  /** Total de las facturas, adelantos / N/C / N/D aplicados, saldo pendiente y, al final, lo pagado
   *  (calculado en el backend: utils/comprobante-resumen.ts). Opcional: un backend
   *  anterior no lo envía y la pantalla muestra solo el Total. */
  resumen?: FilaResumenPago[];
  /** true si la operación fue anulada: se conserva el registro, pero ya no cuenta en saldos. */
  anulado: boolean;
  anuladoMotivo: string | null;
  anuladoEn: string | null;
  anuladoPor: string | null;
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
    const { pago } = await leerGet<{ pago: PagoDetalle }>(`${base}/${entidadId}/pagos/${grupoId}`);
    return pago;
  } catch {
    return null;
  }
}
