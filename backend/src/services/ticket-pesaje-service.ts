import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTicketInput } from '../schemas/tickets-pesaje.js';

interface TicketRow {
  id: string;
  tipo: 'compra' | 'venta';
  entidad_id: string | null;
  producto_id: string | null;
  fecha: string | null;
  subcategoria: string | null;
  peso_bruto: number | null;
  tara: number | null;
  devolucion: number | null;
  peso_neto: number | null;
  fotos: string[] | null;
  observaciones: string | null;
  facturado: boolean;
  created_at: string;
  productos?: { nombre: string } | null;
}

export interface TicketPublico {
  id: string;
  tipo: 'compra' | 'venta';
  entidadId: string | null;
  productoId: string | null;
  nombreProducto: string | null;
  fecha: string | null;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  devolucion: number;
  pesoNeto: number;
  fotos: string[];
  observaciones: string | null;
  facturado: boolean;
  createdAt: string;
}

function toPublico(row: TicketRow): TicketPublico {
  return {
    id: row.id,
    tipo: row.tipo,
    entidadId: row.entidad_id,
    productoId: row.producto_id,
    nombreProducto: row.productos?.nombre ?? null,
    fecha: row.fecha,
    subcategoria: row.subcategoria,
    pesoBruto: Number(row.peso_bruto ?? 0),
    tara: Number(row.tara ?? 0),
    devolucion: Number(row.devolucion ?? 0),
    pesoNeto: Number(row.peso_neto ?? 0),
    fotos: row.fotos ?? [],
    observaciones: row.observaciones,
    facturado: row.facturado,
    createdAt: row.created_at,
  };
}

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
    .select('*, productos(nombre)')
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
    .select('*, productos(nombre)')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toPublico(data as unknown as TicketRow);
}

export async function crearTicket(
  input: CrearTicketInput
): Promise<{ ticket: TicketPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('tickets_pesaje')
    .insert({
      tipo: input.tipo,
      entidad_id: input.entidadId,
      producto_id: input.productoId,
      fecha: input.fecha,
      subcategoria: input.subcategoria,
      peso_bruto: input.pesoBruto,
      tara: input.tara,
      devolucion: input.devolucion,
      fotos: input.fotos,
      observaciones: input.observaciones,
    })
    .select('*, productos(nombre)')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo guardar el ticket.' };
  return { ticket: toPublico(data as unknown as TicketRow) };
}
