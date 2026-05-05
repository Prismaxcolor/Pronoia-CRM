import { supabase } from '../config/supabase';
import { PRODUCTOS_MOCK } from './mock-data';
import type { Producto, TipoProducto, VarianteProducto, SubProductoRef } from '@shared/types/index.js';

function mapRow(row: Record<string, unknown>): Producto {
  const base = {
    id: row.id as string,
    nombre: row.nombre as string,
    descripcion: row.descripcion as string,
    categoria: row.categoria as string,
    moneda: row.moneda as string,
    activo: row.activo as boolean,
    imagenUrl: (row.imagen_url as string) ?? null,
    creadoPor: (row.creado_por as string) ?? '',
    creadoEn: (row.creado_en as string) ?? '',
  };
  const tipo = row.tipo as TipoProducto;

  if (tipo === 'azul') {
    return { ...base, tipo: 'azul', variantes: (row.variantes ?? []) as VarianteProducto[] };
  }
  if (tipo === 'verde') {
    return { ...base, tipo: 'verde', subProductos: (row.sub_productos ?? []) as SubProductoRef[], costoCalculado: (row.costo_calculado as number) ?? 0 };
  }
  return { ...base, tipo: 'amarillo', peso: (row.peso as number) ?? 0, costoUnitario: (row.costo_unitario as number) ?? 0 };
}

export async function obtenerProductos(): Promise<Producto[]> {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return PRODUCTOS_MOCK;
  return data.map(mapRow);
}

export async function crearProducto(producto: Omit<Producto, 'id' | 'creadoEn'>): Promise<Producto | null> {
  const row: Record<string, unknown> = {
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    categoria: producto.categoria,
    moneda: producto.moneda,
    activo: producto.activo,
    tipo: producto.tipo,
    imagen_url: producto.imagenUrl || null,
    creado_por: producto.creadoPor || null,
  };

  if (producto.tipo === 'amarillo') {
    row.peso = producto.peso;
    row.costo_unitario = producto.costoUnitario;
  } else if (producto.tipo === 'azul') {
    row.variantes = producto.variantes;
  } else if (producto.tipo === 'verde') {
    row.sub_productos = producto.subProductos;
    row.costo_calculado = producto.costoCalculado;
  }

  const { data, error } = await supabase
    .from('productos')
    .insert(row)
    .select()
    .single();

  if (error || !data) return null;
  return mapRow(data);
}
