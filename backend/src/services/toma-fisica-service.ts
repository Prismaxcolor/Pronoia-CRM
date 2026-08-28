import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTomaFisicaInput, RegistrarPesajeTomaFisicaInput } from '../schemas/toma-fisica.js';

/** Duplicado intencional de shared/types/toma-fisica.ts (mismo patrón que
 *  formatCodigoPesaje / formatCodigoTraslado — @shared no resuelve limpio
 *  en runtime con tsx + ESM). */
function codigoTomaFisica(numero: number): string {
  return `INV-${String(numero).padStart(4, '0')}`;
}

interface TomaFisicaRow {
  id: string;
  numero: number;
  descripcion: string | null;
  almacen_id: string;
  categorias: string[];
  estado: 'abierta' | 'cerrada';
  abierta_por: string;
  abierta_en: string;
  cerrada_por: string | null;
  cerrada_en: string | null;
  created_at: string;
  almacenes?: { nombre: string } | null;
}

export interface TomaFisicaPublica {
  id: string;
  codigo: string;
  numero: number;
  descripcion: string | null;
  almacenId: string;
  almacenNombre: string | null;
  categoriaIds: string[];
  categoriaNombres: string[];
  estado: 'abierta' | 'cerrada';
  abiertaPor: string;
  abiertaEn: string;
  cerradaPor: string | null;
  cerradaEn: string | null;
  createdAt: string;
}

export interface DetalleTomaFisicaPublico {
  id: string;
  tomaFisicaId: string;
  productoId: string;
  nombreProducto: string;
  loteId: string | null;
  nombreLote: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotos: string[];
  registradoPor: string;
  createdAt: string;
}

export interface ResumenTomaFisicaLinea {
  productoId: string;
  productoNombre: string;
  loteId: string | null;
  loteNombre: string | null;
  stockTeorico: number;
  stockReal: number;
  diferencia: number;
  cantidadPesajes: number;
}

async function nombresCategorias(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('tipos_material').select('id, nombre').in('id', ids);
  return new Map((data ?? []).map(r => [r.id as string, r.nombre as string]));
}

async function toPublico(row: TomaFisicaRow): Promise<TomaFisicaPublica> {
  const nombres = await nombresCategorias(row.categorias ?? []);
  return {
    id: row.id,
    codigo: codigoTomaFisica(row.numero),
    numero: row.numero,
    descripcion: row.descripcion,
    almacenId: row.almacen_id,
    almacenNombre: row.almacenes?.nombre ?? null,
    categoriaIds: row.categorias ?? [],
    categoriaNombres: (row.categorias ?? []).map(id => nombres.get(id) ?? '—'),
    estado: row.estado,
    abiertaPor: row.abierta_por,
    abiertaEn: row.abierta_en,
    cerradaPor: row.cerrada_por,
    cerradaEn: row.cerrada_en,
    createdAt: row.created_at,
  };
}

export async function listarTomasFisicas(): Promise<TomaFisicaPublica[]> {
  const { data, error } = await supabaseAdmin
    .from('tomas_fisicas_inventario')
    .select('*, almacenes(nombre)')
    .order('numero', { ascending: false });

  if (error || !data) return [];
  return Promise.all((data as TomaFisicaRow[]).map(toPublico));
}

export async function obtenerTomaFisica(id: string): Promise<TomaFisicaPublica | null> {
  const { data, error } = await supabaseAdmin
    .from('tomas_fisicas_inventario')
    .select('*, almacenes(nombre)')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toPublico(data as TomaFisicaRow);
}

export async function crearTomaFisica(
  input: CrearTomaFisicaInput,
  abiertaPor: string
): Promise<{ tomaFisica: TomaFisicaPublica } | { error: string }> {
  const { data, error } = await supabaseAdmin.rpc('crear_toma_fisica_inventario', {
    p_almacen_id: input.almacenId,
    p_categorias: input.categoriaIds,
    p_descripcion: input.descripcion,
    p_abierta_por: abiertaPor,
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la toma física.' };
  const tomaFisica = await obtenerTomaFisica(data as string);
  if (!tomaFisica) return { error: 'La toma física se creó pero no se pudo leer de vuelta.' };
  return { tomaFisica };
}

export async function listarDetalleTomaFisica(tomaFisicaId: string): Promise<DetalleTomaFisicaPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('detalle_toma_fisica')
    .select('*, productos(nombre), lotes(nombre)')
    .eq('toma_fisica_id', tomaFisicaId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(row => ({
    id: row.id as string,
    tomaFisicaId: row.toma_fisica_id as string,
    productoId: row.producto_id as string,
    nombreProducto: (row.productos as { nombre: string } | null)?.nombre ?? '—',
    loteId: row.lote_id as string | null,
    nombreLote: (row.lotes as { nombre: string } | null)?.nombre ?? null,
    pesoBruto: Number(row.peso_bruto),
    tara: Number(row.tara),
    pesoNeto: Number(row.peso_neto),
    fotos: (row.fotos as string[]) ?? [],
    registradoPor: row.registrado_por as string,
    createdAt: row.created_at as string,
  }));
}

export async function registrarPesajeTomaFisica(
  tomaFisicaId: string,
  input: RegistrarPesajeTomaFisicaInput,
  registradoPor: string
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabaseAdmin.rpc('registrar_pesaje_toma_fisica', {
    p_toma_fisica_id: tomaFisicaId,
    p_producto_id: input.productoId,
    p_lote_id: input.loteId ?? null,
    p_peso_bruto: input.pesoBruto,
    p_tara: input.tara,
    p_fotos: input.fotos,
    p_registrado_por: registradoPor,
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el pesaje.' };
  return { id: data as string };
}

export async function eliminarPesajeTomaFisica(detalleId: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('eliminar_pesaje_toma_fisica', { p_detalle_id: detalleId });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function resumenTomaFisica(tomaFisicaId: string): Promise<ResumenTomaFisicaLinea[]> {
  const { data, error } = await supabaseAdmin.rpc('resumen_toma_fisica', { p_toma_fisica_id: tomaFisicaId });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map(row => ({
    productoId: row.producto_id as string,
    productoNombre: row.producto_nombre as string,
    loteId: row.lote_id as string | null,
    loteNombre: row.lote_nombre as string | null,
    stockTeorico: Number(row.stock_teorico),
    stockReal: Number(row.stock_real),
    diferencia: Number(row.diferencia),
    cantidadPesajes: Number(row.cantidad_pesajes),
  }));
}

export async function culminarTomaFisica(
  tomaFisicaId: string,
  cerradaPor: string
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('culminar_toma_fisica_inventario', {
    p_toma_fisica_id: tomaFisicaId,
    p_cerrada_por: cerradaPor,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
