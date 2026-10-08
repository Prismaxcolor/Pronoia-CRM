import type { ComposicionLote } from '../../../shared/types/inventario-pantalla.js';
import { supabaseAdmin } from '../config/supabase.js';
import { IDS_POR_CONSULTA, leerPaginado, trocear } from '../utils/paginacion.js';
import {
  armarComposicion,
  calcularCompradoPeriodo,
  hayStockHeredado,
  type CompraDirectaLote,
  type EntradaTransformacionLote,
  type SalidaHaciaLote,
} from '../utils/lote-composicion-pantalla.js';

/**
 * Composición de un lote por producto (solo kilos). Solo lectura.
 * Stock actual: stock_lote_por_producto (todo el lote) o stock_lote_almacen_por_producto (un almacén), las mismas
 * funciones SQL que usa el inventario. Comprado del periodo: tickets de compra con destino a este lote más las
 * transformaciones completadas que le entregaron material. Ver utils/lote-composicion-pantalla.ts para la exactitud.
 */

export interface OpcionesComposicionLote {
  desde?: string;
  hasta?: string;
  almacenId?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dia = (v: unknown): string | null => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);

interface FilaStock { producto_id: string | null; stock: number | string | null }

async function leerStockPorProducto(loteId: string, almacenId?: string): Promise<Array<{ productoId: string; stock: number }>> {
  const { data, error } = almacenId
    ? await supabaseAdmin.rpc('stock_lote_almacen_por_producto', { p_lote_id: loteId, p_almacen_id: almacenId })
    : await supabaseAdmin.rpc('stock_lote_por_producto', { p_lote_id: loteId });
  if (error) throw new Error(`No se pudo leer el stock por producto del lote: ${error.message}`);
  return ((data as FilaStock[] | null) ?? []).flatMap(r => (r.producto_id ? [{ productoId: r.producto_id, stock: num(r.stock) }] : []));
}

async function leerStockTotal(loteId: string, almacenId?: string): Promise<number | null> {
  const { data, error } = almacenId
    ? await supabaseAdmin.rpc('stock_lote_almacen_total', { p_lote_id: loteId, p_almacen_id: almacenId })
    : await supabaseAdmin.rpc('stock_lote_total', { p_lote_id: loteId });
  return error || data == null ? null : num(data);
}

async function leerCompras(loteId: string): Promise<CompraDirectaLote[]> {
  const filas = await leerPaginado<{
    producto_id: string | null;
    peso_neto: number | string | null;
    tickets_pesaje: { fecha: string | null; almacen_id: string | null } | null;
  }>((d, h) =>
    supabaseAdmin
      .from('detalle_tickets_pesaje')
      .select('producto_id, peso_neto, tickets_pesaje!inner(tipo, fecha, almacen_id)')
      .eq('destino_tipo', 'lote')
      .eq('lote_id', loteId)
      .eq('tickets_pesaje.tipo', 'compra')
      .order('id')
      .range(d, h)
  );
  return filas.flatMap(f =>
    f.producto_id && f.tickets_pesaje
      ? [{ productoId: f.producto_id, pesoKg: num(f.peso_neto), fecha: dia(f.tickets_pesaje.fecha), almacenId: f.tickets_pesaje.almacen_id }]
      : []
  );
}

async function leerSalidasHaciaLote(loteId: string): Promise<SalidaHaciaLote[]> {
  const filas = await leerPaginado<{
    transformacion_id: string;
    producto_id: string | null;
    peso_neto: number | string | null;
    almacen_id: string | null;
    transformaciones: { estado: string | null; fecha: string | null; almacen_id: string | null } | null;
  }>((d, h) =>
    supabaseAdmin
      .from('transformacion_salida_detalle')
      .select('transformacion_id, producto_id, peso_neto, almacen_id, transformaciones(estado, fecha, almacen_id)')
      .eq('lote_destino_id', loteId)
      .order('id')
      .range(d, h)
  );

  const idsSinProducto = [...new Set(filas.filter(f => !f.producto_id).map(f => f.transformacion_id))];
  const entradas = new Map<string, EntradaTransformacionLote[]>();
  for (const trozo of trocear(idsSinProducto, IDS_POR_CONSULTA)) {
    const { data, error } = await supabaseAdmin
      .from('transformacion_entrada_detalle')
      .select('transformacion_id, producto_id, peso_kg')
      .in('transformacion_id', trozo);
    if (error) throw new Error(`No se pudo leer lo que entró a las transformaciones: ${error.message}`);
    for (const e of (data as Array<{ transformacion_id: string; producto_id: string | null; peso_kg: number | string | null }> | null) ?? []) {
      const lista = entradas.get(e.transformacion_id) ?? [];
      lista.push({ productoId: e.producto_id, pesoKg: num(e.peso_kg) });
      entradas.set(e.transformacion_id, lista);
    }
  }

  return filas.map(f => ({
    transformacionId: f.transformacion_id,
    productoId: f.producto_id,
    pesoNeto: num(f.peso_neto),
    fecha: dia(f.transformaciones?.fecha),
    completa: f.transformaciones?.estado === 'completa',
    almacenId: f.almacen_id ?? f.transformaciones?.almacen_id ?? null,
    entradas: entradas.get(f.transformacion_id) ?? [],
  }));
}

async function leerProductos(ids: string[]): Promise<Map<string, { nombre: string; categoria: string }>> {
  const mapa = new Map<string, { nombre: string; categoria: string }>();
  for (const trozo of trocear(ids, IDS_POR_CONSULTA)) {
    const { data, error } = await supabaseAdmin.from('productos').select('id, nombre, tipos_material(nombre)').in('id', trozo);
    if (error) throw new Error(`No se pudo leer los productos: ${error.message}`);
    for (const p of (data as unknown as Array<{ id: string; nombre: string; tipos_material: { nombre: string } | null }> | null) ?? []) {
      mapa.set(p.id, { nombre: p.nombre, categoria: p.tipos_material?.nombre ?? 'Sin categoría' });
    }
  }
  return mapa;
}

/** null si el lote no existe (la ruta responde 404). */
export async function obtenerComposicionLote(loteId: string, opts: OpcionesComposicionLote = {}): Promise<ComposicionLote | null> {
  const { data: lote, error } = await supabaseAdmin.from('lotes').select('id, nombre').eq('id', loteId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el lote: ${error.message}`);
  if (!lote) return null;

  const [stockPorProducto, stockTotalKg, compras, salidas] = await Promise.all([
    leerStockPorProducto(loteId, opts.almacenId),
    leerStockTotal(loteId, opts.almacenId),
    leerCompras(loteId),
    leerSalidasHaciaLote(loteId),
  ]);

  const comprado = calcularCompradoPeriodo(compras, salidas, opts);
  const ids = [...new Set([...stockPorProducto.map(s => s.productoId), ...comprado.porProducto.keys()])];
  const productos = await leerProductos(ids);

  const armado = armarComposicion({
    nombreLote: (lote as { nombre: string }).nombre,
    stockPorProducto,
    stockTotalKg,
    productos,
    comprado,
    stockHeredado: hayStockHeredado(salidas, opts.almacenId),
  });
  return { loteId, aproximado: armado.aproximado, items: armado.items, totales: armado.totales, nota: armado.nota };
}
