import { supabaseAdmin } from '../config/supabase.js';

/** Una línea de compra (una fila de detalle_facturas_compra) ya resuelta con
 *  nombres, para que el frontend arme cualquier agregación (resumen, por
 *  material, por proveedor, cruces entre ambos) sin más ida y vuelta al
 *  backend — trae siempre los últimos `dias` y el frontend filtra a una
 *  ventana más chica (7/15) sin volver a pedir datos. */
export interface MetricaCompraLinea {
  proveedorId: string;
  nombreProveedor: string;
  productoId: string | null;
  nombreProducto: string;
  fecha: string;
  kg: number;
  costo: number;
}

interface FacturaRow {
  id: string;
  proveedor_id: string | null;
  created_at: string;
}

interface DetalleRow {
  factura_id: string;
  producto_id: string | null;
  peso: number;
  subtotal: number;
}

function fechaDesde(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Compras de los últimos `dias` días, una fila por línea de factura
 *  (proveedor + material + kg + costo). Excluye facturas en 'borrador' — no
 *  son compras confirmadas todavía. Toda factura tiene al menos una línea en
 *  detalle_facturas_compra (backfill del Bloque 17), así que no hace falta
 *  contemplar el caso "factura sin detalle". */
export async function obtenerMetricasCompras(dias: number): Promise<MetricaCompraLinea[]> {
  const { data: facturasData, error: errFacturas } = await supabaseAdmin
    .from('facturas_compra')
    .select('id, proveedor_id, created_at')
    .neq('estado', 'borrador')
    .gte('created_at', fechaDesde(dias));

  if (errFacturas || !facturasData) return [];
  const facturas = facturasData as FacturaRow[];
  if (facturas.length === 0) return [];

  const facturaIds = facturas.map(f => f.id);
  const { data: detalleData } = await supabaseAdmin
    .from('detalle_facturas_compra')
    .select('factura_id, producto_id, peso, subtotal')
    .in('factura_id', facturaIds);
  const detalle = (detalleData as DetalleRow[] | null) ?? [];

  const proveedorIds = [...new Set(facturas.map(f => f.proveedor_id).filter((x): x is string => x != null))];
  const productoIds = [...new Set(detalle.map(d => d.producto_id).filter((x): x is string => x != null))];

  const [{ data: proveedoresData }, { data: productosData }] = await Promise.all([
    proveedorIds.length > 0
      ? supabaseAdmin.from('proveedores').select('id, nombre').in('id', proveedorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; nombre: string }> }),
    productoIds.length > 0
      ? supabaseAdmin.from('productos').select('id, nombre').in('id', productoIds)
      : Promise.resolve({ data: [] as Array<{ id: string; nombre: string }> }),
  ]);

  const nombrePorProveedor = new Map(
    ((proveedoresData as Array<{ id: string; nombre: string }> | null) ?? []).map(p => [p.id, p.nombre])
  );
  const nombrePorProducto = new Map(
    ((productosData as Array<{ id: string; nombre: string }> | null) ?? []).map(p => [p.id, p.nombre])
  );
  const facturaPorId = new Map(facturas.map(f => [f.id, f]));

  const lineas: MetricaCompraLinea[] = [];
  for (const d of detalle) {
    const factura = facturaPorId.get(d.factura_id);
    if (!factura || !factura.proveedor_id) continue;

    lineas.push({
      proveedorId: factura.proveedor_id,
      nombreProveedor: nombrePorProveedor.get(factura.proveedor_id) ?? '—',
      productoId: d.producto_id,
      nombreProducto: d.producto_id ? (nombrePorProducto.get(d.producto_id) ?? '—') : 'Sin producto',
      fecha: factura.created_at.slice(0, 10),
      kg: Number(d.peso),
      costo: Number(d.subtotal),
    });
  }

  return lineas;
}
