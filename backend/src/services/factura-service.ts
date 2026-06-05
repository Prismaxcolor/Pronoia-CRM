import { supabaseAdmin } from '../config/supabase.js';
import type { CrearFacturaInput } from '../schemas/facturas.js';

export type TipoFactura = 'compra' | 'venta';

interface Config {
  tabla: 'facturas_compra' | 'facturas_venta';
  entidadCol: 'proveedor_id' | 'cliente_id';
  entidadTabla: 'proveedores' | 'clientes';
}

const CONFIG: Record<TipoFactura, Config> = {
  compra: { tabla: 'facturas_compra', entidadCol: 'proveedor_id', entidadTabla: 'proveedores' },
  venta: { tabla: 'facturas_venta', entidadCol: 'cliente_id', entidadTabla: 'clientes' },
};

interface FacturaRow {
  id: string;
  proveedor_id?: string | null;
  cliente_id?: string | null;
  producto_id: string | null;
  ticket_id: string | null;
  peso_manual: number | null;
  lista_precios_id: string | null;
  precio_unitario: number;
  total: number;
  descripcion: string | null;
  observaciones: string | null;
  estado: 'borrador' | 'emitida' | 'pagada';
  created_at: string;
  proveedores?: { nombre: string } | null;
  clientes?: { nombre: string } | null;
  productos?: { nombre: string } | null;
  tickets_pesaje?: { peso_neto: number | null } | null;
}

export interface FacturaPublica {
  id: string;
  tipo: TipoFactura;
  entidadId: string | null;
  nombreEntidad: string | null;
  productoId: string | null;
  nombreProducto: string | null;
  ticketId: string | null;
  pesoManual: number | null;
  peso: number;
  listaPreciosId: string | null;
  precioUnitario: number;
  total: number;
  descripcion: string | null;
  observaciones: string | null;
  estado: 'borrador' | 'emitida' | 'pagada';
  createdAt: string;
}

function toPublico(row: FacturaRow, tipo: TipoFactura): FacturaPublica {
  const entidadId = tipo === 'compra' ? row.proveedor_id ?? null : row.cliente_id ?? null;
  const nombreEntidad = (tipo === 'compra' ? row.proveedores : row.clientes)?.nombre ?? null;
  const peso = Number(row.peso_manual ?? row.tickets_pesaje?.peso_neto ?? 0);
  return {
    id: row.id,
    tipo,
    entidadId,
    nombreEntidad,
    productoId: row.producto_id,
    nombreProducto: row.productos?.nombre ?? null,
    ticketId: row.ticket_id,
    pesoManual: row.peso_manual,
    peso,
    listaPreciosId: row.lista_precios_id,
    precioUnitario: Number(row.precio_unitario),
    total: Number(row.total),
    descripcion: row.descripcion,
    observaciones: row.observaciones,
    estado: row.estado,
    createdAt: row.created_at,
  };
}

function selectJoins(cfg: Config): string {
  return `*, ${cfg.entidadTabla}(nombre), productos(nombre), tickets_pesaje(peso_neto)`;
}

export interface ListarFacturasOpts {
  desde?: string;
  hasta?: string;
  entidadId?: string;
  productoId?: string;
}

export async function listarFacturas(
  tipo: TipoFactura,
  opts: ListarFacturasOpts = {}
): Promise<FacturaPublica[]> {
  const cfg = CONFIG[tipo];
  let query = supabaseAdmin
    .from(cfg.tabla)
    .select(selectJoins(cfg))
    .order('created_at', { ascending: false });

  if (opts.desde) query = query.gte('created_at', opts.desde);
  if (opts.hasta) query = query.lte('created_at', `${opts.hasta}T23:59:59`);
  if (opts.entidadId) query = query.eq(cfg.entidadCol, opts.entidadId);
  if (opts.productoId) query = query.eq('producto_id', opts.productoId);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as FacturaRow[]).map(r => toPublico(r, tipo));
}

export async function obtenerFactura(tipo: TipoFactura, id: string): Promise<FacturaPublica | null> {
  const cfg = CONFIG[tipo];
  const { data, error } = await supabaseAdmin
    .from(cfg.tabla)
    .select(selectJoins(cfg))
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toPublico(data as unknown as FacturaRow, tipo);
}

export async function crearFactura(
  tipo: TipoFactura,
  input: CrearFacturaInput
): Promise<{ factura: FacturaPublica } | { error: string }> {
  const cfg = CONFIG[tipo];

  // Resolver el peso: del ticket (neto) o manual.
  let peso: number;
  if (input.ticketId) {
    const { data: ticket } = await supabaseAdmin
      .from('tickets_pesaje')
      .select('peso_neto, facturado')
      .eq('id', input.ticketId)
      .maybeSingle();

    if (!ticket) return { error: 'El ticket de pesaje no existe.' };
    if (ticket.facturado) return { error: 'Ese ticket de pesaje ya fue facturado.' };
    peso = Number(ticket.peso_neto ?? 0);
  } else {
    peso = Number(input.pesoManual ?? 0);
  }

  if (peso <= 0) return { error: 'El peso debe ser mayor a 0.' };

  const total = peso * input.precioUnitario;

  const { data, error } = await supabaseAdmin
    .from(cfg.tabla)
    .insert({
      [cfg.entidadCol]: input.entidadId,
      producto_id: input.productoId,
      ticket_id: input.ticketId ?? null,
      peso_manual: input.ticketId ? null : input.pesoManual,
      lista_precios_id: input.listaPreciosId ?? null,
      precio_unitario: input.precioUnitario,
      total,
      descripcion: input.descripcion,
      observaciones: input.observaciones,
      estado: input.estado,
    })
    .select(selectJoins(cfg))
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la factura.' };

  if (input.ticketId) {
    await supabaseAdmin.from('tickets_pesaje').update({ facturado: true }).eq('id', input.ticketId);
  }

  return { factura: toPublico(data as unknown as FacturaRow, tipo) };
}
