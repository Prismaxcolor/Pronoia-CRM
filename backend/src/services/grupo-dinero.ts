import { formatearNumero, sanitizarValor } from '../utils/grupo-formato.js';
import { esUrlComprobanteValida } from '../utils/comprobante-url.js';

/**
 * Piezas puras del aviso de dinero al grupo "P.S Cajas Pagos": qué cuentas intervienen,
 * qué líneas extra lleva el mensaje y qué comprobantes se pueden reenviar. Sin acceso a
 * red ni a BD (la resolución de nombres de cuenta vive en grupo-cajas-service.ts).
 */

/** Tope de comprobantes por aviso (un álbum de Telegram admite hasta 10 fotos). */
export const MAX_COMPROBANTES_AVISO = 10;

export interface CuentaRef {
  /** "Cuenta", "Cuenta origen", "Cuenta destino". */
  rol: string;
  id: string;
  monto: number | null;
  moneda: string | null;
}

type Cuerpo = Readonly<Record<string, unknown>>;

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const registro = (v: unknown): Cuerpo => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Cuerpo) : {});

const ROL_POR_TIPO: Record<string, string> = {
  ingreso: 'Cuenta destino',
  egreso: 'Cuenta origen',
  transferencia: 'Cuenta origen',
};

/** Cuentas (bancas/cajas) que menciona el body de un movimiento de dinero. */
export function cuentasDeBody(body: Cuerpo): CuentaRef[] {
  const refs: CuentaRef[] = [];
  const lista = Array.isArray(body.bancas) ? body.bancas : [];
  for (const b of lista) {
    const fila = registro(b);
    const id = texto(fila.bancaId);
    if (id) refs.push({ rol: 'Cuenta', id, monto: numero(fila.monto), moneda: texto(fila.moneda) });
  }
  const origen = texto(body.bancaId);
  if (origen) {
    refs.push({
      rol: ROL_POR_TIPO[String(body.tipo)] ?? 'Cuenta',
      id: origen, monto: numero(body.monto), moneda: texto(body.moneda),
    });
  }
  const destino = texto(body.bancaDestinoId);
  if (destino) {
    refs.push({ rol: 'Cuenta destino', id: destino, monto: numero(body.montoDestino) ?? numero(body.monto), moneda: null });
  }
  return refs;
}

/** "Cuenta origen: Banesco — 1.200 VES". `nombre`/`monedaCuenta` salen de la BD (pueden faltar). */
export function lineaCuenta(ref: CuentaRef, nombre: string | null, monedaCuenta: string | null): string {
  const moneda = ref.moneda ?? monedaCuenta;
  const monto = ref.monto !== null ? ` — ${formatearNumero(ref.monto)}${moneda ? ` ${moneda}` : ''}` : '';
  return `${ref.rol}: ${sanitizarValor(nombre ?? `#${ref.id.slice(0, 8)}`)}${monto}`;
}

/**
 * Líneas extra de un movimiento de dinero que el body trae tal cual: concepto, referencia y
 * fecha. Solo texto de campos conocidos (nunca el body completo).
 */
export function detallesExtraDinero(body: Cuerpo): string[] {
  const concepto = texto(body.descripcion);
  const referencia = texto(body.referencia);
  const fecha = texto(body.fecha);
  return [
    ...(concepto ? [`Concepto: ${sanitizarValor(concepto)}`] : []),
    ...(referencia ? [`Referencia: ${sanitizarValor(referencia)}`] : []),
    ...(fecha ? [`Fecha del movimiento: ${sanitizarValor(fecha)}`] : []),
  ];
}

/**
 * URLs de comprobantes del body que se pueden reenviar a Telegram: solo imágenes que
 * subió este mismo sistema al bucket "comprobantes" (el body lo controla el cliente y
 * Telegram descarga la URL desde sus servidores: no se acepta cualquier https).
 */
export function comprobantesReenviables(body: Cuerpo, supabaseUrl: string): string[] {
  if (!supabaseUrl) return [];
  const lista = Array.isArray(body.comprobantes) ? body.comprobantes : [];
  const validas = lista.filter((u): u is string => esUrlComprobanteValida(u, supabaseUrl));
  return [...new Set(validas)].slice(0, MAX_COMPROBANTES_AVISO);
}

/** HTML de Telegram (el de los avisos del grupo) a texto plano, para el webhook de contenido. */
export function htmlATextoPlano(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
