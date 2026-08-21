import { supabaseAdmin } from '../config/supabase.js';
import type { CrearFacturaInput } from '../schemas/facturas.js';
import { notificarDocumento } from './telegram-notify-service.js';
import { generarFacturaPdf, nombreArchivoFactura } from './document-generator.js';
import { formatCodigoCompra, formatCodigoVenta } from '../utils/codigos.js';

export type TipoFactura = 'compra' | 'venta';

interface Config {
  tabla: 'facturas_compra' | 'facturas_venta';
  detalle: 'detalle_facturas_compra' | 'detalle_facturas_venta';
  ticketsJoin: 'facturas_compra_tickets' | 'facturas_venta_tickets';
  entidadCol: 'proveedor_id' | 'cliente_id';
  entidadTabla: 'proveedores' | 'clientes';
  rpc: 'crear_factura_compra' | 'crear_factura_venta';
  rpcEntidadParam: 'p_proveedor_id' | 'p_cliente_id';
}

const CONFIG: Record<TipoFactura, Config> = {
  compra: {
    tabla: 'facturas_compra',
    detalle: 'detalle_facturas_compra',
    ticketsJoin: 'facturas_compra_tickets',
    entidadCol: 'proveedor_id',
    entidadTabla: 'proveedores',
    rpc: 'crear_factura_compra',
    rpcEntidadParam: 'p_proveedor_id',
  },
  venta: {
    tabla: 'facturas_venta',
    detalle: 'detalle_facturas_venta',
    ticketsJoin: 'facturas_venta_tickets',
    entidadCol: 'cliente_id',
    entidadTabla: 'clientes',
    rpc: 'crear_factura_venta',
    rpcEntidadParam: 'p_cliente_id',
  },
};

interface DetalleRow {
  id: string;
  producto_id: string | null;
  peso: number | null;
  precio_unitario: number | null;
  subtotal: number | null;
  productos?: { nombre: string } | null;
}

interface FacturaRow {
  id: string;
  /** Correlativo automático, presente en ambas tablas. */
  numero?: number | null;
  proveedor_id?: string | null;
  cliente_id?: string | null;
  total: number;
  /** Solo presente en facturas_compra (pagos parciales). */
  monto_pagado?: number | null;
  descripcion: string | null;
  observaciones: string | null;
  estado: 'borrador' | 'emitida' | 'pagada';
  created_at: string;
  proveedores?: { nombre: string } | null;
  clientes?: { nombre: string } | null;
  detalle_facturas_compra?: DetalleRow[] | null;
  detalle_facturas_venta?: DetalleRow[] | null;
  facturas_compra_tickets?: { ticket_id: string }[] | null;
  facturas_venta_tickets?: { ticket_id: string }[] | null;
}

export interface ItemPublico {
  id: string;
  productoId: string | null;
  nombreProducto: string | null;
  peso: number;
  precioUnitario: number;
  subtotal: number;
}

export interface FacturaPublica {
  id: string;
  /** Correlativo automático, en ambos tipos de factura. */
  numero: number | null;
  /** Código de control formateado ("C-0001" / "V-0001"). */
  codigo: string | null;
  tipo: TipoFactura;
  entidadId: string | null;
  nombreEntidad: string | null;
  /** Tickets de pesaje agrupados en la factura (puede ser vacío si fue peso manual). */
  ticketIds: string[];
  items: ItemPublico[];
  total: number;
  /** Acumulado de pagos aplicados (USD). Solo compras; 0 en ventas. */
  montoPagado: number;
  descripcion: string | null;
  observaciones: string | null;
  estado: 'borrador' | 'emitida' | 'pagada';
  createdAt: string;
}

function detalleToPublico(d: DetalleRow): ItemPublico {
  return {
    id: d.id,
    productoId: d.producto_id,
    nombreProducto: d.productos?.nombre ?? null,
    peso: Number(d.peso ?? 0),
    precioUnitario: Number(d.precio_unitario ?? 0),
    subtotal: Number(d.subtotal ?? 0),
  };
}

function toPublico(row: FacturaRow, tipo: TipoFactura): FacturaPublica {
  const entidadId = tipo === 'compra' ? row.proveedor_id ?? null : row.cliente_id ?? null;
  const nombreEntidad = (tipo === 'compra' ? row.proveedores : row.clientes)?.nombre ?? null;
  const detalle = tipo === 'compra' ? row.detalle_facturas_compra : row.detalle_facturas_venta;
  const items = (detalle ?? []).map(detalleToPublico);
  const ticketsJoin = tipo === 'compra' ? row.facturas_compra_tickets : row.facturas_venta_tickets;
  const ticketIds = (ticketsJoin ?? []).map(t => t.ticket_id);
  const numero = row.numero != null ? Number(row.numero) : null;
  const codigo = numero == null ? null : tipo === 'compra' ? formatCodigoCompra(numero) : formatCodigoVenta(numero);
  return {
    id: row.id,
    numero,
    codigo,
    tipo,
    entidadId,
    nombreEntidad,
    ticketIds,
    items,
    total: Number(row.total),
    montoPagado: Number(row.monto_pagado ?? 0),
    descripcion: row.descripcion,
    observaciones: row.observaciones,
    estado: row.estado,
    createdAt: row.created_at,
  };
}

function selectJoins(cfg: Config): string {
  return `*, ${cfg.entidadTabla}(nombre), ${cfg.detalle}(*, productos(nombre)), ${cfg.ticketsJoin}(ticket_id)`;
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

  const { data, error } = await query;
  if (error || !data) return [];

  let facturas = (data as unknown as FacturaRow[]).map(r => toPublico(r, tipo));
  // El filtro por material se aplica sobre las líneas (una factura puede tener varias).
  if (opts.productoId) {
    facturas = facturas.filter(f => f.items.some(i => i.productoId === opts.productoId));
  }
  return facturas;
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

/** Dispara el envío de la factura por Telegram cuando queda 'emitida' (fire-and-forget). */
function notificarFacturaSiCorresponde(factura: FacturaPublica): void {
  if (factura.estado !== 'emitida' || !factura.entidadId) return;
  void notificarDocumento({
    entidadTipo: factura.tipo === 'compra' ? 'proveedor' : 'cliente',
    entidadId: factura.entidadId,
    tipoDocumento: 'factura',
    nombreArchivo: nombreArchivoFactura(factura),
    generarBuffer: () => generarFacturaPdf(factura),
  });
}

export async function crearFactura(
  tipo: TipoFactura,
  input: CrearFacturaInput
): Promise<{ factura: FacturaPublica } | { error: string }> {
  const cfg = CONFIG[tipo];
  const ticketIds = input.ticketIds ?? [];

  // Si la factura agrupa tickets, validar que existan, sean del mismo
  // proveedor/cliente y no estén ya facturados.
  if (ticketIds.length > 0) {
    const { data: tickets } = await supabaseAdmin
      .from('tickets_pesaje')
      .select('id, facturado, entidad_id, estado')
      .in('id', ticketIds);

    if (!tickets || tickets.length !== ticketIds.length) {
      return { error: 'Alguno de los tickets de pesaje no existe.' };
    }
    if (tickets.some(t => t.facturado)) {
      return { error: 'Alguno de los tickets de pesaje ya fue facturado.' };
    }
    if (tickets.some(t => t.estado === 'bruto')) {
      return { error: 'Alguno de los tickets está en bruto (sin completar); no se puede facturar hasta terminarlo.' };
    }
    if (tickets.some(t => t.entidad_id !== input.entidadId)) {
      return { error: 'Todos los tickets deben ser del mismo proveedor/cliente que la factura.' };
    }
  }

  // RPC atómica: header + N líneas + marca todos los tickets como facturados.
  const { data: facturaId, error } = await supabaseAdmin.rpc(cfg.rpc, {
    [cfg.rpcEntidadParam]: input.entidadId,
    p_ticket_ids: ticketIds.length > 0 ? ticketIds : null,
    p_estado: input.estado,
    p_descripcion: input.descripcion,
    p_observaciones: input.observaciones,
    p_items: input.items.map(i => ({
      producto_id: i.productoId,
      peso: i.peso,
      precio_unitario: i.precioUnitario,
    })),
  });

  if (error || !facturaId) return { error: error?.message ?? 'No se pudo crear la factura.' };

  const factura = await obtenerFactura(tipo, facturaId as string);
  if (!factura) return { error: 'La factura se creó pero no se pudo leer de vuelta.' };
  notificarFacturaSiCorresponde(factura);
  return { factura };
}
