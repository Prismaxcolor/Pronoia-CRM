import { apiFetch } from './api-client';

export type TipoEntidad = 'proveedor' | 'cliente';

export interface EntradaEstadoCuenta {
  fecha: string;
  tipo: 'factura' | 'pago' | 'adelanto' | 'nota_credito' | 'nota_debito';
  descripcion: string;
  /** Correlativo formateado (C-0001, PG-0007, AD-0003, NC-0004...). */
  referencia: string | null;
  /** Texto libre que el usuario tipeó a mano, aparte del correlativo. */
  referenciaExterna?: string | null;
  cargo: number;
  abono: number;
  /** Solo notas: id para poder anularla. Ausente para facturas/pagos. */
  notaId?: string;
  /** Solo notas: ya fue reversada con una nota contraria. */
  anulada?: boolean;
  /** Solo notas de débito: ya se liquidó en un pago combinado ("Registrar pago"). */
  pagada?: boolean;
  /** Solo facturas: id para abrir el detalle. Ausente para pagos/notas. */
  facturaId?: string;
  /** Solo notas: id de la factura de compra a la que está asociada, ya resuelto. */
  facturaAsociadaId?: string | null;
  /** Solo notas: código de esa factura (C-0007). */
  facturaAsociadaCodigo?: string | null;
}

export interface EstadoCuenta {
  entidad: { id: string; tipo: TipoEntidad; nombre: string };
  entradas: EntradaEstadoCuenta[];
  totales: { facturado: number; pagado: number; saldo: number };
}

/**
 * Estado de cuenta de un proveedor o cliente. La única diferencia entre ambos
 * es el endpoint base; la pantalla es la misma.
 */
export async function obtenerEstadoCuenta(
  tipo: TipoEntidad,
  id: string,
  desde?: string,
  hasta?: string
): Promise<EstadoCuenta | null> {
  const base = tipo === 'proveedor' ? '/api/proveedores' : '/api/clientes';
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const qs = params.toString();
  try {
    return await apiFetch<EstadoCuenta>(`${base}/${id}/estado-cuenta${qs ? `?${qs}` : ''}`);
  } catch {
    return null;
  }
}
