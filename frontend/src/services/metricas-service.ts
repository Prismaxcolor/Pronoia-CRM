import { apiFetch } from './api-client';

export interface MetricaCompraLinea {
  proveedorId: string;
  nombreProveedor: string;
  productoId: string | null;
  nombreProducto: string;
  fecha: string;
  kg: number;
  costo: number;
}

/** Últimos 30 días de compras (una fila por línea de factura). El frontend
 *  recorta a 7/15 días localmente — un solo fetch cubre las 3 ventanas. */
export async function obtenerMetricasCompras(): Promise<MetricaCompraLinea[]> {
  const { lineas } = await apiFetch<{ lineas: MetricaCompraLinea[] }>('/api/metricas/compras');
  return lineas;
}
