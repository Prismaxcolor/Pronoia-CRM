import { supabase } from '../config/supabase';
import type { Factura, FacturaItem, EstadoFactura } from '@shared/types/index.js';

interface CrearFacturaInput {
  creadoPor: string;
  moneda: string;
  nota: string;
  items: {
    productoId: string;
    nombreProducto: string;
    cantidad: number;
    precioUnitario: number;
  }[];
}

function mapItem(row: Record<string, unknown>): FacturaItem {
  return {
    id: row.id as string,
    facturaId: row.factura_id as string,
    productoId: row.producto_id as string,
    nombreProducto: row.nombre_producto as string,
    cantidad: Number(row.cantidad),
    precioUnitario: Number(row.precio_unitario),
    subtotal: Number(row.subtotal),
  };
}

function mapFactura(row: Record<string, unknown>, items: FacturaItem[] = []): Factura {
  const usersField = row.users as Record<string, unknown> | null;
  return {
    id: row.id as string,
    numero: Number(row.numero),
    creadoPor: row.creado_por as string,
    nombreCreador: (usersField?.nombre as string) ?? '',
    estado: row.estado as EstadoFactura,
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    moneda: row.moneda as string,
    nota: (row.nota as string) ?? '',
    items,
    creadoEn: row.creado_en as string,
  };
}

/** Crea una factura confirmada de una vez (con todos sus items). Usa el flujo viejo. */
export async function crearFactura(input: CrearFacturaInput): Promise<Factura | null> {
  const subtotal = input.items.reduce((sum, i) => sum + i.precioUnitario * i.cantidad, 0);
  const total = subtotal;

  const { data: factura, error: errFactura } = await supabase
    .from('facturas')
    .insert({
      creado_por: input.creadoPor,
      moneda: input.moneda,
      nota: input.nota,
      subtotal,
      total,
      estado: 'confirmada',
    })
    .select()
    .single();

  if (errFactura || !factura) return null;

  const itemsToInsert = input.items.map(i => ({
    factura_id: factura.id,
    producto_id: i.productoId,
    nombre_producto: i.nombreProducto,
    cantidad: i.cantidad,
    precio_unitario: i.precioUnitario,
    subtotal: i.precioUnitario * i.cantidad,
  }));

  const { data: items, error: errItems } = await supabase
    .from('factura_items')
    .insert(itemsToInsert)
    .select();

  if (errItems) return null;
  return mapFactura(factura, (items ?? []).map(mapItem));
}

export async function obtenerFacturas(): Promise<Factura[]> {
  const { data, error } = await supabase
    .from('facturas')
    .select('*, factura_items(*), users!creado_por(nombre)')
    .eq('estado', 'confirmada')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];

  return data.map(row => mapFactura(row, (row.factura_items as Record<string, unknown>[] ?? []).map(mapItem)));
}

export async function obtenerFacturasPorUsuario(userId: string): Promise<Factura[]> {
  const { data, error } = await supabase
    .from('facturas')
    .select('*, factura_items(*)')
    .eq('creado_por', userId)
    .eq('estado', 'confirmada')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];

  return data.map(row => mapFactura(row, (row.factura_items as Record<string, unknown>[] ?? []).map(mapItem)));
}

// ============================================================================
// Funciones para flujo de borradores
// ============================================================================

export async function crearBorrador(creadoPor: string, moneda: string = 'USD'): Promise<Factura | null> {
  const { data, error } = await supabase
    .from('facturas')
    .insert({
      creado_por: creadoPor,
      moneda,
      nota: '',
      subtotal: 0,
      total: 0,
      estado: 'borrador',
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error al crear borrador:', error);
    return null;
  }
  return mapFactura(data);
}

export async function obtenerBorradoresDelUsuario(userId: string): Promise<Factura[]> {
  const { data, error } = await supabase
    .from('facturas')
    .select('*, factura_items(*)')
    .eq('creado_por', userId)
    .eq('estado', 'borrador')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return data.map(row => mapFactura(row, (row.factura_items as Record<string, unknown>[] ?? []).map(mapItem)));
}

export async function obtenerFacturaPorId(id: string): Promise<Factura | null> {
  const { data, error } = await supabase
    .from('facturas')
    .select('*, factura_items(*), users!creado_por(nombre)')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return mapFactura(data, (data.factura_items as Record<string, unknown>[] ?? []).map(mapItem));
}

interface AgregarItemInput {
  facturaId: string;
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
}

export async function agregarItem(input: AgregarItemInput): Promise<FacturaItem | null> {
  const { data, error } = await supabase
    .from('factura_items')
    .insert({
      factura_id: input.facturaId,
      producto_id: input.productoId,
      nombre_producto: input.nombreProducto,
      cantidad: input.cantidad,
      precio_unitario: input.precioUnitario,
      subtotal: input.cantidad * input.precioUnitario,
    })
    .select()
    .single();

  if (error || !data) return null;

  await recalcularTotalesFactura(input.facturaId);
  return mapItem(data);
}

export async function actualizarCantidadItem(itemId: string, cantidad: number, precioUnitario: number, facturaId: string): Promise<boolean> {
  const { error } = await supabase
    .from('factura_items')
    .update({
      cantidad,
      subtotal: cantidad * precioUnitario,
    })
    .eq('id', itemId);

  if (error) return false;
  await recalcularTotalesFactura(facturaId);
  return true;
}

export async function eliminarItem(itemId: string, facturaId: string): Promise<boolean> {
  const { error } = await supabase
    .from('factura_items')
    .delete()
    .eq('id', itemId);

  if (error) return false;
  await recalcularTotalesFactura(facturaId);
  return true;
}

export async function actualizarNotaFactura(id: string, nota: string): Promise<boolean> {
  const { error } = await supabase
    .from('facturas')
    .update({ nota })
    .eq('id', id);
  return !error;
}

export async function confirmarFactura(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('facturas')
    .update({ estado: 'confirmada' })
    .eq('id', id)
    .eq('estado', 'borrador');
  return !error;
}

/** Elimina un borrador (factura + items). Solo funciona si la factura está en estado borrador. */
export async function eliminarBorrador(id: string): Promise<boolean> {
  const { data: factura } = await supabase
    .from('facturas')
    .select('estado')
    .eq('id', id)
    .maybeSingle();

  if (!factura || factura.estado !== 'borrador') return false;

  await supabase.from('factura_items').delete().eq('factura_id', id);

  const { error } = await supabase.from('facturas').delete().eq('id', id);
  return !error;
}

/** Recalcula y persiste subtotal/total de una factura sumando sus items. */
async function recalcularTotalesFactura(facturaId: string): Promise<void> {
  const { data: items } = await supabase
    .from('factura_items')
    .select('subtotal')
    .eq('factura_id', facturaId);

  const subtotal = (items ?? []).reduce((sum, it) => sum + Number(it.subtotal), 0);
  const total = subtotal;

  await supabase
    .from('facturas')
    .update({ subtotal, total })
    .eq('id', facturaId);
}
