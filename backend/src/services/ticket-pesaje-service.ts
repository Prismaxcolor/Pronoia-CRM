import { supabaseAdmin } from '../config/supabase.js';
import type { CrearTicketInput, CompletarTicketInput, EditarTicketInput, PesajeGlobalInput } from '../schemas/tickets-pesaje.js';
import { notificarDocumento } from './telegram-notify-service.js';
import { generarTicketPdf, nombreArchivoTicket } from './document-generator.js';

/** Formatea el correlativo de pesaje: (1, 'compra') → "Compra-0001". Cada tipo
 *  tiene su propio contador desde el Bloque 35 (antes compra y venta
 *  compartían una sola secuencia bajo el prefijo genérico "Pesaje-"). Duplicado
 *  intencional de shared/types/ticket-pesaje.ts (el backend no comparte
 *  paquete con front). */
function formatCodigoPesaje(numero: number, tipo: 'compra' | 'venta'): string {
  const prefijo = tipo === 'compra' ? 'Compra' : 'Venta';
  return `${prefijo}-${String(numero).padStart(4, '0')}`;
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
  fotos: string[] | null;
  productos?: { nombre: string } | null;
  lotes?: { nombre: string } | null;
}

interface PesajeGlobalRow {
  id: string;
  orden: number;
  peso: number;
  tara: number;
  foto: string | null;
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
  pesaje_exterior: boolean;
  devolucion: number | null;
  fotos_devolucion: string[] | null;
  estado: 'bruto' | 'completo';
  pesado_por: string | null;
  completado_por: string | null;
  completado_en: string | null;
  detalle_tickets_pesaje?: DetalleRow[] | null;
  pesajes_globales?: PesajeGlobalRow[] | null;
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
  fotos: string[];
}

export interface PesajeGlobalPublico {
  id: string;
  peso: number;
  tara: number;
  foto: string | null;
}

export interface TicketPublico {
  id: string;
  numero: number;
  codigo: string;
  tipo: 'compra' | 'venta';
  entidadId: string | null;
  fecha: string | null;
  materiales: MaterialPublico[];
  /** Suma de los netos por material (incluida la basura). Alias explícito de
   *  lo que antes se llamaba pesoNetoTotal — sigue existiendo con el mismo
   *  nombre para no romper a quien ya lo consume. */
  pesoNetoTotal: number;
  /** Mismo valor que pesoNetoTotal, con nombre explícito para quien necesite
   *  distinguirlo de un neto "ajustado" en el futuro. */
  pesoNetoMateriales: number;
  pesoGlobal: number;
  /** Desglose de pesadas individuales que suman pesoGlobal — solo se carga
   *  al crear el ticket, no se edita después. */
  pesajesGlobales: PesajeGlobalPublico[];
  /** true si el camión se pesó en una báscula externa — no hay peso global propio. */
  pesajeExterior: boolean;
  /** Kg de devolución del ticket completo (no por material). Se suma a
   *  pesoNetoMateriales para reconciliar contra pesoGlobal — no afecta
   *  inventario ni factura. */
  devolucion: number;
  /** Fotos de la devolución del ticket completo (no por material). */
  fotosDevolucion: string[];
  /** peso_global - suma de netos - devolución. Solo lectura, derivado. */
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
    fotos: d.fotos ?? [],
  };
}

function toPublico(row: TicketRow): TicketPublico {
  const materiales = (row.detalle_tickets_pesaje ?? []).map(detalleToPublico);
  const pesoNetoTotal = materiales.reduce((acc, m) => acc + m.pesoNeto, 0);
  const pesoGlobal = Number(row.peso_global ?? 0);
  const devolucion = Number(row.devolucion ?? 0);
  return {
    id: row.id,
    numero: Number(row.numero),
    codigo: formatCodigoPesaje(Number(row.numero), row.tipo),
    tipo: row.tipo,
    entidadId: row.entidad_id,
    fecha: row.fecha,
    materiales,
    pesoNetoTotal,
    pesoNetoMateriales: pesoNetoTotal,
    pesoGlobal,
    pesajesGlobales: (row.pesajes_globales ?? [])
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map(p => ({ id: p.id, peso: Number(p.peso), tara: Number(p.tara), foto: p.foto })),
    pesajeExterior: row.pesaje_exterior ?? false,
    devolucion,
    fotosDevolucion: row.fotos_devolucion ?? [],
    diferencia: pesoGlobal - pesoNetoTotal - devolucion,
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

const SELECT_TICKET = '*, detalle_tickets_pesaje(*, productos(nombre), lotes(nombre)), pesajes_globales(*)';

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

/** Dispara el envío del ticket por Telegram cuando queda 'completo' (fire-and-forget). */
function notificarTicketSiCorresponde(ticket: TicketPublico): void {
  if (ticket.estado !== 'completo' || !ticket.entidadId) return;
  void notificarDocumento({
    entidadTipo: ticket.tipo === 'compra' ? 'proveedor' : 'cliente',
    entidadId: ticket.entidadId,
    tipoDocumento: 'ticket',
    nombreArchivo: nombreArchivoTicket(ticket),
    generarBuffer: nombreEntidad => generarTicketPdf(ticket, nombreEntidad),
  });
}

function pesajesGlobalesARpc(pesajes: PesajeGlobalInput[]) {
  return pesajes.map(p => ({ peso: p.peso, tara: p.tara, foto: p.foto ?? null }));
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
    fotos: m.fotos,
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
    p_peso_global: input.pesajeExterior ? null : input.pesoGlobal,
    p_devolucion: input.devolucion,
    p_pesaje_exterior: input.pesajeExterior,
    p_fotos_devolucion: input.fotosDevolucion,
    p_pesajes_globales: pesajesGlobalesARpc(input.pesajesGlobales),
  });

  if (error || !ticketId) return { error: error?.message ?? 'No se pudo guardar el ticket.' };

  const ticket = await obtenerTicket(ticketId as string);
  if (!ticket) return { error: 'El ticket se creó pero no se pudo leer de vuelta.' };
  notificarTicketSiCorresponde(ticket);
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
    p_devolucion: input.devolucion,
    p_fotos_devolucion: input.fotosDevolucion,
  });

  if (error) return { error: error.message };

  const ticket = await obtenerTicket(id);
  if (!ticket) return { error: 'El ticket se completó pero no se pudo leer de vuelta.' };
  notificarTicketSiCorresponde(ticket);
  return { ticket };
}

/** Corrige un ticket ya completo (material, pesos, observaciones). El peso
 *  global se fija al crear el ticket y no se edita después (es la lectura
 *  física de báscula de entrada) — el RPC hace coalesce(null, peso_global).
 *  La RPC rechaza tickets facturados o en bruto. */
export async function editarTicket(
  id: string,
  input: EditarTicketInput
): Promise<{ ticket: TicketPublico } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('editar_ticket_pesaje', {
    p_ticket_id: id,
    p_materiales: materialesARpc(input.materiales),
    p_peso_global: null,
    p_observaciones: input.observaciones,
    p_devolucion: input.devolucion,
    p_fotos_devolucion: input.fotosDevolucion,
  });

  if (error) return { error: error.message };

  const ticket = await obtenerTicket(id);
  if (!ticket) return { error: 'El ticket se editó pero no se pudo leer de vuelta.' };
  return { ticket };
}

export interface BorrarTicketResult { ok: boolean; razon?: string; noEncontrado?: boolean }

/**
 * Borrado físico de un ticket no facturado. Las líneas de
 * detalle_tickets_pesaje caen por cascade, así que su aporte al inventario
 * desaparece con el ticket. Un ticket facturado nunca se borra: descuadraría
 * una factura ya emitida (misma frontera que usa editar_ticket_pesaje).
 */
export async function borrarTicket(id: string): Promise<BorrarTicketResult> {
  const { data: ticket } = await supabaseAdmin
    .from('tickets_pesaje').select('id, facturado').eq('id', id).maybeSingle();
  if (!ticket) return { ok: false, noEncontrado: true, razon: 'Ticket no encontrado.' };
  if (ticket.facturado) {
    return { ok: false, razon: 'El ticket ya está facturado y no se puede eliminar.' };
  }

  // Cinturón y tirantes: las tablas puente tienen FK sin cascade.
  for (const tabla of ['facturas_compra_tickets', 'facturas_venta_tickets'] as const) {
    const { count } = await supabaseAdmin
      .from(tabla).select('ticket_id', { count: 'exact', head: true }).eq('ticket_id', id);
    if ((count ?? 0) > 0) {
      return { ok: false, razon: 'El ticket está asociado a una factura y no se puede eliminar.' };
    }
  }

  const { error } = await supabaseAdmin.from('tickets_pesaje').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
