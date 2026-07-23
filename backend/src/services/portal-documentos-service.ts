import { supabaseAdmin } from '../config/supabase.js';
import { listarFacturas, type FacturaPublica } from './factura-service.js';
import { listarTickets, type TicketPublico } from './ticket-pesaje-service.js';
import type { EntidadTelegram } from './telegram-link-service.js';

const TIPO_FACTURA_TICKET: Record<EntidadTelegram, 'compra' | 'venta'> = {
  proveedor: 'compra',
  cliente: 'venta',
};

export interface ComprobantePublico {
  id: string;
  fecha: string;
  montoUsd: number;
  comprobanteUrl: string;
}

export interface PortalDocumentos {
  facturas: FacturaPublica[];
  tickets: TicketPublico[];
  comprobantes: ComprobantePublico[];
}

async function listarComprobantes(entidadTipo: EntidadTelegram, entidadId: string): Promise<ComprobantePublico[]> {
  // Los comprobantes hoy son solo del lado proveedor (pagos), ver Fase 2 del plan.
  if (entidadTipo !== 'proveedor') return [];

  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .select('id, fecha, monto_usd, comprobante_url')
    .eq('proveedor_id', entidadId)
    .not('comprobante_url', 'is', null)
    .order('fecha', { ascending: false });

  if (error || !data) return [];

  return data.map(m => ({
    id: m.id,
    fecha: m.fecha,
    montoUsd: Number(m.monto_usd ?? 0),
    comprobanteUrl: m.comprobante_url as string,
  }));
}

export async function obtenerDocumentosPortal(
  entidadTipo: EntidadTelegram,
  entidadId: string
): Promise<PortalDocumentos> {
  const tipo = TIPO_FACTURA_TICKET[entidadTipo];

  const [facturas, tickets, comprobantes] = await Promise.all([
    listarFacturas(tipo, { entidadId }),
    listarTickets({ entidadId, tipo }),
    listarComprobantes(entidadTipo, entidadId),
  ]);

  return { facturas, tickets, comprobantes };
}
