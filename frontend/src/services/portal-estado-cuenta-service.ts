import { portalApiFetch } from './portal-api-client';

export interface EntradaEstadoCuenta {
  fecha: string;
  tipo: 'factura' | 'pago' | 'adelanto' | 'nota_credito' | 'nota_debito';
  descripcion: string;
  referencia: string | null;
  cargo: number;
  abono: number;
}

export interface EstadoCuentaPortal {
  entidad: { id: string; tipo: 'proveedor' | 'cliente'; nombre: string };
  entradas: EntradaEstadoCuenta[];
  totales: { facturado: number; pagado: number; saldo: number };
}

export async function obtenerEstadoCuentaPortal(): Promise<EstadoCuentaPortal | null> {
  try {
    return await portalApiFetch<EstadoCuentaPortal>('/api/portal/estado-cuenta');
  } catch {
    return null;
  }
}
