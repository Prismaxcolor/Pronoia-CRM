import { apiFetch } from './api-client';

export type TipoFactura = 'compra' | 'venta';

export interface FacturaCV {
  id: string;
  tipo: TipoFactura;
  entidadId: string | null;
  nombreEntidad: string | null;
  productoId: string | null;
  nombreProducto: string | null;
  ticketId: string | null;
  pesoManual: number | null;
  peso: number;
  listaPreciosId: string | null;
  precioUnitario: number;
  total: number;
  descripcion: string | null;
  observaciones: string | null;
  estado: 'borrador' | 'emitida' | 'pagada';
  createdAt: string;
}

export interface CrearFacturaInput {
  entidadId: string;
  productoId: string;
  ticketId?: string | null;
  pesoManual?: number | null;
  listaPreciosId?: string | null;
  precioUnitario: number;
  descripcion?: string | null;
  observaciones?: string | null;
  estado?: 'borrador' | 'emitida' | 'pagada';
}

export interface FiltrosFacturas {
  desde?: string;
  hasta?: string;
  entidadId?: string;
  productoId?: string;
}

function base(tipo: TipoFactura): string {
  return tipo === 'compra' ? '/api/facturas-compra' : '/api/facturas-venta';
}

export async function obtenerFacturas(
  tipo: TipoFactura,
  filtros: FiltrosFacturas = {}
): Promise<FacturaCV[]> {
  const params = new URLSearchParams();
  if (filtros.desde) params.set('desde', filtros.desde);
  if (filtros.hasta) params.set('hasta', filtros.hasta);
  if (filtros.entidadId) params.set('entidadId', filtros.entidadId);
  if (filtros.productoId) params.set('productoId', filtros.productoId);
  const qs = params.toString();
  try {
    const { facturas } = await apiFetch<{ facturas: FacturaCV[] }>(`${base(tipo)}${qs ? `?${qs}` : ''}`);
    return facturas;
  } catch {
    return [];
  }
}

export async function obtenerFactura(tipo: TipoFactura, id: string): Promise<FacturaCV | null> {
  try {
    const { factura } = await apiFetch<{ factura: FacturaCV }>(`${base(tipo)}/${id}`);
    return factura;
  } catch {
    return null;
  }
}

export async function crearFactura(
  tipo: TipoFactura,
  input: CrearFacturaInput
): Promise<{ factura: FacturaCV } | { error: string }> {
  try {
    const { factura } = await apiFetch<{ factura: FacturaCV }>(base(tipo), {
      method: 'POST',
      body: input,
    });
    return { factura };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear la factura.' };
  }
}
