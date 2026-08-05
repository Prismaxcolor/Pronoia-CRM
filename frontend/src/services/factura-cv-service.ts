import { apiFetch } from './api-client';

export type TipoFactura = 'compra' | 'venta';

export interface FacturaItemCV {
  id: string;
  productoId: string | null;
  nombreProducto: string | null;
  peso: number;
  precioUnitario: number;
  subtotal: number;
}

export interface FacturaCV {
  id: string;
  /** Correlativo automático, en ambos tipos de factura. */
  numero: number | null;
  /** Código de control formateado ("C-0001" / "V-0001"). */
  codigo: string | null;
  tipo: TipoFactura;
  entidadId: string | null;
  nombreEntidad: string | null;
  ticketIds: string[];
  items: FacturaItemCV[];
  total: number;
  /** Acumulado de pagos aplicados (USD). Solo compras; 0 en ventas. */
  montoPagado: number;
  descripcion: string | null;
  observaciones: string | null;
  estado: 'borrador' | 'emitida' | 'pagada';
  createdAt: string;
}

/**
 * Consolida las líneas por material para la factura que ve/imprime el proveedor:
 * agrupa por `productoId` sumando peso y subtotal. El precio mostrado es el
 * promedio ponderado (subtotal/peso), para que peso × precio siga cuadrando con
 * el subtotal aunque las líneas originales tuvieran precios distintos.
 *
 * SOLO es una vista: el inventario ya quedó registrado por separado (por destino)
 * y no se toca. El orden de aparición se conserva.
 */
export function consolidarItems(items: FacturaItemCV[]): FacturaItemCV[] {
  const mapa = new Map<string, FacturaItemCV>();
  for (const it of items) {
    const clave = it.productoId ?? `nombre:${it.nombreProducto ?? ''}`;
    const ex = mapa.get(clave);
    if (ex) {
      ex.peso += it.peso;
      ex.subtotal += it.subtotal;
      ex.precioUnitario = ex.peso > 0 ? ex.subtotal / ex.peso : ex.precioUnitario;
    } else {
      mapa.set(clave, { ...it });
    }
  }
  return Array.from(mapa.values());
}

export interface CrearFacturaItemInput {
  productoId: string;
  peso: number;
  precioUnitario: number;
}

export interface CrearFacturaInput {
  entidadId: string;
  ticketIds?: string[];
  items: CrearFacturaItemInput[];
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
