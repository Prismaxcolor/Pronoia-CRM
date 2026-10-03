import { supabaseAdmin } from '../config/supabase.js';
import type { CrearProductoInput, ActualizarProductoInput } from '../schemas/productos.js';
import { logger } from '../utils/logger.js';

type TipoProducto = 'amarillo' | 'azul' | 'verde';

interface ProductoRow {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo_material_id: string | null;
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  fotos: string[] | null;
  creado_por: string | null;
  creado_en: string;
  peso: number | null;
  variantes: unknown;
  sub_productos: unknown;
  // join con tipos_material(nombre, sin_lote)
  tipos_material?: { nombre: string; sin_lote: boolean } | null;
  // join con producto_lotes(lote_id)
  producto_lotes?: Array<{ lote_id: string }> | null;
}

/** Columnas + joins que devuelven todas las lecturas de productos. */
const SELECT_PRODUCTO = '*, tipos_material(nombre, sin_lote), producto_lotes(lote_id)';

export interface ProductoPublico {
  id: string;
  nombre: string;
  descripcion: string;
  tipoMaterialId: string | null;
  tipoMaterialNombre: string | null;
  tipoMaterialSinLote: boolean | null;
  /** Lotes posibles del producto; vacío = no está anclado a ningún lote. */
  loteIds: string[];
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  fotos: string[];
  creadoPor: string;
  creadoEn: string;
  peso?: number;
  variantes?: unknown;
  subProductos?: unknown;
}

function toPublico(row: ProductoRow): ProductoPublico {
  const base = {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion ?? '',
    tipoMaterialId: row.tipo_material_id,
    tipoMaterialNombre: row.tipos_material?.nombre ?? null,
    tipoMaterialSinLote: row.tipos_material?.sin_lote ?? null,
    loteIds: (row.producto_lotes ?? []).map(r => r.lote_id),
    moneda: row.moneda,
    activo: row.activo,
    tipo: row.tipo,
    fotos: row.fotos ?? [],
    creadoPor: row.creado_por ?? '',
    creadoEn: row.creado_en,
  };
  if (row.tipo === 'amarillo') {
    return { ...base, peso: row.peso ?? 0 };
  }
  if (row.tipo === 'azul') {
    return { ...base, variantes: row.variantes ?? [] };
  }
  return { ...base, subProductos: row.sub_productos ?? [] };
}

function inputToRow(input: CrearProductoInput, creadoPor?: string): Record<string, unknown> {
  const row: Record<string, unknown> = {
    nombre: input.nombre,
    descripcion: input.descripcion,
    tipo_material_id: input.tipoMaterialId,
    moneda: input.moneda,
    activo: input.activo,
    tipo: input.tipo,
    fotos: input.fotos ?? [],
  };
  if (creadoPor !== undefined) row.creado_por = creadoPor;

  if (input.tipo === 'amarillo') {
    row.peso = input.peso;
    row.variantes = null;
    row.sub_productos = null;
  } else if (input.tipo === 'azul') {
    row.variantes = input.variantes;
    row.peso = null;
    row.sub_productos = null;
  } else {
    row.sub_productos = input.subProductos;
    row.peso = null;
    row.variantes = null;
  }

  return row;
}

/** Reemplaza de forma atómica los lotes posibles de un producto (RPC). */
async function guardarLotesProducto(productoId: string, loteIds: string[]): Promise<string | null> {
  const { error } = await supabaseAdmin.rpc('reemplazar_producto_lotes', {
    p_producto_id: productoId,
    p_lote_ids: loteIds,
  });
  return error ? error.message : null;
}

export async function listarProductos(): Promise<ProductoPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('productos')
    .select(SELECT_PRODUCTO)
    .order('orden', { ascending: true });

  if (error || !data) return [];
  return (data as unknown as ProductoRow[]).map(toPublico);
}

export async function crearProducto(
  input: CrearProductoInput,
  creadoPor: string
): Promise<{ producto: ProductoPublico } | { error: string }> {
  const row = inputToRow(input, creadoPor);

  // Los productos nuevos aparecen primero (orden más bajo), igual que antes
  // cuando el catálogo se mostraba por fecha de creación descendente. El
  // usuario puede reordenarlo manualmente después con reordenarProductos.
  const { data: primero } = await supabaseAdmin
    .from('productos')
    .select('orden')
    .order('orden', { ascending: true })
    .limit(1)
    .maybeSingle();
  row.orden = ((primero as { orden: number } | null)?.orden ?? 0) - 1;

  const { data, error } = await supabaseAdmin
    .from('productos')
    .insert(row)
    .select(SELECT_PRODUCTO)
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el producto.' };
  const creado = data as unknown as ProductoRow;

  const loteIdsNuevos = [...new Set(input.loteIds ?? [])];
  const errorLotes = await guardarLotesProducto(creado.id, loteIdsNuevos);
  if (errorLotes) {
    // El producto no debe quedar creado a medias: sin sus lotes elegidos.
    const { error: errorRollback } = await supabaseAdmin.from('productos').delete().eq('id', creado.id);
    if (errorRollback) {
      logger.error({ evento: 'producto.rollback_crear_fallido', productoId: creado.id, errorLotes, errorRollback: errorRollback.message });
      return {
        error: `No se pudieron guardar los lotes (${errorLotes}) y tampoco se pudo deshacer la creación: el producto "${creado.nombre}" quedó creado sin lotes. Revísalo en el catálogo.`,
      };
    }
    return { error: errorLotes };
  }
  return { producto: toPublico({ ...creado, producto_lotes: loteIdsNuevos.map(lote_id => ({ lote_id })) }) };
}

/** Persiste el nuevo orden manual del catálogo: ids en el orden deseado,
 *  de arriba a abajo. Asigna orden = índice en el arreglo recibido. */
export async function reordenarProductos(ids: string[]): Promise<{ ok: true } | { error: string }> {
  const resultados = await Promise.all(
    ids.map((id, indice) =>
      supabaseAdmin.from('productos').update({ orden: indice }).eq('id', id)
    )
  );

  const fallo = resultados.find(r => r.error);
  if (fallo?.error) return { error: fallo.error.message };
  return { ok: true };
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

  // Los lotes (RPC atómico, puede rechazar el cambio) se guardan primero: si
  // fallan no se toca ningún campo. Si luego falla el update de campos, se
  // restauran los lotes anteriores para no dejar el producto a medias.
  const loteIds = input.loteIds === undefined ? null : [...new Set(input.loteIds)];
  let lotesAnteriores: string[] | null = null;
  if (loteIds) {
    const { data: previos, error: errPrevios } = await supabaseAdmin
      .from('producto_lotes')
      .select('lote_id')
      .eq('producto_id', id);
    if (errPrevios) return { error: errPrevios.message };
    lotesAnteriores = ((previos ?? []) as Array<{ lote_id: string }>).map(p => p.lote_id);

    const errorLotes = await guardarLotesProducto(id, loteIds);
    if (errorLotes) return { error: errorLotes };
  }

  const { data, error } = await supabaseAdmin
    .from('productos')
    .update(row)
    .eq('id', id)
    .select(SELECT_PRODUCTO)
    .maybeSingle();

  if (error || !data) {
    const mensaje = error?.message ?? 'Producto no encontrado al actualizar.';
    if (lotesAnteriores) {
      const errorRestaurar = await guardarLotesProducto(id, lotesAnteriores);
      if (errorRestaurar) {
        logger.error({ evento: 'producto.rollback_lotes_fallido', productoId: id, errorUpdate: mensaje, errorRestaurar });
        return { error: `${mensaje} Además no se pudieron restaurar los lotes anteriores (${errorRestaurar}): revisa los lotes del producto.` };
      }
    }
    return { error: mensaje };
  }

  if (!loteIds) return { producto: toPublico(data as unknown as ProductoRow) };
  return {
    producto: toPublico({
      ...(data as unknown as ProductoRow),
      producto_lotes: loteIds.map(lote_id => ({ lote_id })),
    }),
  };
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
