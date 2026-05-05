export type EstadoFactura = 'borrador' | 'confirmada' | 'anulada';

export interface FacturaItem {
  id: string;
  facturaId: string;
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface Factura {
  id: string;
  numero: number;
  creadoPor: string;
  nombreCreador?: string;
  estado: EstadoFactura;
  subtotal: number;
  total: number;
  moneda: string;
  nota: string;
  items: FacturaItem[];
  creadoEn: string;
}
