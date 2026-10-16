/** Consultas puras sobre las operaciones de la cola que afectan a una toma física:
 *  bloquean culminar/cancelar y se muestran como conteos aún no enviados. */
import type { OperacionCola } from '../cola-tipos';
import { TIPO_F4 } from './tipos-f4';

export const PREFIJO_PESAJE_PENDIENTE = 'pend_';

export const MENSAJE_TOMA_CON_PENDIENTES =
  'Esta toma física tiene conteos sin enviar (guardados en el teléfono). Envíalos y revisa los pendientes antes de culminarla o cancelarla.';
export const MENSAJE_SOLO_EN_LINEA_TOMA = 'Culminar o cancelar una toma física requiere conexión a internet.';

/** Una operación pertenece a la toma si es su creación (id de la op) o un pesaje cuyo endpoint la nombra.
 *  `ids`: el id de la toma y, si existe, su otro id (temporal <-> real). */
export function operacionesDeToma(
  ops: readonly OperacionCola[],
  ids: string | readonly string[],
  opIdCreacion?: string | null,
): OperacionCola[] {
  const lista = typeof ids === 'string' ? [ids] : ids;
  return ops.filter(op =>
    (op.tipo === TIPO_F4.tomaPesaje && lista.some(id => op.endpoint.includes(`/${id}/`))) ||
    (opIdCreacion != null && op.id === opIdCreacion)
  );
}

/** Mensaje de bloqueo si hay algo de la toma sin enviar; null si se puede culminar/cancelar. */
export function bloqueoCulminarToma(ops: readonly OperacionCola[], ids: string | readonly string[], opIdCreacion?: string | null): string | null {
  const n = operacionesDeToma(ops, ids, opIdCreacion).length;
  if (n === 0) return null;
  return n === 1 ? `${MENSAJE_TOMA_CON_PENDIENTES} (1 operación pendiente)` : `${MENSAJE_TOMA_CON_PENDIENTES} (${n} operaciones pendientes)`;
}

export function idFilaPendiente(opId: string): string {
  return `${PREFIJO_PESAJE_PENDIENTE}${opId}`;
}

export function opIdDeFilaPendiente(idFila: string): string | null {
  return idFila.startsWith(PREFIJO_PESAJE_PENDIENTE) ? idFila.slice(PREFIJO_PESAJE_PENDIENTE.length) : null;
}

interface CuerpoPesaje {
  productoId?: string | null;
  loteId?: string | null;
  pesoBruto?: number;
  tara?: number;
}

/** Fila de detalle (como las del servidor) para un conteo aún no enviado, para listarlo junto a los demás. */
export function filaDePesajePendiente(op: OperacionCola, tomaFisicaId: string, nombres: { producto?: string | null; lote?: string | null } = {}) {
  const c = (op.payload ?? {}) as CuerpoPesaje;
  const pesoBruto = Number(c.pesoBruto) || 0;
  const tara = Number(c.tara) || 0;
  return {
    id: idFilaPendiente(op.id),
    tomaFisicaId,
    productoId: c.productoId ?? null,
    nombreProducto: nombres.producto ?? null,
    loteId: c.loteId ?? null,
    nombreLote: nombres.lote ?? null,
    pesoBruto,
    tara,
    pesoNeto: pesoBruto - tara,
    fotos: [] as string[],
    registradoPor: '',
    createdAt: new Date(op.capturadoEn).toISOString(),
  };
}

export const ETIQUETA_PENDIENTE_ENVIO = 'pendiente de envío';

interface FilaConNombres {
  id: string;
  productoId: string | null;
  nombreProducto: string | null;
  loteId: string | null;
  nombreLote: string | null;
}

/** Pone nombre (y la marca «pendiente de envío») a las filas de conteos aún no enviados; las demás quedan igual. */
export function conNombresDePendientes<T extends FilaConNombres>(
  filas: readonly T[],
  productos: ReadonlyArray<{ id: string; nombre: string }>,
  lotes: ReadonlyArray<{ id: string; nombre: string }>,
): T[] {
  return filas.map(f => {
    if (opIdDeFilaPendiente(f.id) === null) return f;
    const producto = f.productoId ? productos.find(p => p.id === f.productoId)?.nombre : undefined;
    const lote = f.loteId ? lotes.find(l => l.id === f.loteId)?.nombre : undefined;
    if (f.productoId) return { ...f, nombreProducto: `${producto ?? 'Material'} (${ETIQUETA_PENDIENTE_ENVIO})`, nombreLote: lote ?? f.nombreLote };
    return { ...f, nombreLote: `${lote ?? 'Lote'} (${ETIQUETA_PENDIENTE_ENVIO})` };
  });
}
