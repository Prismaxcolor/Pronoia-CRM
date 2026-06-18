import { supabaseAdmin } from '../config/supabase.js';

export interface ArticuloInventario {
  productoId: string;
  nombre: string;
  /** Destino de inventario de esta fila: 'mpp' o 'lote'. */
  destinoTipo: 'mpp' | 'lote';
  /** Lote cuando destinoTipo === 'lote'. Null para MPP. */
  loteId: string | null;
  /** Etiqueta legible del destino: "MPP" o el nombre del lote. */
  destinoLabel: string;
  entradas: number;        // kg que entraron por pesaje de compra
  salidas: number;         // kg que salieron por pesaje de venta
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
const MPP_LABEL = 'MPP';

// ---- núcleo puro (testeable sin BD) ----------------------------------------

export interface ProductoInventario {
  id: string;
  nombre: string;
  tipoMaterialId: string | null;
  nombreCategoria: string;
}
/** Un movimiento de pesaje sobre un (material, destino). */
export interface MovimientoInventario {
  productoId: string;
  destinoTipo: 'mpp' | 'lote';
  loteId: string | null;
  destinoLabel: string;
  peso: number;
}
export interface CantidadPorMaterial { materialId: string; cantidad: number }

/**
 * Calcula el stock por (material, destino) y lo agrupa por categoría.
 * stock = entradas (pesaje compra) − salidas (pesaje venta) + neto de
 * transformaciones. Las transformaciones se imputan al destino MPP (material
 * por procesar). Función pura: recibe los datos ya cargados, no toca la BD.
 */
export function construirGruposInventario(
  productos: ProductoInventario[],
  entradas: MovimientoInventario[],
  salidas: MovimientoInventario[],
  transfEntrada: CantidadPorMaterial[],
  transfSalida: CantidadPorMaterial[]
): GrupoInventario[] {
  const meta = new Map<string, ProductoInventario>();
  for (const p of productos) meta.set(p.id, p);

  // Clave de bucket: material + destino (lote_id o 'mpp').
  const buckets = new Map<string, ArticuloInventario>();
  const claveBucket = (productoId: string, loteId: string | null) =>
    `${productoId}::${loteId ?? 'mpp'}`;

  const obtenerBucket = (
    productoId: string,
    destinoTipo: 'mpp' | 'lote',
    loteId: string | null,
    destinoLabel: string
  ): ArticuloInventario => {
    const esLote = destinoTipo === 'lote';
    const k = claveBucket(productoId, esLote ? loteId : null);
    let b = buckets.get(k);
    if (!b) {
      b = {
        productoId,
        nombre: meta.get(productoId)?.nombre ?? '—',
        destinoTipo,
        loteId: esLote ? loteId : null,
        destinoLabel,
        entradas: 0,
        salidas: 0,
        transformaciones: 0,
        stock: 0,
      };
      buckets.set(k, b);
    }
    return b;
  };

  for (const e of entradas) obtenerBucket(e.productoId, e.destinoTipo, e.loteId, e.destinoLabel).entradas += e.peso;
  for (const s of salidas) obtenerBucket(s.productoId, s.destinoTipo, s.loteId, s.destinoLabel).salidas += s.peso;
  for (const t of transfEntrada) obtenerBucket(t.materialId, 'mpp', null, MPP_LABEL).transformaciones -= t.cantidad;
  for (const t of transfSalida) obtenerBucket(t.materialId, 'mpp', null, MPP_LABEL).transformaciones += t.cantidad;

  // Productos sin ningún movimiento → fila MPP en cero (para listar el catálogo).
  const conMovimiento = new Set<string>();
  for (const b of buckets.values()) conMovimiento.add(b.productoId);
  for (const p of productos) {
    if (!conMovimiento.has(p.id)) obtenerBucket(p.id, 'mpp', null, MPP_LABEL);
  }

  for (const b of buckets.values()) b.stock = b.entradas - b.salidas + b.transformaciones;

  const grupos = new Map<string, GrupoInventario>();
  for (const b of buckets.values()) {
    const m = meta.get(b.productoId);
    const clave = m?.tipoMaterialId ?? '__sin__';
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        tipoMaterialId: m?.tipoMaterialId ?? null,
        nombreCategoria: m?.nombreCategoria ?? SIN_CATEGORIA,
        totalKg: 0,
        articulos: [],
      });
    }
    const g = grupos.get(clave)!;
    g.articulos.push(b);
    g.totalKg += b.stock;
  }

  for (const g of grupos.values()) {
    g.articulos.sort((a, b) => a.nombre.localeCompare(b.nombre) || a.destinoLabel.localeCompare(b.destinoLabel));
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

interface DetalleTicketRow {
  producto_id: string | null;
  peso_neto: number | null;
  destino_tipo: 'mpp' | 'lote';
  lote_id: string | null;
  lotes?: { nombre: string } | null;
}
interface TicketRow {
  tipo: 'compra' | 'venta';
  fecha: string | null;
  detalle_tickets_pesaje?: DetalleTicketRow[] | null;
}

/**
 * Calcula el stock por (material, destino): entradas (pesaje de compra) −
 * salidas (pesaje de venta) ± neto de transformaciones. El peso entra/sale al
 * inventario en el momento del pesaje (ticket), no de la factura.
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
  // Solo contamos movimientos de materiales que pasaron el filtro de catálogo.
  const idsPermitidos = new Set(productos.map(p => p.id));

  // Pesaje: entradas (compra) y salidas (venta), con su destino.
  let qTickets = supabaseAdmin
    .from('tickets_pesaje')
    .select('tipo, fecha, detalle_tickets_pesaje(producto_id, peso_neto, destino_tipo, lote_id, lotes(nombre))');
  if (filtros.desde) qTickets = qTickets.gte('fecha', filtros.desde);
  if (filtros.hasta) qTickets = qTickets.lte('fecha', filtros.hasta);
  const { data: ticketsData } = await qTickets;

  const entradas: MovimientoInventario[] = [];
  const salidas: MovimientoInventario[] = [];
  for (const t of (ticketsData as unknown as TicketRow[]) ?? []) {
    for (const d of t.detalle_tickets_pesaje ?? []) {
      if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
      const mov: MovimientoInventario = {
        productoId: d.producto_id,
        destinoTipo: d.destino_tipo,
        loteId: d.lote_id,
        destinoLabel: d.destino_tipo === 'lote' ? (d.lotes?.nombre ?? 'Lote') : MPP_LABEL,
        peso: Number(d.peso_neto ?? 0),
      };
      if (t.tipo === 'compra') entradas.push(mov);
      else salidas.push(mov);
    }
  }

  // Transformaciones (se imputan a MPP).
  let qTe = supabaseAdmin.from('transformaciones').select('material_entrada_id, cantidad_entrada, fecha');
  if (filtros.desde) qTe = qTe.gte('fecha', filtros.desde);
  if (filtros.hasta) qTe = qTe.lte('fecha', filtros.hasta);
  const { data: teData } = await qTe;
  const transfEntrada: CantidadPorMaterial[] = ((teData as Array<{ material_entrada_id: string | null; cantidad_entrada: number }> | null) ?? [])
    .filter(t => t.material_entrada_id && idsPermitidos.has(t.material_entrada_id))
    .map(t => ({ materialId: t.material_entrada_id!, cantidad: Number(t.cantidad_entrada) }));

  const { data: tsData } = await supabaseAdmin
    .from('detalle_transformaciones')
    .select('material_salida_id, cantidad, transformaciones(fecha)');
  const transfSalida: CantidadPorMaterial[] = [];
  for (const d of (tsData as unknown as Array<{ material_salida_id: string | null; cantidad: number; transformaciones?: { fecha: string | null } | null }> | null) ?? []) {
    if (!d.material_salida_id || !idsPermitidos.has(d.material_salida_id)) continue;
    const fecha = d.transformaciones?.fecha ?? null;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    transfSalida.push({ materialId: d.material_salida_id, cantidad: Number(d.cantidad) });
  }

  return construirGruposInventario(productos, entradas, salidas, transfEntrada, transfSalida);
}
