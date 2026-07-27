import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTicketInput, CompletarTicketInput, EditarTicketInput } from '../schemas/tickets-pesaje.js';

/** Formatea el correlativo de pesaje: 1 → "Pesaje 0001". Duplicado intencional
 *  de shared/types/ticket-pesaje.ts (el backend no comparte paquete con front). */
function formatCodigoPesaje(numero: number): string {
  return `Pesaje ${String(numero).padStart(4, '0')}`;
}

interface DetalleRow {
  id: string;
  producto_id: string | null;
  subcategoria: string | null;
  peso_bruto: number | null;
  tara: number | null;
  devolucion: number | null;
  peso_neto: number | null;
  destino_tipo: 'mpp' | 'lote';
  lote_id: string | null;
  productos?: { nombre: string } | null;
  lotes?: { nombre: string } | null;
}

interface TicketRow {
  id: string;
  numero: number;
  tipo: 'compra' | 'venta';
  entidad_id: string | null;
  fecha: string | null;
  fotos: string[] | null;
  observaciones: string | null;
  facturado: boolean;
  created_at: string;
  peso_global: number | null;
  estado: 'bruto' | 'completo';
  pesado_por: string | null;
  completado_por: string | null;
  completado_en: string | null;
  detalle_tickets_pesaje?: DetalleRow[] | null;
}

export interface MaterialPublico {
  id: string;
  productoId: string | null;
  nombreProducto: string | null;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  devolucion: number;
  pesoNeto: number;
  destinoTipo: 'mpp' | 'lote';
  loteId: string | null;
  nombreLote: string | null;
}

export interface TicketPublico {
  id: string;
  numero: number;
  codigo: string;
  tipo: 'compra' | 'venta';
  entidadId: string | null;
  fecha: string | null;
  materiales: MaterialPublico[];
  pesoNetoTotal: number;
  pesoGlobal: number;
  /** peso_global - suma de netos (incluida la basura). Solo lectura, derivado. */
  diferencia: number;
  fotos: string[];
  observaciones: string | null;
  facturado: boolean;
  estado: 'bruto' | 'completo';
  pesadoPor: string | null;
  completadoPor: string | null;
  completadoEn: string | null;
  createdAt: string;
}

function detalleToPublico(d: DetalleRow): MaterialPublico {
  return {
    id: d.id,
    productoId: d.producto_id,
    nombreProducto: d.productos?.nombre ?? null,
    subcategoria: d.subcategoria,
    pesoBruto: Number(d.peso_bruto ?? 0),
    tara: Number(d.tara ?? 0),
    devolucion: Number(d.devolucion ?? 0),
    pesoNeto: Number(d.peso_neto ?? 0),
    destinoTipo: d.destino_tipo,
    loteId: d.lote_id,
    nombreLote: d.lotes?.nombre ?? null,
  };
}

function toPublico(row: TicketRow): TicketPublico {
  const materiales = (row.detalle_tickets_pesaje ?? []).map(detalleToPublico);
  const pesoNetoTotal = materiales.reduce((acc, m) => acc + m.pesoNeto, 0);
  const pesoGlobal = Number(row.peso_global ?? 0);
  return {
    id: row.id,
    numero: Number(row.numero),
    codigo: formatCodigoPesaje(Number(row.numero)),
    tipo: row.tipo,
    entidadId: row.entidad_id,
    fecha: row.fecha,
    materiales,
    pesoNetoTotal,
    pesoGlobal,
    diferencia: pesoGlobal - pesoNetoTotal,
    fotos: row.fotos ?? [],
    observaciones: row.observaciones,
    facturado: row.facturado,
    estado: row.estado,
    pesadoPor: row.pesado_por,
    completadoPor: row.completado_por,
    completadoEn: row.completado_en,
    createdAt: row.created_at,
  };
}

const SELECT_TICKET = '*, detalle_tickets_pesaje(*, productos(nombre), lotes(nombre))';

export interface ListarTicketsOpts {
  /** Solo tickets sin facturar (para el selector de la factura). */
  soloNoFacturados?: boolean;
  /** Filtra por entidad (proveedor/cliente). */
  entidadId?: string;
  /** Filtra por tipo de pesaje (compra/venta). */
  tipo?: 'compra' | 'venta';
}

export async function listarTickets(opts: ListarTicketsOpts = {}): Promise<TicketPublico[]> {
  let query = supabaseAdmin
    .from('tickets_pesaje')
    .select(SELECT_TICKET)
    .order('created_at', { ascending: false });

  if (opts.soloNoFacturados) query = query.eq('facturado', false);
  if (opts.entidadId) query = query.eq('entidad_id', opts.entidadId);
  if (opts.tipo) query = query.eq('tipo', opts.tipo);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as TicketRow[]).map(toPublico);
}

export async function obtenerTicket(id: string): Promise<TicketPublico | null> {
  const { data, error } = await supabaseAdmin
    .from('tickets_pesaje')
    .select(SELECT_TICKET)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toPublico(data as unknown as TicketRow);
}

function materialesARpc(materiales: CrearTicketInput['materiales']) {
  return materiales.map(m => ({
    producto_id: m.productoId,
    subcategoria: m.subcategoria,
    peso_bruto: m.pesoBruto,
    tara: m.tara,
    devolucion: m.devolucion,
    destino_tipo: m.destinoTipo,
    lote_id: m.destinoTipo === 'lote' ? m.loteId : null,
  }));
}

export async function crearTicket(
  input: CrearTicketInput,
  pesadoPor: string
): Promise<{ ticket: TicketPublico } | { error: string }> {
  // RPC atómica: inserta el header (numero vía default) + N líneas de material.
  const { data: ticketId, error } = await supabaseAdmin.rpc('crear_ticket_pesaje', {
    p_tipo: input.tipo,
    p_entidad_id: input.entidadId,
    p_fecha: input.fecha,
    p_fotos: input.fotos,
    p_observaciones: input.observaciones,
    p_materiales: materialesARpc(input.materiales),
    p_estado: input.estado,
    p_pesado_por: pesadoPor,
    p_peso_global: input.pesoGlobal,
  });

  if (error || !ticketId) return { error: error?.message ?? 'No se pudo guardar el ticket.' };

  const ticket = await obtenerTicket(ticketId as string);
  if (!ticket) return { error: 'El ticket se creó pero no se pudo leer de vuelta.' };
  return { ticket };
}

/** Completa un ticket guardado en bruto: agrega materiales/destinos y lo marca 'completo'. */
export async function completarTicket(
  id: string,
  input: CompletarTicketInput,
  completadoPor: string
): Promise<{ ticket: TicketPublico } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('completar_ticket_pesaje', {
    p_ticket_id: id,
    p_materiales: materialesARpc(input.materiales),
    p_completado_por: completadoPor,
  });

  if (error) return { error: error.message };

  const ticket = await obtenerTicket(id);
  if (!ticket) return { error: 'El ticket se completó pero no se pudo leer de vuelta.' };
  return { ticket };
}

/** Corrige un ticket ya completo (material, pesos, peso global, observaciones).
 *  La RPC rechaza tickets facturados o en bruto. */
export async function editarTicket(
  id: string,
  input: EditarTicketInput
): Promise<{ ticket: TicketPublico } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('editar_ticket_pesaje', {
    p_ticket_id: id,
    p_materiales: materialesARpc(input.materiales),
    p_peso_global: input.pesoGlobal ?? null,
    p_observaciones: input.observaciones,
  });

  if (error) return { error: error.message };

  const ticket = await obtenerTicket(id);
  if (!ticket) return { error: 'El ticket se editó pero no se pudo leer de vuelta.' };
  return { ticket };
}
