import { supabaseAdmin } from '../config/supabase.js';
import { formatCodigoCompra } from '../utils/codigos.js';

/** Una línea de compra (una fila de detalle_facturas_compra) ya resuelta con
 *  nombres, para que el frontend arme cualquier agregación (resumen, por
 *  material, por proveedor, cruces entre ambos, tendencia por día) sin más
 *  ida y vuelta al backend. */
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

interface FacturaRow {
  id: string;
  numero: number | null;
  proveedor_id: string | null;
  created_at: string;
}

interface DetalleRow {
  factura_id: string;
  producto_id: string | null;
  peso: number;
  subtotal: number;
}

/** Compras entre `desde` y `hasta` (inclusive, YYYY-MM-DD), una fila por
 *  línea de factura (proveedor + material + kg + costo). Excluye facturas en
 *  'borrador' — no son compras confirmadas todavía. Toda factura tiene al
 *  menos una línea en detalle_facturas_compra (backfill del Bloque 17), así
 *  que no hace falta contemplar el caso "factura sin detalle". */
export async function obtenerMetricasCompras(desde: string, hasta: string): Promise<MetricaCompraLinea[]> {
  const { data: facturasData, error: errFacturas } = await supabaseAdmin
    .from('facturas_compra')
    .select('id, numero, proveedor_id, created_at')
    .neq('estado', 'borrador')
    .gte('created_at', desde)
    .lte('created_at', `${hasta}T23:59:59`);

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
      ? supabaseAdmin.from('productos').select('id, nombre, tipo_material_id').in('id', productoIds)
      : Promise.resolve({ data: [] as Array<{ id: string; nombre: string; tipo_material_id: string | null }> }),
  ]);

  const nombrePorProveedor = new Map(
    ((proveedoresData as Array<{ id: string; nombre: string }> | null) ?? []).map(p => [p.id, p.nombre])
  );
  const productos = (productosData as Array<{ id: string; nombre: string; tipo_material_id: string | null }> | null) ?? [];
  const nombrePorProducto = new Map(productos.map(p => [p.id, p.nombre]));
  const tipoMaterialIdPorProducto = new Map(productos.map(p => [p.id, p.tipo_material_id]));

  const tipoMaterialIds = [...new Set(productos.map(p => p.tipo_material_id).filter((x): x is string => x != null))];
  const { data: tiposMaterialData } = tipoMaterialIds.length > 0
    ? await supabaseAdmin.from('tipos_material').select('id, nombre').in('id', tipoMaterialIds)
    : { data: [] as Array<{ id: string; nombre: string }> };
  const nombrePorTipoMaterial = new Map(
    ((tiposMaterialData as Array<{ id: string; nombre: string }> | null) ?? []).map(t => [t.id, t.nombre])
  );

  const facturaPorId = new Map(facturas.map(f => [f.id, f]));

  const lineas: MetricaCompraLinea[] = [];
  for (const d of detalle) {
    const factura = facturaPorId.get(d.factura_id);
    if (!factura || !factura.proveedor_id) continue;

    const tipoMaterialId = d.producto_id ? (tipoMaterialIdPorProducto.get(d.producto_id) ?? null) : null;

    lineas.push({
      facturaId: factura.id,
      codigoFactura: factura.numero != null ? formatCodigoCompra(factura.numero) : null,
      proveedorId: factura.proveedor_id,
      nombreProveedor: nombrePorProveedor.get(factura.proveedor_id) ?? '—',
      productoId: d.producto_id,
      nombreProducto: d.producto_id ? (nombrePorProducto.get(d.producto_id) ?? '—') : 'Sin producto',
      tipoMaterialId,
      tipoMaterialNombre: tipoMaterialId ? (nombrePorTipoMaterial.get(tipoMaterialId) ?? null) : null,
      fecha: factura.created_at.slice(0, 10),
      kg: Number(d.peso),
      costo: Number(d.subtotal),
    });
  }

  return lineas;
}
