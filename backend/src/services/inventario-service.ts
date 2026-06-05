import { supabaseAdmin } from '../config/supabase.js';

export interface ArticuloInventario {
  productoId: string;
  nombre: string;
  entradas: number;        // kg que entraron por compras
  salidas: number;         // kg que salieron por ventas
  transformaciones: number; // neto por transformaciones (salidas - entradas)
  stock: number;
}

export interface GrupoInventario {
  tipoMaterialId: string | null;
  nombreCategoria: string;
  totalKg: number;
  articulos: ArticuloInventario[];
}

export interface FiltrosInventario {
  tipoMaterialId?: string;
  productoId?: string;
  desde?: string;
  hasta?: string;
}

const SIN_CATEGORIA = 'Sin categoría';

// ---- núcleo puro (testeable sin BD) ----------------------------------------

export interface ProductoInventario {
  id: string;
  nombre: string;
  tipoMaterialId: string | null;
  nombreCategoria: string;
}
export interface PesoPorProducto { productoId: string; peso: number }
export interface CantidadPorMaterial { materialId: string; cantidad: number }

/**
 * Calcula el stock por artículo y lo agrupa por categoría.
 * stock = entradas (compras) − salidas (ventas) + neto de transformaciones.
 * Función pura: recibe los datos ya cargados, no toca la BD.
 */
export function construirGruposInventario(
  productos: ProductoInventario[],
  compras: PesoPorProducto[],
  ventas: PesoPorProducto[],
  transfEntrada: CantidadPorMaterial[],
  transfSalida: CantidadPorMaterial[]
): GrupoInventario[] {
  const acc = new Map<string, ArticuloInventario>();
  const meta = new Map<string, { tipoMaterialId: string | null; nombreCategoria: string }>();
  for (const p of productos) {
    acc.set(p.id, { productoId: p.id, nombre: p.nombre, entradas: 0, salidas: 0, transformaciones: 0, stock: 0 });
    meta.set(p.id, { tipoMaterialId: p.tipoMaterialId, nombreCategoria: p.nombreCategoria });
  }

  for (const c of compras) { const a = acc.get(c.productoId); if (a) a.entradas += c.peso; }
  for (const v of ventas) { const a = acc.get(v.productoId); if (a) a.salidas += v.peso; }
  for (const t of transfEntrada) { const a = acc.get(t.materialId); if (a) a.transformaciones -= t.cantidad; }
  for (const t of transfSalida) { const a = acc.get(t.materialId); if (a) a.transformaciones += t.cantidad; }

  for (const a of acc.values()) a.stock = a.entradas - a.salidas + a.transformaciones;

  const grupos = new Map<string, GrupoInventario>();
  for (const [productoId, art] of acc) {
    const m = meta.get(productoId)!;
    const clave = m.tipoMaterialId ?? '__sin__';
    if (!grupos.has(clave)) {
      grupos.set(clave, { tipoMaterialId: m.tipoMaterialId, nombreCategoria: m.nombreCategoria, totalKg: 0, articulos: [] });
    }
    const g = grupos.get(clave)!;
    g.articulos.push(art);
    g.totalKg += art.stock;
  }

  return Array.from(grupos.values()).sort((a, b) => a.nombreCategoria.localeCompare(b.nombreCategoria));
}

// ---- acceso a datos --------------------------------------------------------

interface ProductoRow {
  id: string;
  nombre: string;
  tipo_material_id: string | null;
  tipos_material?: { nombre: string } | null;
}

/**
 * Calcula el stock por material: entradas (compras) - salidas (ventas) ± neto de
 * transformaciones. Agrupa por tipo de material. Las transformaciones se incluyen
 * pero hoy suman 0 (no hay módulo que las registre todavía).
 */
export async function obtenerInventario(filtros: FiltrosInventario = {}): Promise<GrupoInventario[]> {
  let qProductos = supabaseAdmin
    .from('productos')
    .select('id, nombre, tipo_material_id, tipos_material(nombre)');
  if (filtros.tipoMaterialId) qProductos = qProductos.eq('tipo_material_id', filtros.tipoMaterialId);
  if (filtros.productoId) qProductos = qProductos.eq('id', filtros.productoId);
  const { data: productosData } = await qProductos;
  const productos: ProductoInventario[] = ((productosData as unknown as ProductoRow[]) ?? []).map(p => ({
    id: p.id,
    nombre: p.nombre,
    tipoMaterialId: p.tipo_material_id,
    nombreCategoria: p.tipos_material?.nombre ?? SIN_CATEGORIA,
  }));

  const cargarPesos = async (tabla: 'facturas_compra' | 'facturas_venta'): Promise<PesoPorProducto[]> => {
    let q = supabaseAdmin.from(tabla).select('producto_id, total, precio_unitario, created_at');
    if (filtros.desde) q = q.gte('created_at', filtros.desde);
    if (filtros.hasta) q = q.lte('created_at', `${filtros.hasta}T23:59:59`);
    if (filtros.productoId) q = q.eq('producto_id', filtros.productoId);
    const { data } = await q;
    const out: PesoPorProducto[] = [];
    for (const f of (data as Array<{ producto_id: string | null; total: number; precio_unitario: number }> | null) ?? []) {
      if (!f.producto_id) continue;
      const precio = Number(f.precio_unitario);
      out.push({ productoId: f.producto_id, peso: precio > 0 ? Number(f.total) / precio : 0 });
    }
    return out;
  };

  const compras = await cargarPesos('facturas_compra');
  const ventas = await cargarPesos('facturas_venta');

  let qTe = supabaseAdmin.from('transformaciones').select('material_entrada_id, cantidad_entrada, fecha');
  if (filtros.desde) qTe = qTe.gte('fecha', filtros.desde);
  if (filtros.hasta) qTe = qTe.lte('fecha', filtros.hasta);
  const { data: teData } = await qTe;
  const transfEntrada: CantidadPorMaterial[] = ((teData as Array<{ material_entrada_id: string | null; cantidad_entrada: number }> | null) ?? [])
    .filter(t => t.material_entrada_id)
    .map(t => ({ materialId: t.material_entrada_id!, cantidad: Number(t.cantidad_entrada) }));

  const { data: tsData } = await supabaseAdmin
    .from('detalle_transformaciones')
    .select('material_salida_id, cantidad, transformaciones(fecha)');
  const transfSalida: CantidadPorMaterial[] = [];
  for (const d of (tsData as unknown as Array<{ material_salida_id: string | null; cantidad: number; transformaciones?: { fecha: string | null } | null }> | null) ?? []) {
    if (!d.material_salida_id) continue;
    const fecha = d.transformaciones?.fecha ?? null;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    transfSalida.push({ materialId: d.material_salida_id, cantidad: Number(d.cantidad) });
  }

  return construirGruposInventario(productos, compras, ventas, transfEntrada, transfSalida);
}
