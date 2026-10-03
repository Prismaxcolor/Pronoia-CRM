import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import type { CrearTicketInput, CompletarTicketInput, EditarTicketInput, PesajeGlobalInput } from '../schemas/tickets-pesaje.js';
import { notificarTicket, notificarFacturasAnuladas, huboCambioVisible } from './telegram-eventos-service.js';
import { obtenerFactura } from './factura-service.js';
import { parsearEfectosFactura } from '../utils/factura-ticket-edicion.js';
import {
  contarSecundarios,
  esErrorFuncionInexistente,
  esSecundarioUnido,
  esTicketUnido,
  MENSAJE_PRINCIPAL_CON_UNIDOS_BORRAR,
  MENSAJE_TICKET_UNIDO_BORRAR,
  MENSAJE_TICKET_UNIDO_COMPLETAR,
  MENSAJE_TICKET_UNIDO_EDITAR,
  MENSAJE_UNION_NO_HABILITADA,
} from './ticket-principal.js';
import { validarUnionTickets, type TicketUnibleRow } from './ticket-union.js';
import { autorizarEdicion, esSuperadminEnBd, type ActorEdicion } from './edicion-autorizada-service.js';
import { auditarEdicionTicket } from './ticket-auditoria.js';
import { errorEdicionFacturado, extrasEdicionRpc } from '../utils/edicion-ticket.js';
import { avisosDeFacturasEditadas } from './factura-ticket-service.js';
import type { AvisoFactura } from '../utils/factura-ticket-edicion.js';
import { redondearKg, calcularDiferenciaPeso } from '../utils/peso-kg.js';

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
  fotos: string[] | null;
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
  vehiculo: string | null;
  ticket_principal_id?: string | null;
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
  fotos: string[];
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
  vehiculo: string | null;
  /** Id del ticket principal si este se unió a otro al completar; null si no. */
  ticketPrincipalId?: string | null;
  /** Código del ticket principal, para mostrar "Unido a ...". */
  ticketPrincipalCodigo?: string | null;
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
  const pesoNetoTotal = redondearKg(materiales.reduce((acc, m) => acc + m.pesoNeto, 0));
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
      .map(p => ({ id: p.id, peso: Number(p.peso), tara: Number(p.tara), fotos: p.fotos ?? [] })),
    pesajeExterior: row.pesaje_exterior ?? false,
    devolucion,
    fotosDevolucion: row.fotos_devolucion ?? [],
    diferencia: calcularDiferenciaPeso({ pesoGlobal, netoMateriales: pesoNetoTotal, devolucion }),
    fotos: row.fotos ?? [],
    observaciones: row.observaciones,
    facturado: row.facturado,
    estado: row.estado,
    pesadoPor: row.pesado_por,
    completadoPor: row.completado_por,
    completadoEn: row.completado_en,
    vehiculo: row.vehiculo,
    ticketPrincipalId: row.ticket_principal_id ?? null,
    ticketPrincipalCodigo: null,
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
  /** Filtra por estado en el servidor (p. ej. 'bruto' para los candidatos a unir). */
  estado?: 'bruto' | 'completo';
}

export async function listarTickets(opts: ListarTicketsOpts = {}): Promise<TicketPublico[]> {
  let query = supabaseAdmin
    .from('tickets_pesaje')
    .select(SELECT_TICKET)
    .order('created_at', { ascending: false });

  if (opts.soloNoFacturados) query = query.eq('facturado', false);
  if (opts.entidadId) query = query.eq('entidad_id', opts.entidadId);
  if (opts.tipo) query = query.eq('tipo', opts.tipo);
  if (opts.estado) query = query.eq('estado', opts.estado);

  const { data, error } = await query;
  if (error || !data) return [];
  const todas = data as unknown as TicketRow[];
  // Un ticket unido (secundario) se factura a través de su principal: no se
  // ofrece como facturable por separado. Se filtra aquí con el valor leído por
  // '*' (si la columna no existe aún, es undefined y no se excluye nada).
  const rows = opts.soloNoFacturados ? todas.filter(r => !esTicketUnido(r)) : todas;
  const codigoPorId = await codigosDePrincipales(rows);
  return rows.map(r => ({
    ...toPublico(r),
    ticketPrincipalCodigo: r.ticket_principal_id ? (codigoPorId.get(r.ticket_principal_id) ?? null) : null,
  }));
}

/** Resuelve con una consulta aparte el código de cada ticket principal referenciado
 *  por `rows` (el principal puede no estar en el resultado filtrado). Vacío si no hay uniones. */
async function codigosDePrincipales(rows: TicketRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map(r => r.ticket_principal_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('tickets_pesaje').select('id, numero, tipo').in('id', ids);
  const principales = (data ?? []) as Array<{ id: string; numero: number; tipo: 'compra' | 'venta' }>;
  return new Map(principales.map(p => [p.id, formatCodigoPesaje(Number(p.numero), p.tipo)]));
}

export async function obtenerTicket(id: string): Promise<TicketPublico | null> {
  const { data, error } = await supabaseAdmin
    .from('tickets_pesaje')
    .select(SELECT_TICKET)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as TicketRow;
  const codigos = await codigosDePrincipales([row]);
  return { ...toPublico(row), ticketPrincipalCodigo: row.ticket_principal_id ? (codigos.get(row.ticket_principal_id) ?? null) : null };
}

/** Dispara el envío del ticket por Telegram cuando queda 'completo' (fire-and-forget). */
function notificarTicketSiCorresponde(ticket: TicketPublico): void {
  notificarTicket(ticket); // PDF + fotos; solo si está 'completo' (ver telegram-eventos-service.ts)
}

function pesajesGlobalesARpc(pesajes: PesajeGlobalInput[]) {
  return pesajes.map(p => ({ peso: redondearKg(p.peso), tara: redondearKg(p.tara), fotos: p.fotos }));
}

function materialesARpc(materiales: CrearTicketInput['materiales']) {
  return materiales.map(m => ({
    producto_id: m.productoId,
    subcategoria: m.subcategoria,
    peso_bruto: redondearKg(m.pesoBruto),
    tara: redondearKg(m.tara),
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
    p_peso_global: input.pesajeExterior || input.pesoGlobal == null ? null : redondearKg(input.pesoGlobal),
    p_devolucion: redondearKg(input.devolucion),
    p_pesaje_exterior: input.pesajeExterior,
    p_fotos_devolucion: input.fotosDevolucion,
    p_pesajes_globales: pesajesGlobalesARpc(input.pesajesGlobales),
    p_almacen_id: input.almacenId ?? null,
    p_vehiculo: input.vehiculo,
  });

  if (error || !ticketId) return { error: error?.message ?? 'No se pudo guardar el ticket.' };

  const ticket = await obtenerTicket(ticketId as string);
  if (!ticket) return { error: 'El ticket se creó pero no se pudo leer de vuelta.' };
  notificarTicketSiCorresponde(ticket);
  return { ticket };
}

/** Valida (con mensaje amigable) que los tickets a unir se puedan sumar al
 *  principal. La RPC vuelve a validar dentro de la transacción. */
async function errorDeUnion(id: string, idsUnidos: string[]): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('tickets_pesaje')
    .select('*')
    .in('id', [id, ...idsUnidos]);
  if (error || !data) return 'No se pudieron verificar los tickets a unir.';

  const filas = data as unknown as TicketUnibleRow[];
  const principal = filas.find(t => t.id === id);
  if (!principal) return 'Ticket no encontrado.';
  return validarUnionTickets(principal, filas.filter(t => t.id !== id), idsUnidos);
}

/** Completa un ticket guardado en bruto: agrega materiales/destinos y lo marca 'completo'.
 *  Si input.ticketsUnidosIds trae ids, suma sus pesos globales y los marca
 *  completos enlazados a este (RPC nueva); si no, usa la RPC de siempre. */
export async function completarTicket(
  id: string,
  input: CompletarTicketInput,
  completadoPor: string
): Promise<{ ticket: TicketPublico } | { error: string }> {
  const idsUnidos = input.ticketsUnidosIds ?? [];
  const paramsBase = {
    p_ticket_id: id,
    p_materiales: materialesARpc(input.materiales),
    p_completado_por: completadoPor,
    p_devolucion: redondearKg(input.devolucion),
    p_fotos_devolucion: input.fotosDevolucion,
  };

  // Un ticket ya unido a otro no se completa por separado (tolerante a columna ausente).
  if (await esSecundarioUnido(id)) return { error: MENSAJE_TICKET_UNIDO_COMPLETAR };

  if (idsUnidos.length > 0) {
    const errorUnion = await errorDeUnion(id, idsUnidos);
    if (errorUnion) return { error: errorUnion };
  }

  const { error } = idsUnidos.length > 0
    ? await supabaseAdmin.rpc('completar_ticket_pesaje_unido', { ...paramsBase, p_tickets_unidos: idsUnidos })
    : await supabaseAdmin.rpc('completar_ticket_pesaje', paramsBase);

  if (error) {
    return { error: idsUnidos.length > 0 && esErrorFuncionInexistente(error) ? MENSAJE_UNION_NO_HABILITADA : error.message };
  }

  const ticket = await obtenerTicket(id);
  if (!ticket) return { error: 'El ticket se completó pero no se pudo leer de vuelta.' };
  notificarTicketSiCorresponde(ticket);
  return { ticket };
}

const MENSAJE_EDICION_NO_HABILITADA =
  'Falta aplicar la migración de edición de tickets (docs/migration_edicion_ticket_poderes.sql y docs/migration_anular_factura_por_edicion_ticket.sql) para esta corrección.';

/** Errores de negocio que se detectan ANTES de gastar la llave. */
async function errorPreviaEdicion(id: string, antes: TicketPublico | null, input: EditarTicketInput): Promise<{ error: string; codigo: number } | null> {
  if (!antes) return { error: 'Ticket no encontrado.', codigo: 404 };
  if (antes.estado !== 'completo') {
    return { error: 'Solo se pueden editar tickets completos (un ticket en bruto se completa desde su pantalla).', codigo: 400 };
  }
  if (!input.pesajesGlobales) return null;
  if (antes.pesajeExterior) return { error: 'Este ticket no tiene pesaje global (báscula externa).', codigo: 400 };
  if ((await contarSecundarios(id)) > 0) {
    return { error: 'Este ticket tiene tickets unidos: su pesaje global es la suma de todos y no se edita aquí.', codigo: 409 };
  }
  return null;
}

export type EditarTicketResult =
  | { ticket: TicketPublico; advertencia?: string; avisosFactura?: AvisoFactura[] }
  | { error: string; codigo?: number };

/** Corrige un ticket completo con llave de edición (o como superadmin):
 *  materiales (peso bruto, tara, producto, destino), pesajes globales del
 *  camión, fecha, devolución, vehículo y observaciones. En un ticket ya
 *  facturado, editar_ticket_con_factura edita y trata la factura en la MISMA
 *  transacción: si está emitida y sin pagos se anula (el ticket queda libre
 *  para refacturar); si tiene pagos no se toca y la respuesta trae
 *  `avisosFactura` para que el usuario revise el estado de cuenta.
 *  Cada edición queda en auditoria_ediciones campo por campo. */
export async function editarTicket(
  id: string,
  input: EditarTicketInput,
  actor: ActorEdicion
): Promise<EditarTicketResult> {
  // Un ticket unido (secundario) no tiene detalle propio: se edita el principal.
  if (await esSecundarioUnido(id)) return { error: MENSAJE_TICKET_UNIDO_EDITAR, codigo: 409 };

  const antes = await obtenerTicket(id).catch(() => null);
  const previo = await errorPreviaEdicion(id, antes, input);
  if (previo) return previo;

  const auth = await autorizarEdicion(actor, 'ticket_pesaje', id);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const facturado = antes?.facturado ?? false;
  const errorFacturado = errorEdicionFacturado({
    facturado,
    autorizadoPor: auth.autorizadoPor,
    esSuperadmin: facturado && auth.autorizadoPor === null ? await esSuperadminEnBd(actor.userId) : false,
  });
  if (errorFacturado) {
    await auth.liberar();
    return errorFacturado;
  }
  // Facturado: una sola función SQL edita y anula/avisa la factura (atómico).
  const { data, error } = await supabaseAdmin.rpc(facturado ? 'editar_ticket_con_factura' : 'editar_ticket_pesaje', {
    p_ticket_id: id,
    p_materiales: materialesARpc(input.materiales),
    p_peso_global: null,
    p_observaciones: input.observaciones,
    p_devolucion: redondearKg(input.devolucion),
    p_fotos_devolucion: input.fotosDevolucion,
    p_vehiculo: input.vehiculo,
    ...extrasEdicionRpc(input, facturado),
    ...(facturado ? { p_motivo_anulacion: `Edición del ticket ${antes?.codigo ?? id} con llave de edición` } : {}),
  });

  if (error) {
    await auth.liberar();
    return esErrorFuncionInexistente(error) ? { error: MENSAJE_EDICION_NO_HABILITADA, codigo: 409 } : { error: error.message };
  }

  const ticket = await obtenerTicket(id);
  if (!ticket) return { error: 'El ticket se editó pero no se pudo leer de vuelta.' };
  const facturasRaw = (data as { facturas?: unknown } | null)?.facturas;
  const avisosFactura = facturado ? await avisosDeFacturasEditadas(facturasRaw) : [];
  // Telegram (fire-and-forget): ticket corregido si cambió algo visible, y aviso de las facturas que la edición anuló.
  // Aislado: ni un dato raro ni un fallo de armado del aviso pueden romper la edición ya commiteada
  // ni impedir la auditoría de abajo.
  try {
    if (antes && huboCambioVisible(antes, ticket)) notificarTicket(ticket, { corregido: true });
    if (facturado) notificarFacturasAnuladas(parsearEfectosFactura(facturasRaw), obtenerFactura, `corrección del ticket ${ticket.codigo}`);
  } catch (err) {
    logger.error({ evento: 'ticket_edicion_error_aviso_telegram', ticketId: id, mensaje: err instanceof Error ? err.message : String(err) });
  }
  const registrada = await auditarEdicionTicket(id, actor, auth.autorizadoPor, antes, ticket, { facturado, avisosFactura });
  return {
    ticket,
    ...(avisosFactura.length > 0 ? { avisosFactura } : {}),
    ...(registrada ? {} : { advertencia: 'El ticket se guardó, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.' }),
  };
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

  if (await esSecundarioUnido(id)) return { ok: false, razon: MENSAJE_TICKET_UNIDO_BORRAR };
  if ((await contarSecundarios(id)) > 0) return { ok: false, razon: MENSAJE_PRINCIPAL_CON_UNIDOS_BORRAR };

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
