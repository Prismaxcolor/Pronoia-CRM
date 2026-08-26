import { supabaseAdmin } from '../config/supabase.js';
import type {
  CrearTransformacionInput,
  CompletarTransformacionInput,
  CrearTransformacionFerrosoInput,
  CompletarTransformacionFerrosoInput,
} from '../schemas/transformaciones.js';

interface EntradaDetalleRow {
  producto_id: string;
  peso_kg: number;
  productos?: { nombre: string } | null;
}

interface SalidaDetalleRow {
  id: string;
  producto_id: string | null;
  lote_destino_id: string | null;
  peso_bruto: number;
  tara: number;
  peso_neto: number;
  fotos: string[] | null;
  productos?: { nombre: string } | null;
  lotes?: { nombre: string } | null;
}

interface TransformacionRow {
  id: string;
  categoria: string;
  producto_entrada_id: string | null;
  almacen_id: string | null;
  lote_origen_id: string | null;
  peso_bruto: number;
  tara: number;
  peso_neto: number;
  fotos_entrada: string[] | null;
  fecha: string;
  estado: 'bruto' | 'completa';
  notas: string | null;
  registrado_por: string | null;
  completado_por: string | null;
  completado_en: string | null;
  created_at: string;
  productos?: { nombre: string } | null;
  lotes?: { nombre: string } | null;
  transformacion_entrada_detalle?: EntradaDetalleRow[] | null;
  transformacion_salida_detalle?: SalidaDetalleRow[] | null;
}

export interface TransformacionPublica {
  id: string;
  categoria: string;
  productoEntradaId: string | null;
  nombreProductoEntrada: string | null;
  almacenId: string | null;
  loteOrigenId: string | null;
  nombreLoteOrigen: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotosEntrada: string[];
  fecha: string;
  estado: 'bruto' | 'completa';
  notas: string | null;
  registradoPor: string | null;
  completadoPor: string | null;
  completadoEn: string | null;
  createdAt: string;
  entradaDetalle: Array<{ productoId: string; nombreProducto: string; pesoKg: number }>;
  salidas: Array<{
    id: string;
    productoId: string | null;
    nombreProducto: string | null;
    loteDestinoId: string | null;
    nombreLoteDestino: string | null;
    pesoBruto: number;
    tara: number;
    pesoNeto: number;
    fotos: string[];
  }>;
}

function toPublico(row: TransformacionRow): TransformacionPublica {
  return {
    id: row.id,
    categoria: row.categoria ?? 'ferroso_no_ferroso',
    productoEntradaId: row.producto_entrada_id,
    nombreProductoEntrada: row.productos?.nombre ?? null,
    almacenId: row.almacen_id,
    loteOrigenId: row.lote_origen_id,
    nombreLoteOrigen: row.lotes?.nombre ?? null,
    pesoBruto: Number(row.peso_bruto),
    tara: Number(row.tara),
    pesoNeto: Number(row.peso_neto),
    fotosEntrada: row.fotos_entrada ?? [],
    fecha: row.fecha,
    estado: row.estado,
    notas: row.notas,
    registradoPor: row.registrado_por,
    completadoPor: row.completado_por,
    completadoEn: row.completado_en,
    createdAt: row.created_at,
    entradaDetalle: (row.transformacion_entrada_detalle ?? []).map(d => ({
      productoId: d.producto_id,
      nombreProducto: d.productos?.nombre ?? '—',
      pesoKg: Number(d.peso_kg),
    })),
    salidas: (row.transformacion_salida_detalle ?? []).map(d => ({
      id: d.id,
      productoId: d.producto_id,
      nombreProducto: d.productos?.nombre ?? null,
      loteDestinoId: d.lote_destino_id,
      nombreLoteDestino: d.lotes?.nombre ?? null,
      pesoBruto: Number(d.peso_bruto),
      tara: Number(d.tara),
      pesoNeto: Number(d.peso_neto),
      fotos: d.fotos ?? [],
    })),
  };
}

const SELECT_TRANSFORMACION =
  '*, ' +
  'productos(nombre), ' +
  'lotes(nombre), ' +
  'transformacion_entrada_detalle(producto_id, peso_kg, productos(nombre)), ' +
  'transformacion_salida_detalle(id, producto_id, lote_destino_id, peso_bruto, tara, peso_neto, fotos, productos(nombre), lotes(nombre))';

export async function obtenerTransformacion(id: string): Promise<TransformacionPublica | null> {
  const { data, error } = await supabaseAdmin
    .from('transformaciones')
    .select(SELECT_TRANSFORMACION)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toPublico(data as unknown as TransformacionRow);
}

export interface ListarTransformacionesOpts {
  desde?: string;
  hasta?: string;
  estado?: 'bruto' | 'completa';
  categoria?: string;
}

export async function listarTransformaciones(
  opts: ListarTransformacionesOpts = {}
): Promise<TransformacionPublica[]> {
  let query = supabaseAdmin
    .from('transformaciones')
    .select(SELECT_TRANSFORMACION)
    .order('created_at', { ascending: false });

  if (opts.desde) query = query.gte('fecha', opts.desde);
  if (opts.hasta) query = query.lte('fecha', opts.hasta);
  if (opts.estado) query = query.eq('estado', opts.estado);
  if (opts.categoria) query = query.eq('categoria', opts.categoria);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as TransformacionRow[]).map(toPublico);
}

/** Legacy: retira de lote-pool. */
export async function crearTransformacion(
  input: CrearTransformacionInput,
  registradoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { data: id, error } = await supabaseAdmin.rpc('crear_transformacion', {
    p_lote_origen_id: input.loteOrigenId,
    p_peso_bruto: input.pesoBruto,
    p_tara: input.tara,
    p_fecha: input.fecha,
    p_notas: input.notas,
    p_registrado_por: registradoPor,
  });

  if (error || !id) return { error: error?.message ?? 'No se pudo registrar la transformación.' };
  const transformacion = await obtenerTransformacion(id as string);
  if (!transformacion) return { error: 'La transformación se creó pero no se pudo leer de vuelta.' };
  return { transformacion };
}

/** Ferroso/No Ferroso: retira producto sin lote de un almacén. */
export async function crearTransformacionFerroso(
  input: CrearTransformacionFerrosoInput,
  registradoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { data: id, error } = await supabaseAdmin.rpc('crear_transformacion_ferroso', {
    p_producto_entrada_id: input.productoEntradaId,
    p_almacen_id: input.almacenId,
    p_peso_bruto: input.pesoBruto,
    p_tara: input.tara,
    p_fecha: input.fecha,
    p_notas: input.notas ?? null,
    p_fotos_entrada: input.fotosEntrada,
    p_registrado_por: registradoPor,
  });

  if (error || !id) return { error: error?.message ?? 'No se pudo registrar la transformación.' };
  const transformacion = await obtenerTransformacion(id as string);
  if (!transformacion) return { error: 'La transformación se creó pero no se pudo leer de vuelta.' };
  return { transformacion };
}

/** Legacy: completa con salidas a lotes. */
export async function completarTransformacion(
  id: string,
  input: CompletarTransformacionInput,
  completadoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('completar_transformacion', {
    p_transformacion_id: id,
    p_salidas: input.salidas.map(s => ({
      lote_destino_id: s.loteDestinoId,
      peso_bruto: s.pesoBruto,
      tara: s.tara,
    })),
    p_completado_por: completadoPor,
  });

  if (error) return { error: error.message };
  const transformacion = await obtenerTransformacion(id);
  if (!transformacion) return { error: 'La transformación se completó pero no se pudo leer de vuelta.' };
  return { transformacion };
}

/** Ferroso/No Ferroso: completa con materiales de salida (sin lote). */
export async function completarTransformacionFerroso(
  id: string,
  input: CompletarTransformacionFerrosoInput,
  completadoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('completar_transformacion_ferroso', {
    p_transformacion_id: id,
    p_salidas: input.salidas.map(s => ({
      producto_id: s.productoId,
      peso_bruto: s.pesoBruto,
      tara: s.tara,
      fotos: s.fotos,
    })),
    p_completado_por: completadoPor,
  });

  if (error) return { error: error.message };
  const transformacion = await obtenerTransformacion(id);
  if (!transformacion) return { error: 'La transformación se completó pero no se pudo leer de vuelta.' };
  return { transformacion };
}

export interface BorrarTransformacionResult { ok: boolean; razon?: string; noEncontrado?: boolean }

export async function borrarTransformacion(id: string): Promise<BorrarTransformacionResult> {
  const { data: t } = await supabaseAdmin
    .from('transformaciones').select('id, estado').eq('id', id).maybeSingle();
  if (!t) return { ok: false, noEncontrado: true, razon: 'Transformación no encontrada.' };
  if (t.estado !== 'bruto') {
    return { ok: false, razon: 'Solo se puede cancelar una transformación que aún no se completó.' };
  }

  const { error } = await supabaseAdmin.from('transformaciones').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Salidas comunes (configuración)
// ---------------------------------------------------------------------------

export interface SalidaComunPublica {
  id: string;
  productoEntradaId: string;
  productoSalidaId: string;
  nombreProductoSalida: string;
  orden: number;
}

interface SalidaComunRow {
  id: string;
  producto_entrada_id: string;
  producto_salida_id: string;
  orden: number;
  productos?: { nombre: string } | null;
}

export async function obtenerSalidasComunes(
  productoEntradaId?: string
): Promise<SalidaComunPublica[]> {
  let query = supabaseAdmin
    .from('transformacion_salidas_comunes')
    .select('id, producto_entrada_id, producto_salida_id, orden, productos:producto_salida_id(nombre)')
    .order('orden');

  if (productoEntradaId) query = query.eq('producto_entrada_id', productoEntradaId);

  const { data } = await query;
  return ((data as unknown as SalidaComunRow[]) ?? []).map(r => ({
    id: r.id,
    productoEntradaId: r.producto_entrada_id,
    productoSalidaId: r.producto_salida_id,
    nombreProductoSalida: r.productos?.nombre ?? '—',
    orden: r.orden,
  }));
}

/** Reemplaza todas las salidas comunes de un producto de entrada. */
export async function guardarSalidasComunesProducto(
  productoEntradaId: string,
  productosSalidaIds: string[]
): Promise<{ ok: true } | { error: string }> {
  const { error: delErr } = await supabaseAdmin
    .from('transformacion_salidas_comunes')
    .delete()
    .eq('producto_entrada_id', productoEntradaId);

  if (delErr) return { error: delErr.message };

  if (productosSalidaIds.length === 0) return { ok: true };

  const rows = productosSalidaIds.map((id, idx) => ({
    producto_entrada_id: productoEntradaId,
    producto_salida_id: id,
    orden: idx,
  }));

  const { error: insErr } = await supabaseAdmin
    .from('transformacion_salidas_comunes')
    .insert(rows);

  if (insErr) return { error: insErr.message };
  return { ok: true };
}
