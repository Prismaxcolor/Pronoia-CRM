import { apiFetch } from './api-client';
import type { TicketPesaje } from '@shared/types/index.js';

export interface CrearTicketInput {
  tipo?: 'compra' | 'venta';
  entidadId: string;
  productoId: string;
  fecha?: string | null;
  subcategoria?: string | null;
  pesoBruto: number;
  tara: number;
  devolucion: number;
  fotos: string[];
  observaciones?: string | null;
}

export interface ObtenerTicketsOpts {
  soloNoFacturados?: boolean;
  entidadId?: string;
  tipo?: 'compra' | 'venta';
}

export async function obtenerTickets(opts: ObtenerTicketsOpts = {}): Promise<TicketPesaje[]> {
  const params = new URLSearchParams();
  if (opts.soloNoFacturados) params.set('soloNoFacturados', 'true');
  if (opts.entidadId) params.set('entidadId', opts.entidadId);
  if (opts.tipo) params.set('tipo', opts.tipo);
  const qs = params.toString();
  try {
    const { tickets } = await apiFetch<{ tickets: TicketPesaje[] }>(
      `/api/tickets-pesaje${qs ? `?${qs}` : ''}`
    );
    return tickets;
  } catch {
    return [];
  }
}

export async function obtenerTicket(id: string): Promise<TicketPesaje | null> {
  try {
    const { ticket } = await apiFetch<{ ticket: TicketPesaje }>(`/api/tickets-pesaje/${id}`);
    return ticket;
  } catch {
    return null;
  }
}

export async function crearTicket(
  input: CrearTicketInput
): Promise<{ ticket: TicketPesaje } | { error: string }> {
  try {
    const { ticket } = await apiFetch<{ ticket: TicketPesaje }>('/api/tickets-pesaje', {
      method: 'POST',
      body: input,
    });
    return { ticket };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo guardar el ticket.' };
  }
}
