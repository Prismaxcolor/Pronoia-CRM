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
  comprobantes: string[];
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
    .select('id, fecha, monto_usd, comprobantes, grupo_id')
    .eq('proveedor_id', entidadId)
    .not('comprobantes', 'eq', '[]')
    .order('fecha', { ascending: false });

  if (error || !data) return [];

  // Un pago repartido entre bancas y/o con adelanto (Bloque 39) es varias
  // filas de movimientos con el mismo grupo_id; el comprobante se adjunta
  // solo a la fila principal, pero acá se muestra el monto TOTAL de la
  // operación, no el de esa fila sola.
  const grupoIds = [...new Set(data.map(m => m.grupo_id).filter((g): g is string => !!g))];
  const totalPorGrupo = new Map<string, number>();
  if (grupoIds.length > 0) {
    const { data: filasGrupo } = await supabaseAdmin
      .from('movimientos')
      .select('grupo_id, monto_usd')
      .in('grupo_id', grupoIds);
    for (const f of filasGrupo ?? []) {
      const clave = f.grupo_id as string;
      totalPorGrupo.set(clave, (totalPorGrupo.get(clave) ?? 0) + Number(f.monto_usd ?? 0));
    }
  }

  return data.map(m => ({
    id: m.id,
    fecha: m.fecha,
    montoUsd: m.grupo_id ? (totalPorGrupo.get(m.grupo_id as string) ?? Number(m.monto_usd ?? 0)) : Number(m.monto_usd ?? 0),
    comprobantes: (m.comprobantes as string[] | null) ?? [],
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
