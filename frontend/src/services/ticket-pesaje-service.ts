import { apiFetch } from './api-client';
import type { TicketPesaje } from '@shared/types/index.js';

export interface CrearTicketMaterialInput {
  productoId: string;
  subcategoria?: string | null;
  pesoBruto: number;
  tara: number;
  destinoTipo: 'mpp' | 'lote';
  loteId?: string | null;
}

export interface CrearTicketInput {
  tipo?: 'compra' | 'venta';
  entidadId: string;
  fecha?: string | null;
  /** Obligatorio salvo pesajeExterior=true (báscula externa, sin lectura propia). */
  pesoGlobal?: number | null;
  /** true si el camión se pesó en una báscula externa a la que Pronoia no tiene acceso. */
  pesajeExterior?: boolean;
  /** Kg de devolución del ticket completo. Se suma a la suma de materiales
   *  para reconciliar contra pesoGlobal — no afecta inventario ni factura. */
  devolucion?: number;
  /** URLs de fotos de la devolución del ticket completo (no por material). */
  fotosDevolucion?: string[];
  /** 'bruto' guarda el ticket sin materiales/destinos, para completar después. */
  estado?: 'bruto' | 'completo';
  materiales: CrearTicketMaterialInput[];
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

export async function completarTicket(
  id: string,
  materiales: CrearTicketMaterialInput[],
  devolucion = 0,
  fotosDevolucion: string[] = []
): Promise<{ ticket: TicketPesaje } | { error: string }> {
  try {
    const { ticket } = await apiFetch<{ ticket: TicketPesaje }>(`/api/tickets-pesaje/${id}/completar`, {
      method: 'PATCH',
      body: { materiales, devolucion, fotosDevolucion },
    });
    return { ticket };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo completar el ticket.' };
  }
}

export interface EditarTicketInput {
  materiales: CrearTicketMaterialInput[];
  devolucion?: number;
  fotosDevolucion?: string[];
  observaciones?: string | null;
}

/** Corrige un ticket ya completo (material, pesos, observaciones). El peso
 *  global no se edita — se fija al crear el ticket.
 *  El backend rechaza la edición si el ticket ya está facturado. */
export async function editarTicket(
  id: string,
  input: EditarTicketInput
): Promise<{ ticket: TicketPesaje } | { error: string }> {
  try {
    const { ticket } = await apiFetch<{ ticket: TicketPesaje }>(`/api/tickets-pesaje/${id}`, {
      method: 'PATCH',
      body: input,
    });
    return { ticket };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo editar el ticket.' };
  }
}

/** Borra un ticket no facturado. El backend rechaza si ya está facturado. */
export async function borrarTicket(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/tickets-pesaje/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo eliminar el ticket.' };
  }
}
