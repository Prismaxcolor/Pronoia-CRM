import { supabaseAdmin } from '../config/supabase.js';
import type {
  CrearListaInput,
  ActualizarListaInput,
  UpsertPrecioInput,
} from '../schemas/listas-precios.js';

// ---- filas crudas de la BD (snake_case) ------------------------------------

interface ListaRow {
  id: string;
  nombre: string;
  vigente_desde: string | null;
  activo: boolean;
  created_at: string;
}

interface PrecioRow {
  id: string;
  lista_id: string;
  producto_id: string;
  precio: number;
  created_at: string;
  // presente cuando se pide con join `productos(nombre)`
  productos?: { nombre: string } | null;
}

// ---- forma pública (camelCase) ---------------------------------------------

export interface ListaPublica {
  id: string;
  nombre: string;
  vigenteDesde: string | null;
  activo: boolean;
  createdAt: string;
}

export interface PrecioPublico {
  id: string;
  listaId: string;
  productoId: string;
  precio: number;
  createdAt: string;
  nombreProducto?: string;
}

/** Lista activa con el precio de un material concreto (para el selector). */
export interface ListaParaProducto {
  listaId: string;
  nombre: string;
  vigenteDesde: string | null;
  precio: number;
}

function listaToPublico(row: ListaRow): ListaPublica {
  return {
    id: row.id,
    nombre: row.nombre,
    vigenteDesde: row.vigente_desde,
    activo: row.activo,
    createdAt: row.created_at,
  };
}

function precioToPublico(row: PrecioRow): PrecioPublico {
  return {
    id: row.id,
    listaId: row.lista_id,
    productoId: row.producto_id,
    precio: Number(row.precio),
    createdAt: row.created_at,
    nombreProducto: row.productos?.nombre,
  };
}

// ---- cabeceras --------------------------------------------------------------

export async function listarListas(): Promise<ListaPublica[]> {
  const { data, error } = await supabaseAdmin
    .from('listas_precios')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as ListaRow[]).map(listaToPublico);
}

export async function obtenerListaDetalle(
  id: string
): Promise<{ lista: ListaPublica; precios: PrecioPublico[] } | null> {
  const { data: lista, error: errLista } = await supabaseAdmin
    .from('listas_precios')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (errLista || !lista) return null;

  const { data: precios, error: errPrecios } = await supabaseAdmin
    .from('precios_lista')
    .select('*, productos(nombre)')
    .eq('lista_id', id)
    .order('created_at', { ascending: true });

  if (errPrecios) return null;

  return {
    lista: listaToPublico(lista as ListaRow),
    precios: (precios as PrecioRow[] | null ?? []).map(precioToPublico),
  };
}

export async function crearLista(
  input: CrearListaInput
): Promise<{ lista: ListaPublica } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('listas_precios')
    .insert({ nombre: input.nombre, vigente_desde: input.vigenteDesde ?? null })
    .select('*')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la lista.' };
  return { lista: listaToPublico(data as ListaRow) };
}

export async function actualizarLista(
  id: string,
  cambios: ActualizarListaInput
): Promise<{ lista: ListaPublica } | { error: string }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.vigenteDesde !== undefined) update.vigente_desde = cambios.vigenteDesde;
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabaseAdmin
    .from('listas_precios')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Lista no encontrada.' };
  return { lista: listaToPublico(data as ListaRow) };
}

export async function eliminarLista(id: string): Promise<{ ok: boolean; razon?: string }> {
  // on delete cascade borra sus precios_lista. Si una factura referencia la
  // lista, el FK la protege y el delete falla (lo reportamos como conflicto).
  const { error } = await supabaseAdmin.from('listas_precios').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}

// ---- detalle (precios por material) ----------------------------------------

export async function upsertPrecioEnLista(
  listaId: string,
  input: UpsertPrecioInput
): Promise<{ precio: PrecioPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('precios_lista')
    .upsert(
      { lista_id: listaId, producto_id: input.productoId, precio: input.precio },
      { onConflict: 'lista_id,producto_id' }
    )
    .select('*, productos(nombre)')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo guardar el precio.' };
  return { precio: precioToPublico(data as PrecioRow) };
}

export async function eliminarPrecio(
  listaId: string,
  productoId: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('precios_lista')
    .delete()
    .eq('lista_id', listaId)
    .eq('producto_id', productoId);
  return !error;
}

// ---- selector ---------------------------------------------------------------

export async function listasParaProducto(productoId: string): Promise<ListaParaProducto[]> {
  const { data, error } = await supabaseAdmin
    .from('precios_lista')
    .select('precio, listas_precios!inner(id, nombre, vigente_desde, activo)')
    .eq('producto_id', productoId)
    .eq('listas_precios.activo', true);

  if (error || !data) return [];

  // La relación embebida es muchos-a-uno (cada precio tiene una lista), así que
  // en runtime `listas_precios` es un objeto. El cliente sin tipos generados la
  // infiere como array, por eso el cast vía unknown.
  return (data as unknown as Array<{
    precio: number;
    listas_precios: { id: string; nombre: string; vigente_desde: string | null };
  }>).map(row => ({
    listaId: row.listas_precios.id,
    nombre: row.listas_precios.nombre,
    vigenteDesde: row.listas_precios.vigente_desde,
    precio: Number(row.precio),
  }));
}
