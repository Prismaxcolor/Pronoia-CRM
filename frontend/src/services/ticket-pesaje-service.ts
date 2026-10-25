import { apiFetch, esErrorDeRed } from './api-client';
import { leerGet } from './lectura-service';
import { recortarCampo, ticketsParaCache } from '../lib/offline/lectura-logica';
import type { TaraDetalle, TicketPesaje } from '@shared/types/index.js';

export interface CrearTicketMaterialInput {
  productoId: string;
  subcategoria?: string | null;
  pesoBruto: number;
  tara: number;
  /** Desglose opcional de la tara; su suma debe coincidir con `tara`. */
  tarasDetalle?: TaraDetalle[];
  destinoTipo: 'mpp' | 'lote';
  loteId?: string | null;
}

export interface PesajeGlobalInput {
  peso: number;
  tara?: number;
  foto?: string | null;
}

export interface CrearTicketInput {
  tipo?: 'compra' | 'venta';
  entidadId: string;
  /** Almacén donde queda registrado el movimiento. Si se omite o hay un solo
   *  almacén activo, el backend usa el predeterminado — comportamiento de
   *  siempre. Nunca bloquea ni limita qué se puede comprar/vender. */
  almacenId?: string | null;
  fecha?: string | null;
  /** Obligatorio salvo pesajeExterior=true (báscula externa, sin lectura propia). */
  pesoGlobal?: number | null;
  /** Desglose de pesadas individuales que suman pesoGlobal. */
  pesajesGlobales?: PesajeGlobalInput[];
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
  /** Placa/identificador del vehículo que trajo o se llevó el material. */
  vehiculo?: string | null;
  /** Identificador de la operación (modo sin conexión): hace seguro un reintento. */
  clientRequestId?: string;
  /** Momento real (ISO) en que se hizo la operación. */
  capturadoEn?: string;
}

export interface ObtenerTicketsOpts {
  soloNoFacturados?: boolean;
  entidadId?: string;
  tipo?: 'compra' | 'venta';
  estado?: 'bruto' | 'completo';
}

export async function obtenerTickets(opts: ObtenerTicketsOpts = {}): Promise<TicketPesaje[]> {
  const params = new URLSearchParams();
  if (opts.soloNoFacturados) params.set('soloNoFacturados', 'true');
  if (opts.entidadId) params.set('entidadId', opts.entidadId);
  if (opts.tipo) params.set('tipo', opts.tipo);
  if (opts.estado) params.set('estado', opts.estado);
  const qs = params.toString();
  try {
    const { tickets } = await leerGet<{ tickets: TicketPesaje[] }>(
      `/api/tickets-pesaje${qs ? `?${qs}` : ''}`,
      { recortar: d => recortarCampo(d, 'tickets', f => ticketsParaCache(f as TicketPesaje[], !!opts.soloNoFacturados || opts.estado === 'bruto', Date.now())) },
    );
    return tickets;
  } catch {
    return [];
  }
}

export async function obtenerTicket(id: string): Promise<TicketPesaje | null> {
  try {
    const { ticket } = await leerGet<{ ticket: TicketPesaje }>(`/api/tickets-pesaje/${id}`);
    return ticket;
  } catch {
    return null;
  }
}

export async function crearTicket(
  input: CrearTicketInput
): Promise<{ ticket: TicketPesaje } | { error: string; red?: true }> {
  try {
    const { ticket } = await apiFetch<{ ticket: TicketPesaje }>('/api/tickets-pesaje', {
      method: 'POST',
      body: input,
    });
    return { ticket };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'No se pudo guardar el ticket.',
      ...(esErrorDeRed(err) ? { red: true as const } : {}),
    };
  }
}

export async function completarTicket(
  id: string,
  materiales: CrearTicketMaterialInput[],
  devolucion = 0,
  fotosDevolucion: string[] = [],
  /** Otros tickets en bruto del mismo proveedor cuyo peso global se suma. Si
   *  viene vacío no se envía el campo (mismo request de siempre). */
  ticketsUnidosIds: string[] = [],
  /** Notas opcionales al completar; si vienen vacías no se envía el campo. */
  notas = '',
  /** Identidad de la operación (modo sin conexión): reintentos seguros. */
  identidad: IdentidadOperacion = {}
): Promise<{ ticket: TicketPesaje } | { error: string; red?: true }> {
  try {
    const { ticket } = await apiFetch<{ ticket: TicketPesaje }>(`/api/tickets-pesaje/${id}/completar`, {
      method: 'PATCH',
      body: cuerpoCompletarTicket(materiales, devolucion, fotosDevolucion, ticketsUnidosIds, notas, identidad),
    });
    return { ticket };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'No se pudo completar el ticket.',
      ...(esErrorDeRed(err) ? { red: true as const } : {}),
    };
  }
}

export interface IdentidadOperacion {
  clientRequestId?: string;
  capturadoEn?: string;
}

/** Cuerpo del PATCH de completar (también es lo que se guarda en la cola sin conexión). */
export function cuerpoCompletarTicket(
  materiales: CrearTicketMaterialInput[],
  devolucion = 0,
  fotosDevolucion: string[] = [],
  ticketsUnidosIds: string[] = [],
  notas = '',
  identidad: IdentidadOperacion = {}
) {
  return {
    materiales,
    devolucion,
    fotosDevolucion,
    ...(ticketsUnidosIds.length > 0 ? { ticketsUnidosIds } : {}),
    ...(notas.trim() ? { notas: notas.trim() } : {}),
    ...identidad,
  };
}

/** Qué pasó con la factura del ticket editado (la decide el backend). */
export interface AvisoFacturaTicket {
  /** 'anulada': se anuló y el ticket quedó libre. 'pagada': tiene pagos, no se tocó. */
  tipo: 'anulada' | 'pagada';
  facturaCodigo: string | null;
  entidadTipo: 'proveedor' | 'cliente';
  entidadNombre: string | null;
  /** Ruta al estado de cuenta de la entidad (null si no hay entidad). */
  rutaEstadoCuenta: string | null;
  mensaje: string;
}

export interface EditarTicketInput {
  materiales: CrearTicketMaterialInput[];
  devolucion?: number;
  fotosDevolucion?: string[];
  observaciones?: string | null;
  vehiculo?: string | null;
  /** Corrige la fecha del ticket (YYYY-MM-DD). */
  fecha?: string;
  /** Reemplaza las pesadas del camión (recalcula el peso global). Omitido = no se tocan. */
  pesajesGlobales?: Array<{ peso: number; tara: number; fotos: string[] }>;
  /** Llave de un solo uso del superadmin; solo se envía si el servidor la exige. */
  llaveEdicion?: string;
}

/** Corrige un ticket completo (materiales, pesos, tara, pesajes globales, fecha).
 *  Exige llave de edición a quien no es superadmin; en un ticket facturado
 *  la factura no se recalcula. */
export async function editarTicket(
  id: string,
  input: EditarTicketInput
): Promise<{ ticket: TicketPesaje; advertencia?: string; avisosFactura?: AvisoFacturaTicket[] } | { error: string }> {
  try {
    return await apiFetch<{ ticket: TicketPesaje; advertencia?: string; avisosFactura?: AvisoFacturaTicket[] }>(`/api/tickets-pesaje/${id}`, {
      method: 'PATCH',
      body: input,
    });
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
