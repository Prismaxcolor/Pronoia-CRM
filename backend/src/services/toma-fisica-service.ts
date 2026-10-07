import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTomaFisicaInput, RegistrarPesajeTomaFisicaInput } from '../schemas/toma-fisica.js';
import { categoriaIdsConProductosAnclados } from './tipo-material-service.js';
import { lotesElegiblesDeCategorias } from './toma-fisica-opciones-service.js';
import {
  categoriaSinLoteEfectivo,
  derivarAlcance,
  validarAlcance,
  buscarTomaSolapada,
  lineasLotesSinContar,
  resolverProductosToma,
  type AlcanceToma,
} from '../utils/toma-fisica-alcance.js';
import { nombresDeUsuarios } from './autoria-documento.js';

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
  lote_ids: string[] | null;
  /** Materiales elegidos (migration_toma_fisica_productos.sql). null = toda la categoría. */
  producto_ids?: string[] | null;
  estado: 'abierta' | 'cerrada' | 'cancelada';
  abierta_por: string;
  abierta_en: string;
  cerrada_por: string | null;
  cerrada_en: string | null;
  created_at: string;
  snapshot_resumen: Array<Record<string, unknown>> | null;
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
  loteIds: string[];
  loteNombres: string[];
  /** Materiales elegidos en una toma "Por categoría"; vacío = toda la categoría. */
  productoIds: string[];
  /** 'categoria' = productos de categorías sin lote; 'lote' = lotes completos.
   *  Derivado (sin columna): las tomas anteriores no cambian. */
  alcance: AlcanceToma;
  estado: 'abierta' | 'cerrada' | 'cancelada';
  abiertaPor: string;
  abiertaEn: string;
  cerradaPor: string | null;
  cerradaEn: string | null;
  createdAt: string;
  snapshotResumen: ResumenTomaFisicaLinea[] | null;
  /** Nombres de quien abrió/cerró la toma; solo en obtenerTomaFisica. */
  abiertaPorNombre?: string | null;
  cerradaPorNombre?: string | null;
}

export interface DetalleTomaFisicaPublico {
  id: string;
  tomaFisicaId: string;
  /** null cuando se pesó un lote PCB completo (sin desglose por material). */
  productoId: string | null;
  nombreProducto: string | null;
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
  /** null en líneas "por lote completo" (PCB) — ver loteId/loteNombre. */
  productoId: string | null;
  productoNombre: string | null;
  loteId: string | null;
  loteNombre: string | null;
  stockTeorico: number;
  stockReal: number;
  diferencia: number;
  cantidadPesajes: number;
}

async function nombresDeTabla(tabla: 'tipos_material' | 'lotes', ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from(tabla).select('id, nombre').in('id', ids);
  return new Map((data ?? []).map(r => [r.id as string, r.nombre as string]));
}

async function categoriasSinLote(ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('tipos_material').select('id, sin_lote').in('id', ids);
  return new Map((data ?? []).map(r => [r.id as string, r.sin_lote === true]));
}

async function toPublico(row: TomaFisicaRow): Promise<TomaFisicaPublica> {
  const loteIds = row.lote_ids ?? [];
  const [nombresCat, nombresLote, sinLotePorCat] = await Promise.all([
    nombresDeTabla('tipos_material', row.categorias ?? []),
    nombresDeTabla('lotes', loteIds),
    categoriasSinLote(row.categorias ?? []),
  ]);
  return {
    id: row.id,
    codigo: codigoTomaFisica(row.numero),
    numero: row.numero,
    descripcion: row.descripcion,
    almacenId: row.almacen_id,
    almacenNombre: row.almacenes?.nombre ?? null,
    categoriaIds: row.categorias ?? [],
    categoriaNombres: (row.categorias ?? []).map(id => nombresCat.get(id) ?? '—'),
    loteIds,
    loteNombres: loteIds.map(id => nombresLote.get(id) ?? '—'),
    productoIds: row.producto_ids ?? [],
    alcance: derivarAlcance(loteIds, (row.categorias ?? []).map(id => sinLotePorCat.get(id) ?? true)),
    estado: row.estado,
    abiertaPor: row.abierta_por,
    abiertaEn: row.abierta_en,
    cerradaPor: row.cerrada_por,
    cerradaEn: row.cerrada_en,
    createdAt: row.created_at,
    snapshotResumen: parseSnapshot(row.snapshot_resumen),
  };
}

function parseSnapshot(raw: Array<Record<string, unknown>> | null): ResumenTomaFisicaLinea[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map(r => ({
    productoId: r.producto_id as string | null,
    productoNombre: r.producto_nombre as string | null,
    loteId: r.lote_id as string | null,
    loteNombre: r.lote_nombre as string | null,
    stockTeorico: Number(r.stock_teorico),
    stockReal: Number(r.stock_real),
    diferencia: Number(r.diferencia),
    cantidadPesajes: Number(r.cantidad_pesajes),
  }));
}

export async function listarTomasFisicas(): Promise<TomaFisicaPublica[]> {
  const { data, error } = await supabaseAdmin
    .from('tomas_fisicas_inventario')
    .select('*, almacenes(nombre), snapshot_resumen')
    .order('numero', { ascending: false });

  if (error || !data) return [];
  return Promise.all((data as TomaFisicaRow[]).map(toPublico));
}

export async function obtenerTomaFisica(id: string): Promise<TomaFisicaPublica | null> {
  const { data, error } = await supabaseAdmin
    .from('tomas_fisicas_inventario')
    .select('*, almacenes(nombre), snapshot_resumen')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  const toma = await toPublico(data as TomaFisicaRow);
  const nombres = await nombresDeUsuarios([toma.abiertaPor, toma.cerradaPor]);
  return {
    ...toma,
    abiertaPorNombre: nombres.get(toma.abiertaPor) ?? null,
    cerradaPorNombre: toma.cerradaPor ? (nombres.get(toma.cerradaPor) ?? null) : null,
  };
}

/** Materiales elegidos de una toma "Por categoría" (null = toda la categoría). */
async function validarProductos(
  input: CrearTomaFisicaInput,
  alcance: AlcanceToma
): Promise<{ error: string } | { productoIds: string[] | null }> {
  if (input.productoIds === undefined) return { productoIds: null };
  if (alcance !== 'categoria') return { error: 'Elegir materiales solo aplica al alcance "Por categoría".' };
  const { data } = await supabaseAdmin
    .from('productos')
    .select('id, tipo_material_id')
    .eq('activo', true)
    .in('tipo_material_id', input.categoriaIds);
  const activos = (data ?? []).map(p => ({ id: p.id as string, categoriaId: p.tipo_material_id as string | null }));
  return resolverProductosToma(input.productoIds, activos, input.categoriaIds);
}

/** Valida alcance, almacén, lotes y solape con tomas abiertas antes de llamar
 *  al RPC (que sigue siendo la barrera final contra solapes). */
async function validarCreacion(
  input: CrearTomaFisicaInput
): Promise<{ error: string } | { alcance: AlcanceToma; productoIds: string[] | null }> {
  const [{ data: almacen }, { data: cats }, anclados] = await Promise.all([
    supabaseAdmin.from('almacenes').select('id, activo').eq('id', input.almacenId).maybeSingle(),
    supabaseAdmin.from('tipos_material').select('id, sin_lote').in('id', input.categoriaIds),
    categoriaIdsConProductosAnclados(input.categoriaIds),
  ]);
  if (!almacen || almacen.activo === false) return { error: 'El almacén elegido no existe o está inactivo.' };

  // Una categoría con productos anclados a lotes se inventaría por lote, aunque
  // esté marcada "sin lote" (los lotes se anclan a productos, no a categorías).
  const categorias = (cats ?? []).map(c => ({
    id: c.id as string,
    sinLote: categoriaSinLoteEfectivo(c.sin_lote === true, anclados.has(c.id as string)),
  }));
  if (categorias.length !== new Set(input.categoriaIds).size) return { error: 'Alguna categoría elegida no existe.' };

  const loteIds = input.loteIds ?? [];
  const alcance = input.alcance ?? derivarAlcance(loteIds, categorias.map(c => c.sinLote));
  const errorAlcance = validarAlcance({ alcance, categorias, loteIds });
  if (errorAlcance) return { error: errorAlcance };

  if (alcance === 'lote') {
    const { data: lotes } = await supabaseAdmin.from('lotes').select('id').eq('activo', true).in('id', loteIds);
    if ((lotes ?? []).length !== new Set(loteIds).size) return { error: 'Algún lote elegido no existe o está inactivo.' };
    const elegibles = new Set(await lotesElegiblesDeCategorias(input.categoriaIds));
    if (loteIds.some(id => !elegibles.has(id))) {
      return { error: 'Algún lote elegido no corresponde a la categoría de la toma (PCB: sin el Lote 4; PGM: solo el Lote 4).' };
    }
  }

  const productos = await validarProductos(input, alcance);
  if ('error' in productos) return productos;

  const { data: abiertas } = await supabaseAdmin
    .from('tomas_fisicas_inventario')
    .select('id, numero, almacen_id, categorias, estado')
    .eq('estado', 'abierta')
    .eq('almacen_id', input.almacenId);
  const solapada = buscarTomaSolapada(
    { almacenId: input.almacenId, categoriaIds: input.categoriaIds },
    (abiertas ?? []).map(t => ({
      id: t.id as string,
      codigo: codigoTomaFisica(Number(t.numero)),
      almacenId: t.almacen_id as string,
      categoriaIds: (t.categorias as string[]) ?? [],
      estado: t.estado as 'abierta',
    }))
  );
  if (solapada) {
    return { error: `Ya hay una toma física abierta (${solapada.codigo}) que incluye alguna de estas categorías en este almacén. Culmínala o cancélala primero.` };
  }
  return { alcance, productoIds: productos.productoIds };
}

export async function crearTomaFisica(
  input: CrearTomaFisicaInput,
  abiertaPor: string
): Promise<{ tomaFisica: TomaFisicaPublica } | { error: string }> {
  const validacion = await validarCreacion(input);
  if ('error' in validacion) return validacion;

  // Por categoría nunca guarda lote_ids; por lote siempre (lista explícita).
  const loteIds = validacion.alcance === 'lote' ? (input.loteIds ?? []) : [];
  const { data, error } = await supabaseAdmin.rpc('crear_toma_fisica_inventario', {
    p_almacen_id: input.almacenId,
    p_categorias: input.categoriaIds,
    p_descripcion: input.descripcion,
    p_abierta_por: abiertaPor,
    p_lote_ids: loteIds.length > 0 ? loteIds : null,
    // Solo con selección parcial: sin ella el RPC histórico (sin este argumento) sigue valiendo.
    ...(validacion.productoIds ? { p_producto_ids: validacion.productoIds } : {}),
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
    productoId: row.producto_id as string | null,
    nombreProducto: (row.productos as { nombre: string } | null)?.nombre ?? null,
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
    p_producto_id: input.productoId ?? null,
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
  // Para tomas físicas cerradas o canceladas devolvemos el snapshot guardado
  // al momento de culminar — resumen_toma_fisica es una vista en vivo que
  // mostraría 0/0/0 de diferencia una vez ajustado el stock.
  const { data: row } = await supabaseAdmin
    .from('tomas_fisicas_inventario')
    .select('estado, snapshot_resumen')
    .eq('id', tomaFisicaId)
    .maybeSingle();

  if (row && row.estado !== 'abierta' && row.snapshot_resumen) {
    return parseSnapshot(row.snapshot_resumen as Array<Record<string, unknown>>) ?? [];
  }

  const { data, error } = await supabaseAdmin.rpc('resumen_toma_fisica', { p_toma_fisica_id: tomaFisicaId });
  if (error || !data) return [];
  const lineas = (data as Array<Record<string, unknown>>).map(r => ({
    productoId: r.producto_id as string | null,
    productoNombre: r.producto_nombre as string | null,
    loteId: r.lote_id as string | null,
    loteNombre: r.lote_nombre as string | null,
    stockTeorico: Number(r.stock_teorico),
    stockReal: Number(r.stock_real),
    diferencia: Number(r.diferencia),
    cantidadPesajes: Number(r.cantidad_pesajes),
  }));
  return row ? [...lineas, ...(await lotesDelAlcanceSinContar(tomaFisicaId, lineas))] : lineas;
}

/** En alcance "Por lote" el resumen del RPC solo lista lotes ya pesados; esto
 *  agrega los demás lotes elegidos (sin contar, diferencia 0) para que el
 *  checklist muestre todo el alcance. No altera lo que ajusta culminar. */
async function lotesDelAlcanceSinContar(
  tomaFisicaId: string,
  lineas: ResumenTomaFisicaLinea[]
): Promise<ResumenTomaFisicaLinea[]> {
  const { data: toma } = await supabaseAdmin
    .from('tomas_fisicas_inventario')
    .select('almacen_id, lote_ids')
    .eq('id', tomaFisicaId)
    .maybeSingle();
  const loteIds = (toma?.lote_ids as string[] | null) ?? [];
  if (!toma || loteIds.length === 0) return [];

  const pendientes = loteIds.filter(id => !lineas.some(l => l.productoId === null && l.loteId === id));
  if (pendientes.length === 0) return [];
  const [nombres, teoricos] = await Promise.all([
    nombresDeTabla('lotes', pendientes),
    Promise.all(pendientes.map(async id => {
      const { data } = await supabaseAdmin.rpc('stock_lote_almacen_total', { p_lote_id: id, p_almacen_id: toma.almacen_id });
      return [id, Number(data ?? 0)] as const;
    })),
  ]);
  return lineasLotesSinContar(loteIds, lineas, new Map(teoricos), nombres);
}

export async function cancelarTomaFisica(
  tomaFisicaId: string,
  canceladaPor: string
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('cancelar_toma_fisica_inventario', {
    p_toma_fisica_id: tomaFisicaId,
    p_cancelada_por: canceladaPor,
  });
  if (error) return { error: error.message };
  return { ok: true };
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
