import { leerGet } from './lectura-service';

export interface MetricaCompraLinea {
  facturaId: string;
  codigoFactura: string | null;
  proveedorId: string;
  nombreProveedor: string;
  productoId: string | null;
  nombreProducto: string;
  tipoMaterialId: string | null;
  tipoMaterialNombre: string | null;
  fecha: string;
  kg: number;
  costo: number;
}

/** Compras entre `desde` y `hasta` (YYYY-MM-DD, inclusive), una fila por
 *  línea de factura. */
export async function obtenerMetricasCompras(desde: string, hasta: string): Promise<MetricaCompraLinea[]> {
  const params = new URLSearchParams({ desde, hasta });
  const { lineas } = await leerGet<{ lineas: MetricaCompraLinea[] }>(`/api/metricas/compras?${params}`);
  return lineas;
}
