import { supabase } from '../config/supabase';
import type { Factura, FacturaItem } from '@shared/types/index.js';

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

export async function crearFactura(input: CrearFacturaInput): Promise<Factura | null> {
  const subtotal = input.items.reduce((sum, i) => sum + i.precioUnitario * i.cantidad, 0);
  const total = subtotal;

  // Crear la factura
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

  // Crear los items
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

  return {
    id: factura.id,
    numero: factura.numero,
    creadoPor: factura.creado_por,
    estado: factura.estado,
    subtotal: factura.subtotal,
    total: factura.total,
    moneda: factura.moneda,
    nota: factura.nota ?? '',
    creadoEn: factura.creado_en,
    items: (items ?? []).map(mapItem),
  };
}

export async function obtenerFacturas(): Promise<Factura[]> {
  const { data, error } = await supabase
    .from('facturas')
    .select('*, factura_items(*), users!creado_por(nombre)')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];

  return data.map(row => ({
    id: row.id,
    numero: row.numero,
    creadoPor: row.creado_por,
    nombreCreador: (row.users as Record<string, unknown>)?.nombre as string ?? '',
    estado: row.estado,
    subtotal: row.subtotal,
    total: row.total,
    moneda: row.moneda,
    nota: row.nota ?? '',
    creadoEn: row.creado_en,
    items: (row.factura_items as Record<string, unknown>[] ?? []).map(mapItem),
  }));
}

export async function obtenerFacturasPorUsuario(userId: string): Promise<Factura[]> {
  const { data, error } = await supabase
    .from('facturas')
    .select('*, factura_items(*)')
    .eq('creado_por', userId)
    .order('creado_en', { ascending: false });

  if (error || !data) return [];

  return data.map(row => ({
    id: row.id,
    numero: row.numero,
    creadoPor: row.creado_por,
    estado: row.estado,
    subtotal: row.subtotal,
    total: row.total,
    moneda: row.moneda,
    nota: row.nota ?? '',
    creadoEn: row.creado_en,
    items: (row.factura_items as Record<string, unknown>[] ?? []).map(mapItem),
  }));
}

function mapItem(row: Record<string, unknown>): FacturaItem {
  return {
    id: row.id as string,
    facturaId: row.factura_id as string,
    productoId: row.producto_id as string,
    nombreProducto: row.nombre_producto as string,
    cantidad: row.cantidad as number,
    precioUnitario: row.precio_unitario as number,
    subtotal: row.subtotal as number,
  };
}
