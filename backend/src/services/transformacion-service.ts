import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTransformacionInput, CompletarTransformacionInput } from '../schemas/transformaciones.js';

interface EntradaDetalleRow {
  producto_id: string;
  peso_kg: number;
  productos?: { nombre: string } | null;
}

interface SalidaDetalleRow {
  id: string;
  lote_destino_id: string;
  peso_bruto: number;
  tara: number;
  peso_neto: number;
  lotes?: { nombre: string } | null;
}

interface TransformacionRow {
  id: string;
  lote_origen_id: string;
  peso_bruto: number;
  tara: number;
  peso_neto: number;
  fecha: string;
  estado: 'bruto' | 'completa';
  notas: string | null;
  registrado_por: string | null;
  completado_por: string | null;
  completado_en: string | null;
  created_at: string;
  lotes?: { nombre: string } | null;
  transformacion_entrada_detalle?: EntradaDetalleRow[] | null;
  transformacion_salida_detalle?: SalidaDetalleRow[] | null;
}

export interface EntradaDetallePublico {
  productoId: string;
  nombreProducto: string;
  pesoKg: number;
}

export interface SalidaDetallePublico {
  id: string;
  loteDestinoId: string;
  nombreLoteDestino: string;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
}

export interface TransformacionPublica {
  id: string;
  loteOrigenId: string;
  nombreLoteOrigen: string;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fecha: string;
  estado: 'bruto' | 'completa';
  notas: string | null;
  registradoPor: string | null;
  completadoPor: string | null;
  completadoEn: string | null;
  createdAt: string;
  /** Reparto proporcional (promedio ponderado) calculado al retirar — snapshot, no cambia. */
  entradaDetalle: EntradaDetallePublico[];
  /** Salidas reales pesadas al completar. Vacío mientras estado='bruto'. */
  salidas: SalidaDetallePublico[];
}

function toPublico(row: TransformacionRow): TransformacionPublica {
  return {
    id: row.id,
    loteOrigenId: row.lote_origen_id,
    nombreLoteOrigen: row.lotes?.nombre ?? '—',
    pesoBruto: Number(row.peso_bruto),
    tara: Number(row.tara),
    pesoNeto: Number(row.peso_neto),
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
      loteDestinoId: d.lote_destino_id,
      nombreLoteDestino: d.lotes?.nombre ?? '—',
      pesoBruto: Number(d.peso_bruto),
      tara: Number(d.tara),
      pesoNeto: Number(d.peso_neto),
    })),
  };
}

const SELECT_TRANSFORMACION =
  '*, lotes(nombre), ' +
  'transformacion_entrada_detalle(producto_id, peso_kg, productos(nombre)), ' +
  'transformacion_salida_detalle(id, lote_destino_id, peso_bruto, tara, peso_neto, lotes(nombre))';

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

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as TransformacionRow[]).map(toPublico);
}

/** Retira material de un lote-pool en 'bruto'. La RPC calcula y persiste el
 *  reparto proporcional (promedio ponderado) contra la composición actual
 *  del lote origen. */
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

/** Completa una transformación 'bruto' con sus salidas reales pesadas. */
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

export interface BorrarTransformacionResult { ok: boolean; razon?: string; noEncontrado?: boolean }

/** Solo se puede cancelar mientras está 'bruto' — nada más depende todavía
 *  de sus datos. Una vez 'completa' es inmutable (regla de auditoría del
 *  proyecto: en finanzas/inventario nunca se borra). */
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
