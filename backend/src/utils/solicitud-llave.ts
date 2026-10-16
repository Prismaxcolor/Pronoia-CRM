import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { EstadoSolicitudLlave } from './solicitud-llave-tipos.js';

/** Vigencia de una solicitud pendiente, en minutos. */
export const SOLICITUD_VIGENCIA_MINUTOS = 30;

const LARGO_IV = 12;
const LARGO_TAG = 16;
const SEPARADOR = '.';

function derivarClave(secreto: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secreto, 'pronoia-solicitud-llave', 'aes-256-gcm', 32));
}

/** Cifra el código con AES-256-GCM. Formato: base64(iv).base64(tag).base64(cifrado). */
export function cifrarCodigo(codigo: string, secreto: string): string {
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv('aes-256-gcm', derivarClave(secreto), iv);
  const cifrado = Buffer.concat([cipher.update(codigo, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), cifrado].map(b => b.toString('base64')).join(SEPARADOR);
}

/** Descifra; devuelve null si el texto está alterado o la clave no coincide (nunca lanza). */
export function descifrarCodigo(texto: string, secreto: string): string | null {
  try {
    const partes = texto.split(SEPARADOR);
    if (partes.length !== 3) return null;
    const [iv, tag, cifrado] = partes.map(p => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
    if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG) return null;
    const decipher = createDecipheriv('aes-256-gcm', derivarClave(secreto), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function calcularExpiracionSolicitud(ahora: Date, minutos: number = SOLICITUD_VIGENCIA_MINUTOS): Date {
  return new Date(ahora.getTime() + minutos * 60_000);
}

const TRANSICIONES: Record<EstadoSolicitudLlave, readonly EstadoSolicitudLlave[]> = {
  pendiente: ['aprobada', 'rechazada', 'expirada'],
  aprobada: ['usada', 'expirada'],
  rechazada: [],
  usada: [],
  expirada: [],
};

export function puedeTransicionar(desde: EstadoSolicitudLlave, hacia: EstadoSolicitudLlave): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/**
 * Estado que ve el usuario: una solicitud pendiente vencida es "expirada"; una aprobada cuya llave
 * ya se usó es "usada", y si la llave venció sin usarse, "expirada". `expiraEn` es el de la solicitud
 * mientras está pendiente y el de la llave una vez aprobada.
 */
export function estadoEfectivo(
  estado: EstadoSolicitudLlave,
  expiraEn: Date,
  ahora: Date,
  llaveUsada: boolean = false
): EstadoSolicitudLlave {
  if (estado === 'aprobada') {
    if (llaveUsada) return 'usada';
    return expiraEn.getTime() <= ahora.getTime() ? 'expirada' : 'aprobada';
  }
  if (estado === 'pendiente' && expiraEn.getTime() <= ahora.getTime()) return 'expirada';
  return estado;
}

/** Id corto para textos cuando no se pudo consultar la entidad. */
export function idCorto(id: string): string {
  return id.slice(0, 8);
}

const ETIQUETA_ENTIDAD: Record<string, string> = {
  ticket_pesaje: 'Ticket de pesaje',
  transformacion: 'Transformación',
  traslado: 'Traslado',
  pago: 'Pago',
  cobro: 'Cobro',
  movimiento_banca: 'Movimiento de banca',
  nota_ajuste_proveedor: 'Nota de ajuste (proveedor)',
  nota_ajuste_cliente: 'Nota de ajuste (cliente)',
};

export function etiquetaEntidad(entidadTipo: string): string {
  return ETIQUETA_ENTIDAD[entidadTipo] ?? entidadTipo.replace(/_/g, ' ');
}

/** Texto legible: "Ticket de pesaje Compra-0042 · Metales SA". Sin datos, degrada a "tipo #id corto". */
export function armarDescripcion(
  entidadTipo: string,
  entidadId: string,
  datos?: { codigo?: string | null; tercero?: string | null; monto?: string | null }
): string {
  const etiqueta = etiquetaEntidad(entidadTipo);
  const codigo = datos?.codigo?.trim();
  const base = codigo ? `${etiqueta} ${codigo}` : `${etiqueta} #${idCorto(entidadId)}`;
  const extras = [datos?.tercero?.trim(), datos?.monto?.trim()].filter((x): x is string => !!x);
  return [base, ...extras].join(' · ');
}
