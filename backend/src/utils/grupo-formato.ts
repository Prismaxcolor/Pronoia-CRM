import type { CambiosAuditoria, ValorAuditado } from './auditoria.js';

/**
 * Utilidades puras para armar los mensajes del grupo de Telegram. Todo lo que
 * sale al grupo pasa por aquí: se escapa para parseMode HTML y se descarta o
 * enmascara cualquier cosa que parezca un secreto.
 */

/** Nombres de campo que NUNCA se muestran (ni su valor): contraseñas, tokens, llaves, hashes. */
const CLAVE_SENSIBLE = /pass|contrase|token|llave|clave|secret|hash|api[_-]?key|authorization|cookie|jwt|otp|pin\b/i;

export function esClaveSensible(clave: string): boolean {
  return CLAVE_SENSIBLE.test(clave);
}

const MAX_VALOR = 80;
const PATRON_JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
const PATRON_BCRYPT = /\$2[aby]\$\d{2}\$/;
/** Cadena larga sin espacios (token, hash, clave): no tiene lugar en un mensaje para humanos. */
const PATRON_OPACO = /^[A-Za-z0-9+/=_-]{32,}$/;

/** Texto seguro para mostrar: enmascara secretos evidentes y recorta. */
export function sanitizarValor(valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  const texto = String(valor).trim();
  if (texto === '') return '—';
  if (PATRON_JWT.test(texto) || PATRON_BCRYPT.test(texto) || PATRON_OPACO.test(texto)) return '[oculto]';
  return texto.length > MAX_VALOR ? `${texto.slice(0, MAX_VALOR - 1)}…` : texto;
}

export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MAX_CAMBIOS = 8;

/** "• campo: antes → después", sin campos sensibles, máximo 8 líneas. */
export function formatearCambios(cambios: CambiosAuditoria | null | undefined): string[] {
  if (!cambios) return [];
  const entradas = Object.entries(cambios).filter(([campo]) => !esClaveSensible(campo));
  const lineas = entradas.slice(0, MAX_CAMBIOS).map(([campo, c]) => {
    const antes: ValorAuditado = c?.antes ?? null;
    const despues: ValorAuditado = c?.despues ?? null;
    return `• ${campo}: ${sanitizarValor(antes)} → ${sanitizarValor(despues)}`;
  });
  if (entradas.length > MAX_CAMBIOS) lineas.push(`• … y ${entradas.length - MAX_CAMBIOS} cambio(s) más`);
  return lineas;
}

export function formatearNumero(n: number, decimales = 2): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: decimales });
}

export const kg = (n: number): string => `${formatearNumero(n)} kg`;
export const usd = (n: number): string => `$${formatearNumero(n)}`;

/** Fecha y hora local legible: "03/10/2026 14:05". */
export function formatearFechaLocal(fecha: Date, zona: string): string {
  try {
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: zona,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(fecha).replace(',', '');
  } catch {
    return fecha.toISOString();
  }
}

const ETIQUETA_ROL: Record<string, string> = {
  superadmin: 'Superadmin',
  administracion: 'Administración',
  trabajador: 'Trabajador',
};

export interface ActorEvento {
  nombre: string;
  rol?: string | null;
}

export interface EntradaMensaje {
  icono: string;
  accion: string;
  /** Línea de la entidad afectada: "Ticket Compra-0024 · Proveedor X". */
  entidad?: string | null;
  /** Líneas adicionales (ya en texto plano; aquí se escapan). */
  detalles?: ReadonlyArray<string>;
  actor: ActorEvento;
  fecha: Date;
  zona: string;
}

/** Arma el mensaje final en HTML de Telegram. Todo texto dinámico se escapa. */
export function formatearMensaje(m: EntradaMensaje): string {
  const lineas: string[] = [`${m.icono} <b>${escaparHtml(m.accion)}</b>`];
  if (m.entidad) lineas.push(escaparHtml(m.entidad));
  for (const d of m.detalles ?? []) lineas.push(escaparHtml(d));
  const rol = m.actor.rol ? ` (${ETIQUETA_ROL[m.actor.rol] ?? m.actor.rol})` : '';
  lineas.push(`👤 ${escaparHtml(m.actor.nombre)}${escaparHtml(rol)}`);
  lineas.push(`🕒 ${formatearFechaLocal(m.fecha, m.zona)}`);
  return lineas.join('\n');
}
