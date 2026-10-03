import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { notificarDocumento, notificarMensaje, type FotoEnvio } from './telegram-notify-service.js';
import {
  generarFacturaPdf,
  generarTicketPdf,
  nombreArchivoFactura,
  nombreArchivoTicket,
  fmt,
} from './document-generator.js';
import {
  generarEstadoCuentaPdf,
  generarNotaPdf,
  generarPagoPdf,
  nombreArchivoEstadoCuenta,
  nombreArchivoNota,
  nombreArchivoPago,
  type NotaParaPdf,
} from './document-generator-financiero.js';
import { obtenerPagoDetalle } from './pago-detalle-service.js';
import type { EntidadTelegram } from './telegram-link-service.js';
import type { TicketPublico } from './ticket-pesaje-service.js';
import type { FacturaPublica, TipoFactura } from './factura-service.js';
import type { EstadoCuentaPortal } from './portal-estado-cuenta.js';
import type { EfectoFactura } from '../utils/factura-ticket-edicion.js';
import type { TipoEntidad } from './estado-cuenta-service.js';

/**
 * Qué se le manda por Telegram al proveedor/cliente y cuándo. Un solo lugar con el
 * criterio de cada documento; el envío real (contacto, Storage, n8n) vive en
 * telegram-notify-service.ts. Todo es fire-and-forget: ninguna función de acá lanza
 * ni bloquea la operación de negocio que la dispara.
 *
 * Criterio de contenido (documento externo): se manda lo que el proveedor/cliente
 * ve en su copia impresa — ticket sin destino de inventario, factura con precios,
 * notas sin su motivo interno, pagos con banca/referencia. Nunca el usuario interno que
 * registró la operación, costos, márgenes ni ids internos.
 */

/**
 * Aísla la parte síncrona de un aviso (armar nombres, mensajes, PDFs): un dato inesperado
 * nunca debe romper la operación de negocio ya commiteada que dispara el aviso.
 */
function aislar<A extends unknown[]>(evento: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      logger.error({ evento: 'telegram_evento_error_sincrono', aviso: evento, mensaje: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** Tope de fotos por ticket (4 álbumes): un ticket con decenas de materiales no debe inundar el chat. */
export const MAX_FOTOS_TICKET = 40;

function entidadDeTicket(ticket: TicketPublico): EntidadTelegram {
  return ticket.tipo === 'compra' ? 'proveedor' : 'cliente';
}

function entidadDeFactura(tipo: TipoFactura): EntidadTelegram {
  return tipo === 'compra' ? 'proveedor' : 'cliente';
}

/** Fotos del ticket en el orden en que se explican: ticket, materiales, pesajes del camión, devolución, vehículo. */
export function fotosDeTicket(ticket: TicketPublico, fotosVehiculo: string[] = []): FotoEnvio[] {
  const fotos: FotoEnvio[] = [];
  const agregar = (urls: string[] | null | undefined, caption: (i: number, n: number) => string) => {
    const lista = urls ?? [];
    lista.forEach((url, i) => fotos.push({ url, caption: caption(i + 1, lista.length) }));
  };

  agregar(ticket.fotos, (i, n) => `${ticket.codigo} · Ticket (${i}/${n})`);
  for (const m of ticket.materiales) {
    const nombre = m.nombreProducto ?? m.subcategoria ?? 'Material';
    agregar(m.fotos, (i, n) => `${ticket.codigo} · ${nombre} (${i}/${n})`);
  }
  ticket.pesajesGlobales.forEach((p, idx) => {
    agregar(p.fotos, (i, n) => `${ticket.codigo} · Pesaje del camión ${idx + 1} (${i}/${n})`);
  });
  agregar(ticket.fotosDevolucion, (i, n) => `${ticket.codigo} · Devolución (${i}/${n})`);
  agregar(fotosVehiculo, (i, n) => `${ticket.codigo} · Vehículo${ticket.vehiculo ? ` ${ticket.vehiculo}` : ''} (${i}/${n})`);

  const unicas = fotos.filter((f, i) => fotos.findIndex(g => g.url === f.url) === i);
  if (unicas.length > MAX_FOTOS_TICKET) {
    logger.warn({ evento: 'telegram_ticket_fotos_truncadas', ticketId: ticket.id, total: unicas.length });
  }
  return unicas.slice(0, MAX_FOTOS_TICKET);
}

async function fotosDelVehiculo(nombre: string | null): Promise<string[]> {
  if (!nombre) return [];
  const { data } = await supabaseAdmin.from('vehiculos').select('fotos').eq('nombre', nombre).maybeSingle();
  const fotos = (data as { fotos: string[] | null } | null)?.fotos;
  return Array.isArray(fotos) ? fotos : [];
}

function fechaTicket(t: TicketPublico): string {
  return (t.fecha ?? t.createdAt).slice(0, 10);
}

export interface OpcionesNotificarTicket {
  /** true = el ticket se editó con llave de edición: se reenvía el PDF con aviso (sin repetir las fotos). */
  corregido?: boolean;
}

/** Ticket de pesaje 'completo': PDF + fotos. Un ticket en bruto es un borrador y no se manda. */
function notificarTicketInterno(ticket: TicketPublico, opciones: OpcionesNotificarTicket = {}): void {
  if (ticket.estado !== 'completo' || !ticket.entidadId) return;
  const corregido = opciones.corregido === true;
  const nombreBase = nombreArchivoTicket(ticket);
  void notificarDocumento({
    entidadTipo: entidadDeTicket(ticket),
    entidadId: ticket.entidadId,
    tipoDocumento: 'ticket',
    preparar: async nombreEntidad => ({
      buffer: generarTicketPdf(ticket, nombreEntidad),
      nombreArchivo: corregido ? nombreBase.replace(/\.pdf$/, '-corregido.pdf') : nombreBase,
      mensaje: corregido
        ? `DOCUMENTO CORREGIDO: se corrigió el ticket de pesaje ${ticket.codigo} (${fechaTicket(ticket)}). Este reemplaza al enviado antes. Peso neto total: ${fmt(ticket.pesoNetoTotal)} kg.`
        : `Ticket de pesaje ${ticket.codigo} (${ticket.tipo}) del ${fechaTicket(ticket)}. Peso neto total: ${fmt(ticket.pesoNetoTotal)} kg.`,
      fotos: corregido ? [] : fotosDeTicket(ticket, await fotosDelVehiculo(ticket.vehiculo)),
    }),
  });
}

/** ¿La edición cambió algo que el proveedor/cliente ve en su ticket? Evita reenviar "corregido" por nada. */
export function huboCambioVisible(antes: TicketPublico, despues: TicketPublico): boolean {
  const huella = (t: TicketPublico) =>
    JSON.stringify({
      fecha: t.fecha,
      vehiculo: t.vehiculo,
      observaciones: t.observaciones,
      devolucion: t.devolucion,
      neto: t.pesoNetoTotal,
      materiales: t.materiales
        .map(m => [m.nombreProducto ?? m.subcategoria, m.pesoBruto, m.tara, m.pesoNeto])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1])),
    });
  return huella(antes) !== huella(despues);
}

function mensajeFactura(f: FacturaPublica, anulada: boolean, motivo?: string): string {
  const ref = f.codigo ?? `N.º ${f.id.slice(0, 8)}`;
  const tipo = f.tipo === 'compra' ? 'de compra' : 'de venta';
  if (anulada) {
    return `FACTURA ANULADA: la factura ${tipo} ${ref} por $${fmt(f.total)} fue anulada${motivo ? ` (${motivo})` : ''} y ya no es válida.`;
  }
  return `Factura ${tipo} ${ref} por $${fmt(f.total)}.`;
}

/** Factura recién emitida. */
function notificarFacturaEmitidaInterno(factura: FacturaPublica): void {
  if (factura.estado !== 'emitida' || !factura.entidadId) return;
  void notificarDocumento({
    entidadTipo: entidadDeFactura(factura.tipo),
    entidadId: factura.entidadId,
    tipoDocumento: 'factura',
    preparar: () => ({
      buffer: generarFacturaPdf(factura),
      nombreArchivo: nombreArchivoFactura(factura),
      mensaje: mensajeFactura(factura, false),
    }),
  });
}

/** Facturas que anuló la edición de un ticket (efecto 'anulada'): se manda el PDF marcado ANULADA. */
function notificarFacturasAnuladasInterno(
  efectos: ReadonlyArray<EfectoFactura>,
  cargarFactura: (tipo: TipoFactura, id: string) => Promise<FacturaPublica | null>,
  motivo?: string
): void {
  for (const e of efectos) {
    if (e.accion !== 'anulada' || !e.entidadId) continue;
    void notificarDocumento({
      entidadTipo: entidadDeFactura(e.tipo),
      entidadId: e.entidadId,
      tipoDocumento: 'factura',
      preparar: async () => {
        const factura = await cargarFactura(e.tipo, e.facturaId);
        if (!factura) throw new Error(`Factura anulada ${e.facturaId} no encontrada.`);
        return {
          buffer: generarFacturaPdf(factura),
          nombreArchivo: nombreArchivoFactura(factura).replace(/\.pdf$/, '-anulada.pdf'),
          mensaje: mensajeFactura(factura, true, motivo),
        };
      },
    });
  }
}

/** Nota de crédito/débito creada o anulada. `cargar` trae el detalle recién cuando hay a quién avisar. */
function notificarNotaInterno(
  entidadTipo: EntidadTelegram,
  entidadId: string,
  cargar: () => Promise<NotaParaPdf | { error: string }>,
  evento: 'creada' | 'anulada'
): void {
  void notificarDocumento({
    entidadTipo,
    entidadId,
    tipoDocumento: 'nota',
    preparar: async nombreEntidad => {
      const nota = await cargar();
      if ('error' in nota) throw new Error(nota.error);
      const n = nota;
      const nombre = n.tipo === 'credito' ? 'nota de crédito' : 'nota de débito';
      const ref = n.codigo ?? `N.º ${n.id.slice(0, 8)}`;
      return {
        buffer: generarNotaPdf(n, nombreEntidad, entidadTipo === 'proveedor'),
        nombreArchivo: nombreArchivoNota(n),
        mensaje: evento === 'anulada'
          ? `NOTA ANULADA: la ${nombre} ${ref} por $${fmt(n.monto)} fue anulada y ya no afecta tu saldo.`
          : `Se registró la ${nombre} ${ref} por $${fmt(n.monto)}.`,
      };
    },
  });
}

/**
 * Pago a proveedor / cobro a cliente / cruce (sin dinero): PDF del comprobante y, si el
 * gerente adjuntó fotos del comprobante bancario, esas fotos a continuación.
 * `grupoId` identifica la operación completa (pago + adelanto por el excedente, si hubo).
 */
function notificarPagoInterno(
  entidadTipo: TipoEntidad,
  entidadId: string,
  grupoId: string,
  opciones: { comprobantes?: string[]; esCruce?: boolean } = {}
): void {
  void notificarDocumento({
    entidadTipo,
    entidadId,
    tipoDocumento: opciones.esCruce ? 'cruce' : 'pago',
    preparar: async () => {
      const pago = await obtenerPagoDetalle(entidadTipo, entidadId, grupoId);
      if ('error' in pago) throw new Error(pago.error);
      const codigos = [pago.codigoPago, pago.codigoAdelanto, pago.codigoCruce].filter((c): c is string => !!c).join(' / ');
      const que = pago.codigoCruce ? 'cruce' : entidadTipo === 'proveedor' ? 'pago' : 'cobro';
      return {
        buffer: generarPagoPdf(pago),
        nombreArchivo: nombreArchivoPago(pago),
        mensaje: pago.codigoCruce
          ? `Se registró el cruce ${codigos} del ${pago.fecha}: se compensaron tus documentos sin mover dinero.`
          : `Comprobante de ${que} ${codigos} del ${pago.fecha} por $${fmt(pago.totalUsd)}.`,
        fotos: (opciones.comprobantes ?? []).map((url, i, todas) => ({
          url,
          caption: `Comprobante ${codigos} (${i + 1}/${todas.length})`,
        })),
      };
    },
  });
}

/** Estado de cuenta (versión externa) enviado a pedido del equipo. */
function notificarEstadoCuentaInterno(entidadTipo: EntidadTelegram, entidadId: string, estado: EstadoCuentaPortal): void {
  const hoy = new Date().toISOString().slice(0, 10);
  void notificarDocumento({
    entidadTipo,
    entidadId,
    tipoDocumento: 'estado_cuenta',
    preparar: () => ({
      buffer: generarEstadoCuentaPdf(estado, hoy),
      nombreArchivo: nombreArchivoEstadoCuenta(estado, hoy),
      mensaje: `Tu estado de cuenta de Pronoia Scrap al ${hoy}. Saldo: $${fmt(estado.totales.saldo)}.`,
    }),
  });
}

const TEXTO_CITA: Record<string, string> = {
  confirmada: 'fue CONFIRMADA',
  reprogramada: 'fue REPROGRAMADA',
  cancelada: 'fue CANCELADA',
  pendiente: 'quedó registrada y está pendiente de confirmación',
};

/** Aviso de texto sobre una cita de despacho (estados que el cliente necesita saber). */
function notificarCitaInterno(
  entidadTipo: EntidadTelegram,
  entidadId: string,
  cita: { fecha: string; hora: string; estado: string }
): void {
  const texto = TEXTO_CITA[cita.estado];
  if (!texto) return;
  void notificarMensaje({
    entidadTipo,
    entidadId,
    tipoDocumento: 'cita',
    mensaje: nombre => `Hola ${nombre}: tu cita de despacho del ${cita.fecha} a las ${cita.hora} ${texto}.`,
  });
}

export const notificarTicket = aislar('notificarTicket', notificarTicketInterno);
export const notificarFacturaEmitida = aislar('notificarFacturaEmitida', notificarFacturaEmitidaInterno);
export const notificarFacturasAnuladas = aislar('notificarFacturasAnuladas', notificarFacturasAnuladasInterno);
export const notificarNota = aislar('notificarNota', notificarNotaInterno);
export const notificarPago = aislar('notificarPago', notificarPagoInterno);
export const notificarEstadoCuenta = aislar('notificarEstadoCuenta', notificarEstadoCuentaInterno);
export const notificarCita = aislar('notificarCita', notificarCitaInterno);
