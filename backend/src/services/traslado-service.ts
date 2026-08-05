import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTrasladoInput, CompletarTrasladoInput } from '../schemas/traslados.js';

/** Formatea el correlativo de traslado: 1 → "Traslado-0001". Duplicado
 *  intencional de shared/types/traslado.ts (el backend no comparte paquete
 *  con el front, mismo patrón que formatCodigoPesaje). */
function formatCodigoTraslado(numero: number): string {
  return `Traslado-${String(numero).padStart(4, '0')}`;
}

interface DetalleRow {
  id: string;
  producto_id: string | null;
  subcategoria: string | null;
  peso_bruto: number | null;
  tara: number | null;
  peso_neto: number | null;
  peso_recibido: number | null;
  productos?: { nombre: string } | null;
}

interface TrasladoRow {
  id: string;
  numero: number;
  almacen_origen_id: string;
  almacen_destino_id: string;
  estado: 'pendiente' | 'completo';
  observaciones: string | null;
  fotos: string[] | null;
  pesado_por: string | null;
  completado_por: string | null;
  completado_en: string | null;
  created_at: string;
  almacen_origen?: { nombre: string } | null;
  almacen_destino?: { nombre: string } | null;
  detalle_traslado?: DetalleRow[] | null;
}

export interface TrasladoMaterialPublico {
  id: string;
  productoId: string | null;
  nombreProducto: string | null;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  pesoRecibido: number | null;
}

export interface TrasladoPublico {
  id: string;
  numero: number;
  codigo: string;
  almacenOrigenId: string;
  nombreAlmacenOrigen: string | null;
  almacenDestinoId: string;
  nombreAlmacenDestino: string | null;
  materiales: TrasladoMaterialPublico[];
  pesoNetoEnviado: number;
  pesoNetoRecibido: number | null;
  observaciones: string | null;
  fotos: string[];
  estado: 'pendiente' | 'completo';
  pesadoPor: string | null;
  completadoPor: string | null;
  completadoEn: string | null;
  createdAt: string;
}

function detalleToPublico(d: DetalleRow): TrasladoMaterialPublico {
  return {
    id: d.id,
    productoId: d.producto_id,
    nombreProducto: d.productos?.nombre ?? null,
    subcategoria: d.subcategoria,
    pesoBruto: Number(d.peso_bruto ?? 0),
    tara: Number(d.tara ?? 0),
    pesoNeto: Number(d.peso_neto ?? 0),
    pesoRecibido: d.peso_recibido === null ? null : Number(d.peso_recibido),
  };
}

function toPublico(row: TrasladoRow): TrasladoPublico {
  const materiales = (row.detalle_traslado ?? []).map(detalleToPublico);
  const pesoNetoEnviado = materiales.reduce((acc, m) => acc + m.pesoNeto, 0);
  const todasRecibidas = materiales.length > 0 && materiales.every(m => m.pesoRecibido !== null);
  return {
    id: row.id,
    numero: Number(row.numero),
    codigo: formatCodigoTraslado(Number(row.numero)),
    almacenOrigenId: row.almacen_origen_id,
    nombreAlmacenOrigen: row.almacen_origen?.nombre ?? null,
    almacenDestinoId: row.almacen_destino_id,
    nombreAlmacenDestino: row.almacen_destino?.nombre ?? null,
    materiales,
    pesoNetoEnviado,
    pesoNetoRecibido: todasRecibidas
      ? materiales.reduce((acc, m) => acc + (m.pesoRecibido ?? 0), 0)
      : null,
    observaciones: row.observaciones,
    fotos: row.fotos ?? [],
    estado: row.estado,
    pesadoPor: row.pesado_por,
    completadoPor: row.completado_por,
    completadoEn: row.completado_en,
    createdAt: row.created_at,
  };
}

const SELECT_TRASLADO =
  '*, ' +
  'almacen_origen:almacenes!tickets_traslado_almacen_origen_id_fkey(nombre), ' +
  'almacen_destino:almacenes!tickets_traslado_almacen_destino_id_fkey(nombre), ' +
  'detalle_traslado(*, productos(nombre))';

export async function listarTraslados(): Promise<TrasladoPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('tickets_traslado')
    .select(SELECT_TRASLADO)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as unknown as TrasladoRow[]).map(toPublico);
}

export async function obtenerTraslado(id: string): Promise<TrasladoPublico | null> {
  const { data, error } = await supabaseAdmin
    .from('tickets_traslado')
    .select(SELECT_TRASLADO)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toPublico(data as unknown as TrasladoRow);
}

export async function crearTraslado(
  input: CrearTrasladoInput,
  pesadoPor: string
): Promise<{ traslado: TrasladoPublico } | { error: string }> {
  const { data: trasladoId, error } = await supabaseAdmin.rpc('crear_traslado', {
    p_almacen_origen_id: input.almacenOrigenId,
    p_almacen_destino_id: input.almacenDestinoId,
    p_observaciones: input.observaciones,
    p_materiales: input.materiales.map(m => ({
      producto_id: m.productoId,
      subcategoria: m.subcategoria,
      peso_bruto: m.pesoBruto,
      tara: m.tara,
    })),
    p_pesado_por: pesadoPor,
  });

  if (error || !trasladoId) return { error: error?.message ?? 'No se pudo guardar el traslado.' };

  const traslado = await obtenerTraslado(trasladoId as string);
  if (!traslado) return { error: 'El traslado se creó pero no se pudo leer de vuelta.' };
  return { traslado };
}

export async function completarTraslado(
  id: string,
  input: CompletarTrasladoInput,
  completadoPor: string
): Promise<{ traslado: TrasladoPublico } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('completar_traslado', {
    p_traslado_id: id,
    p_recepciones: input.recepciones.map(r => ({
      detalle_id: r.detalleId,
      peso_recibido: r.pesoRecibido,
    })),
    p_fotos: input.fotos,
    p_completado_por: completadoPor,
  });

  if (error) return { error: error.message };

  const traslado = await obtenerTraslado(id);
  if (!traslado) return { error: 'El traslado se completó pero no se pudo leer de vuelta.' };
  return { traslado };
}
