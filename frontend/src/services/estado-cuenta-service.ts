import { apiFetch } from './api-client';

export type TipoEntidad = 'proveedor' | 'cliente';

export interface EntradaEstadoCuenta {
  fecha: string;
  tipo: 'factura' | 'pago';
  descripcion: string;
  referencia: string | null;
  cargo: number;
  abono: number;
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
