import { supabaseAdmin } from '../config/supabase.js';
import type { CrearProductoInput, ActualizarProductoInput } from '../schemas/productos.js';

type TipoProducto = 'amarillo' | 'azul' | 'verde';

interface ProductoRow {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo_material_id: string | null;
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  imagen_url: string | null;
  creado_por: string | null;
  creado_en: string;
  peso: number | null;
  costo_unitario: number | null;
  variantes: unknown;
  sub_productos: unknown;
  costo_calculado: number | null;
  // join con tipos_material(nombre)
  tipos_material?: { nombre: string } | null;
}

export interface ProductoPublico {
  id: string;
  nombre: string;
  descripcion: string;
  tipoMaterialId: string | null;
  tipoMaterialNombre: string | null;
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  imagenUrl: string | null;
  creadoPor: string;
  creadoEn: string;
  peso?: number;
  costoUnitario?: number;
  variantes?: unknown;
  subProductos?: unknown;
  costoCalculado?: number;
}

function toPublico(row: ProductoRow): ProductoPublico {
  const base = {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion ?? '',
    tipoMaterialId: row.tipo_material_id,
    tipoMaterialNombre: row.tipos_material?.nombre ?? null,
    moneda: row.moneda,
    activo: row.activo,
    tipo: row.tipo,
    imagenUrl: row.imagen_url,
    creadoPor: row.creado_por ?? '',
    creadoEn: row.creado_en,
  };
  if (row.tipo === 'amarillo') {
    return { ...base, peso: row.peso ?? 0, costoUnitario: row.costo_unitario ?? 0 };
  }
  if (row.tipo === 'azul') {
    return { ...base, variantes: row.variantes ?? [] };
  }
  return { ...base, subProductos: row.sub_productos ?? [], costoCalculado: row.costo_calculado ?? 0 };
}

function inputToRow(input: CrearProductoInput, creadoPor?: string): Record<string, unknown> {
  const row: Record<string, unknown> = {
    nombre: input.nombre,
    descripcion: input.descripcion,
    tipo_material_id: input.tipoMaterialId,
    moneda: input.moneda,
    activo: input.activo,
    tipo: input.tipo,
    imagen_url: input.imagenUrl ?? null,
  };
  if (creadoPor !== undefined) row.creado_por = creadoPor;

  if (input.tipo === 'amarillo') {
    row.peso = input.peso;
    row.costo_unitario = input.costoUnitario;
    row.variantes = null;
    row.sub_productos = null;
    row.costo_calculado = null;
  } else if (input.tipo === 'azul') {
    row.variantes = input.variantes;
    row.peso = null;
    row.costo_unitario = null;
    row.sub_productos = null;
    row.costo_calculado = null;
  } else {
    row.sub_productos = input.subProductos;
    row.costo_calculado = input.costoCalculado;
    row.peso = null;
    row.costo_unitario = null;
    row.variantes = null;
  }

  return row;
}

export async function listarProductos(): Promise<ProductoPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('productos')
    .select('*, tipos_material(nombre)')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return (data as unknown as ProductoRow[]).map(toPublico);
}

export async function crearProducto(
  input: CrearProductoInput,
  creadoPor: string
): Promise<{ producto: ProductoPublico } | { error: string }> {
  const row = inputToRow(input, creadoPor);

  const { data, error } = await supabaseAdmin
    .from('productos')
    .insert(row)
    .select('*, tipos_material(nombre)')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el producto.' };
  return { producto: toPublico(data as unknown as ProductoRow) };
}

export async function actualizarProducto(
  id: string,
  input: ActualizarProductoInput
): Promise<{ producto: ProductoPublico } | { error: string }> {
  const { data: existente, error: errExist } = await supabaseAdmin
    .from('productos')
    .select('tipo')
    .eq('id', id)
    .maybeSingle();

  if (errExist) return { error: errExist.message };
  if (!existente) return { error: 'Producto no encontrado.' };

  if (existente.tipo !== input.tipo) {
    return { error: `No se puede cambiar el tipo de un producto existente (era "${existente.tipo}", recibido "${input.tipo}").` };
  }

  const row = inputToRow(input);

  const { data, error } = await supabaseAdmin
    .from('productos')
    .update(row)
    .eq('id', id)
    .select('*, tipos_material(nombre)')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Producto no encontrado al actualizar.' };
  return { producto: toPublico(data as unknown as ProductoRow) };
}

export async function desactivarProducto(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('productos')
    .update({ activo: false })
    .eq('id', id);
  return !error;
}

export async function reactivarProducto(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('productos')
    .update({ activo: true })
    .eq('id', id);
  return !error;
}

export interface BorrarProductoResult {
  ok: boolean;
  razon?: string;
  referencias?: { facturaItems: number };
}

/**
 * Borrado físico. Solo permitido si el producto NO está referenciado por
 * factura_items. Si lo está, mantenerlo desactivado para preservar historial.
 */
export async function borrarProducto(id: string): Promise<BorrarProductoResult> {
  const { count } = await supabaseAdmin
    .from('factura_items')
    .select('id', { count: 'exact', head: true })
    .eq('producto_id', id);

  const facturaItems = count ?? 0;
  if (facturaItems > 0) {
    return {
      ok: false,
      razon: `El producto aparece en ${facturaItems} línea${facturaItems > 1 ? 's' : ''} de factura. No se puede borrar; mantenlo desactivado para preservar el historial.`,
      referencias: { facturaItems },
    };
  }

  const { error } = await supabaseAdmin.from('productos').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
