import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { cabecerasWebhookN8n } from '../utils/n8n-headers.js';
import { logger } from '../utils/logger.js';
import { formatCodigoNotaCredito, formatCodigoNotaDebito, formatCodigoNotaCreditoCliente, formatCodigoNotaDebitoCliente, formatCodigoTransformacion } from '../utils/codigos.js';
import { formatearMensaje, type ActorEvento } from '../utils/grupo-formato.js';
import type { CambiosAuditoria } from '../utils/auditoria.js';
import { obtenerTicket } from './ticket-pesaje-service.js';
import { generarTicketPdf, nombreArchivoTicket } from './document-generator.js';
import {
  debeNotificar, resolverVariante, rec, txt, num,
  type ContextoEvento, type EventoEncontrado, type ExtraEvento, type TablaLookup, type ContextoRef,
} from './grupo-eventos.js';

/** Lo que recibe el webhook de n8n "Notificar Grupo Pronoia". */
export interface PayloadGrupo {
  texto: string;
  parseMode: 'HTML';
  /** Clave del evento del catálogo (informativo, n8n no la necesita). */
  evento?: string;
  documentoUrl?: string;
  nombreArchivo?: string;
  fotos?: string[];
}

const WEBHOOK_TIMEOUT_MS = 5_000;
const MAX_TEXTO = 3_900; // Telegram admite 4096; margen para el HTML
const MAX_FOTOS = 10; // límite de un álbum (sendMediaGroup)
const BUCKET = 'documentos-telegram';
const URL_FIRMADA_TTL_S = 60 * 60 * 24;
const ACTOR_TTL_MS = 2 * 60 * 1000;
const VENTANA_AUDITORIA_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Envío (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Manda el aviso al webhook de n8n. NUNCA lanza ni bloquea la operación de negocio:
 * timeout corto y cualquier error solo se loguea. Quien la llame debe hacerlo con `void`.
 */
export async function notificarGrupo(payload: PayloadGrupo): Promise<void> {
  try {
    if (!ENV.GRUPO_NOTIFICACIONES_ACTIVAS || !ENV.N8N_WEBHOOK_GRUPO) return;
    const cuerpo: PayloadGrupo = {
      ...payload,
      texto: payload.texto.length > MAX_TEXTO ? `${payload.texto.slice(0, MAX_TEXTO)}…` : payload.texto,
    };
    const respuesta = await fetch(ENV.N8N_WEBHOOK_GRUPO, {
      method: 'POST',
      headers: await cabecerasWebhookN8n(),
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!respuesta.ok) {
      logger.error({ evento: 'grupo_notify_error_webhook_status', status: respuesta.status, clave: payload.evento });
    }
  } catch (err) {
    logger.error({
      evento: 'grupo_notify_error_inesperado',
      clave: payload.evento,
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Quién lo hizo
// ---------------------------------------------------------------------------

export interface UsuarioPeticion {
  sub: string;
  email?: string;
  rol?: string;
}

/** Se cachea la PROMESA: eventos simultáneos del mismo usuario comparten una sola consulta. */
const cacheActores = new Map<string, { actor: Promise<ActorEvento>; expira: number }>();

/** Para tests. */
export function limpiarCacheActores(): void {
  cacheActores.clear();
}

async function leerActor(user: UsuarioPeticion): Promise<ActorEvento> {
  const respaldo: ActorEvento = { nombre: user.email ?? user.sub, rol: user.rol ?? null };
  const { data } = await supabaseAdmin.from('users').select('nombre, rol').eq('id', user.sub).maybeSingle();
  const fila = data as { nombre?: string | null; rol?: string | null } | null;
  return { nombre: fila?.nombre?.trim() || respaldo.nombre, rol: fila?.rol ?? respaldo.rol };
}

export async function resolverActor(user: UsuarioPeticion, ahora = Date.now()): Promise<ActorEvento> {
  const enCache = cacheActores.get(user.sub);
  if (enCache && enCache.expira > ahora) return enCache.actor;

  const actor = leerActor(user).catch((): ActorEvento => {
    cacheActores.delete(user.sub); // un fallo no se cachea
    return { nombre: user.email ?? user.sub, rol: user.rol ?? null };
  });
  cacheActores.set(user.sub, { actor, expira: ahora + ACTOR_TTL_MS });
  return actor;
}

// ---------------------------------------------------------------------------
// Etiquetas legibles ("Ticket Compra-0024")
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>;
const pad4 = (n: unknown): string => String(Number(n)).padStart(4, '0');
const nombre = (r: Fila): string | null => txt(r.nombre);

const LOOKUPS: Record<TablaLookup, { select: string; valor: (r: Fila) => string | null }> = {
  tickets_pesaje: { select: 'numero, tipo', valor: r => `${r.tipo === 'venta' ? 'Venta' : 'Compra'}-${pad4(r.numero)}` },
  transformaciones: { select: 'numero', valor: r => (num(r.numero) !== null ? formatCodigoTransformacion(Number(r.numero)) : null) },
  tickets_traslado: { select: 'numero', valor: r => `Traslado-${pad4(r.numero)}` },
  tomas_fisicas_inventario: { select: 'numero', valor: r => `INV-${pad4(r.numero)}` },
  clientes: { select: 'nombre', valor: nombre },
  proveedores: { select: 'nombre', valor: nombre },
  productos: { select: 'nombre', valor: nombre },
  tipos_material: { select: 'nombre', valor: nombre },
  almacenes: { select: 'nombre', valor: nombre },
  listas_precios: { select: 'nombre', valor: nombre },
  bancas: { select: 'nombre', valor: nombre },
  taras: { select: 'nombre', valor: nombre },
  lotes: { select: 'nombre', valor: nombre },
  users: { select: 'nombre, email', valor: r => nombre(r) ?? txt(r.email) },
  vehiculos: { select: 'placa, nombre', valor: r => txt(r.placa) ?? nombre(r) },
  notas_ajuste_proveedor: {
    select: 'numero, tipo',
    valor: r => (num(r.numero) === null ? null : r.tipo === 'credito' ? formatCodigoNotaCredito(Number(r.numero)) : formatCodigoNotaDebito(Number(r.numero))),
  },
  notas_ajuste_cliente: {
    select: 'numero, tipo',
    valor: r => (num(r.numero) === null ? null : r.tipo === 'credito' ? formatCodigoNotaCreditoCliente(Number(r.numero)) : formatCodigoNotaDebitoCliente(Number(r.numero))),
  },
};

/** Consulta el nombre/código legible de una fila. null si no existe o falla (nunca lanza). */
export async function buscarEtiquetaEnTabla(tabla: TablaLookup, id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const spec = LOOKUPS[tabla];
    const { data } = await supabaseAdmin.from(tabla).select(spec.select).eq('id', id).maybeSingle();
    return data ? spec.valor(data as unknown as Fila) : null;
  } catch {
    return null;
  }
}

/** codigo / nombre / placa de un objeto de la respuesta. */
function etiquetaDeObjeto(o: Fila): string | null {
  return txt(o.codigo) ?? txt(o.nombre) ?? txt(o.placa);
}

/** Etiqueta desde la respuesta: la clave indicada o, si no está, el primer objeto que traiga código/nombre. */
function etiquetaDeRespuesta(res: Readonly<Record<string, unknown>>, clave?: string): string | null {
  if (clave && res[clave]) {
    const e = etiquetaDeObjeto(rec(res[clave]));
    if (e) return e;
  }
  for (const v of Object.values(res)) {
    const e = etiquetaDeObjeto(rec(v));
    if (e) return e;
  }
  return null;
}

export async function resolverEtiqueta(
  encontrado: EventoEncontrado, ctx: ContextoEvento, previa: string | null
): Promise<string | null> {
  const { evento, params } = encontrado;
  const propia = evento.etiqueta?.(ctx);
  if (propia) return propia;
  const spec = evento.entidad;
  if (!spec) return null;

  const id = params[spec.param ?? 'id'] ?? '';
  const valor =
    previa ??
    etiquetaDeRespuesta(ctx.resBody, spec.resp) ??
    (spec.tabla ? await buscarEtiquetaEnTabla(spec.tabla, id) : null);
  if (valor) return `${spec.rotulo} ${valor}`;
  return id ? `${spec.rotulo} ${id.slice(0, 8)}` : spec.rotulo;
}

/** Valor de etiqueta para borrados: se pide ANTES de que el handler borre la fila. */
export function etiquetaPreviaParaBorrado(encontrado: EventoEncontrado): Promise<string | null> | null {
  const spec = encontrado.evento.entidad;
  if (encontrado.evento.metodo !== 'DELETE' || !spec?.tabla) return null;
  const id = encontrado.params[spec.param ?? 'id'];
  return id ? buscarEtiquetaEnTabla(spec.tabla, id) : null;
}

async function resolverContexto(ref: ContextoRef | null): Promise<string | null> {
  if (!ref) return null;
  const n = await buscarEtiquetaEnTabla(ref.tabla, ref.id);
  return n ? `${ref.rotulo} ${n}` : null;
}

// ---------------------------------------------------------------------------
// Enriquecimientos
// ---------------------------------------------------------------------------

const ENTIDAD_AUDITORIA: Record<string, string> = {
  'ticket.editado': 'ticket_pesaje',
  'transformacion.editada': 'transformacion',
  'traslado.editado': 'traslado',
};

interface FilaAuditoria {
  cambios: CambiosAuditoria | null;
  autorizado_por_nombre: string | null;
  created_at: string;
}

/** Última edición registrada en auditoria_ediciones para el documento (ventana corta). */
async function leerAuditoriaReciente(clave: string, id: string, ahora: Date): Promise<ExtraEvento> {
  const entidadTipo = ENTIDAD_AUDITORIA[clave];
  if (!entidadTipo || !id) return {};
  try {
    const { data } = await supabaseAdmin
      .from('auditoria_ediciones')
      .select('cambios, autorizado_por_nombre, created_at')
      .eq('entidad_tipo', entidadTipo)
      .eq('entidad_id', id)
      .order('created_at', { ascending: false })
      .limit(1);
    const fila = ((data ?? []) as FilaAuditoria[])[0];
    if (!fila || ahora.getTime() - new Date(fila.created_at).getTime() > VENTANA_AUDITORIA_MS) return {};
    return { cambios: fila.cambios, autorizadoPor: fila.autorizado_por_nombre };
  } catch {
    return {};
  }
}

const esUrlHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

/** Fotos del ticket (cabecera, materiales, pesadas globales y devolución), sin repetir, máx. 10. */
export function recolectarFotosTicket(t: {
  fotos?: unknown; fotosDevolucion?: unknown; materiales?: unknown; pesajesGlobales?: unknown;
}): string[] {
  const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const todas = [
    ...lista(t.fotos),
    ...lista(t.materiales).flatMap(m => lista(rec(m).fotos)),
    ...lista(t.pesajesGlobales).flatMap(p => lista(rec(p).fotos)),
    ...lista(t.fotosDevolucion),
  ].filter(esUrlHttp);
  return [...new Set(todas)].slice(0, MAX_FOTOS);
}

/** PDF del ticket terminado subido a Storage + URL firmada, y su álbum de fotos. */
async function adjuntosDeTicket(ticketId: string, nombreEntidad: string | null): Promise<Partial<PayloadGrupo>> {
  const ticket = await obtenerTicket(ticketId);
  if (!ticket || ticket.estado !== 'completo') return {};
  const adjuntos: Partial<PayloadGrupo> = {};
  const fotos = recolectarFotosTicket(ticket);
  if (fotos.length > 0) adjuntos.fotos = fotos;

  try {
    const nombreArchivo = nombreArchivoTicket(ticket);
    const pdf = generarTicketPdf(ticket, nombreEntidad ?? '—');
    const ruta = `grupo/ticket/${ticketId}/${Date.now()}-${nombreArchivo}`;
    const { error: errSubida } = await supabaseAdmin.storage.from(BUCKET).upload(ruta, pdf, { contentType: 'application/pdf' });
    if (errSubida) throw new Error(errSubida.message);
    const { data: firmada, error: errFirma } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(ruta, URL_FIRMADA_TTL_S);
    if (errFirma || !firmada) throw new Error(errFirma?.message ?? 'sin URL firmada');
    adjuntos.documentoUrl = firmada.signedUrl;
    adjuntos.nombreArchivo = nombreArchivo;
  } catch (err) {
    // El aviso de texto sale igual, solo sin el PDF.
    logger.error({ evento: 'grupo_notify_error_pdf_ticket', ticketId, mensaje: err instanceof Error ? err.message : String(err) });
  }
  return adjuntos;
}

// ---------------------------------------------------------------------------
// Armado del aviso
// ---------------------------------------------------------------------------

export interface PeticionEvento {
  metodo: ContextoEvento['metodo'];
  ruta: string;
  status: number;
  reqBody: unknown;
  resBody: unknown;
  user?: UsuarioPeticion;
  portalUser?: { entidadTipo?: string; entidadId?: string };
  /** Etiqueta pedida antes de ejecutar un borrado (la fila ya no existe después). */
  etiquetaPrevia?: Promise<string | null> | null;
}

async function actorDePeticion(pet: PeticionEvento): Promise<ActorEvento> {
  if (pet.user) return resolverActor(pet.user);
  const p = pet.portalUser;
  if (p?.entidadId && (p.entidadTipo === 'proveedor' || p.entidadTipo === 'cliente')) {
    const tabla = p.entidadTipo === 'proveedor' ? 'proveedores' : 'clientes';
    const n = await buscarEtiquetaEnTabla(tabla, p.entidadId);
    return { nombre: `${n ?? p.entidadTipo} (portal)`, rol: null };
  }
  return { nombre: 'Usuario desconocido', rol: null };
}

/**
 * Construye el aviso de un evento ya catalogado y con respuesta 2xx. Devuelve null si
 * el evento está silenciado. Puede lanzar: el llamador (middleware) lo captura.
 */
export async function construirPayloadGrupo(
  encontrado: EventoEncontrado, pet: PeticionEvento, ahora: Date = new Date()
): Promise<PayloadGrupo | null> {
  const filtro = { silenciados: ENV.GRUPO_EVENTOS_SILENCIADOS, incluirRuidosos: ENV.GRUPO_INCLUIR_RUIDOSOS };
  const ctxBase: ContextoEvento = {
    metodo: pet.metodo, ruta: pet.ruta, params: encontrado.params,
    reqBody: rec(pet.reqBody), resBody: rec(pet.resBody), extra: {},
  };
  const evento = resolverVariante(encontrado.evento, ctxBase);
  if (!debeNotificar(evento, filtro)) return null;
  const hallado: EventoEncontrado = { evento, params: encontrado.params };

  const previa = pet.etiquetaPrevia ? await pet.etiquetaPrevia.catch(() => null) : null;
  const [actor, etiqueta, contexto, auditoria] = await Promise.all([
    actorDePeticion(pet),
    resolverEtiqueta(hallado, ctxBase, previa),
    resolverContexto(evento.contexto?.(ctxBase) ?? null),
    evento.enriquecer === 'auditoria'
      ? leerAuditoriaReciente(evento.clave, encontrado.params.id ?? '', ahora)
      : Promise.resolve<ExtraEvento>({}),
  ]);

  const ctx: ContextoEvento = { ...ctxBase, extra: { ...auditoria, contexto } };
  const entidad = [etiqueta, contexto].filter(Boolean).join(' · ') || null;
  const texto = formatearMensaje({
    icono: evento.icono,
    accion: evento.accion,
    entidad,
    detalles: evento.detalles?.(ctx) ?? [],
    actor,
    fecha: ahora,
    zona: ENV.GRUPO_ZONA_HORARIA,
  });

  const payload: PayloadGrupo = { texto, parseMode: 'HTML', evento: evento.clave };
  if (evento.enriquecer === 'ticket') {
    const t = rec(ctxBase.resBody.ticket);
    const id = txt(t.id);
    if (t.estado === 'completo' && id) {
      Object.assign(payload, await adjuntosDeTicket(id, contexto ? contexto.replace(/^\S+ /, '') : null));
    }
  }
  return payload;
}

