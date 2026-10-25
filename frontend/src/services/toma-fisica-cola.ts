/** Toma física en el modo sin conexión (Fase 4): crear la toma y registrar conteos pasan por la cola.
 *  Culminar y cancelar siguen SOLO en línea y se bloquean si la toma tiene operaciones sin enviar. */
import type { DetalleTomaFisica, TomaFisicaInventario } from '@shared/types/index.js';
import type { FotoLocal } from '../lib/foto-picker';
import { descartar } from '../lib/offline/cola';
import { estaOnline } from '../lib/offline/conexion';
import { offlineHabilitado } from '../lib/offline/sesion';
import { esIdTemporal } from '../lib/offline/f4/ids-temporales';
import {
  bloqueoCulminarToma, filaDePesajePendiente, MENSAJE_SOLO_EN_LINEA_TOMA, opIdDeFilaPendiente, operacionesDeToma,
} from '../lib/offline/f4/pendientes-f4';
import {
  peticionPesajeToma, peticionTomaCrear, type DatosPesajeToma, type DatosTomaCrear, type NombresTomaProvisional,
} from '../lib/offline/f4/peticiones-f4';
import { ejecutarF4, entradaTemporal, idTemporalNuevo, leerOperacionesCola, registroIds } from '../lib/offline/f4/servicio-f4';

export type ResultadoCrearToma = { tomaFisica: TomaFisicaInventario; enCola?: boolean } | { error: string };
export type ResultadoPesajeToma = { id: string; enCola?: boolean } | { error: string };

export async function crearTomaFisicaF4(datos: DatosTomaCrear, nombres?: NombresTomaProvisional): Promise<ResultadoCrearToma> {
  const idTemporal = idTemporalNuevo();
  const r = await ejecutarF4<{ tomaFisica: TomaFisicaInventario }>(peticionTomaCrear(datos, idTemporal, new Date().toISOString(), nombres));
  if (r.tipo === 'error') return { error: r.error };
  if (r.tipo === 'enviada') return { tomaFisica: r.respuesta.tomaFisica };
  const provisional = entradaTemporal(idTemporal)?.datos as TomaFisicaInventario | undefined;
  if (!provisional) return { error: 'La toma quedó guardada en el teléfono, pero no se pudo mostrar. Revisa los pendientes de envío.' };
  return { tomaFisica: provisional, enCola: true };
}

/** Registra un conteo con sus fotos: en línea si hay red; si no, queda en el teléfono hasta poder enviarse. */
export async function registrarPesajeTomaFisicaF4(
  tomaFisicaId: string,
  datos: DatosPesajeToma,
  fotos: FotoLocal[],
  etiqueta?: string,
): Promise<ResultadoPesajeToma> {
  const r = await ejecutarF4<{ id: string }>(peticionPesajeToma(tomaFisicaId, datos, fotos, etiqueta));
  if (r.tipo === 'error') return { error: r.error };
  if (r.tipo === 'enviada') return { id: r.respuesta.id };
  return { id: r.op.id, enCola: true };
}

/** Toma provisional (creada sin conexión): su detalle son solo los conteos pendientes. */
export function tomaTemporal(id: string): TomaFisicaInventario | null {
  const entrada = entradaTemporal(id);
  return entrada && entrada.estado === 'pendiente' ? (entrada.datos as unknown as TomaFisicaInventario) : null;
}

/** Id real de una toma creada sin conexión y ya sincronizada (null si no aplica / aún no). */
export function idRealDeToma(id: string): string | null {
  return esIdTemporal(id) ? registroIds().resolver(id) : null;
}

/** Ids (temporal y real) con los que pueden estar nombrados los conteos pendientes de una toma. */
function idsDeToma(id: string): string[] {
  const real = idRealDeToma(id);
  return real ? [id, real] : [id];
}

/** Filas de detalle de los conteos de esta toma que aún no salieron del teléfono. */
export async function detallesPendientesDeToma(tomaFisicaId: string): Promise<DetalleTomaFisica[]> {
  if (!offlineHabilitado()) return [];
  const ops = operacionesDeToma(await leerOperacionesCola(), idsDeToma(tomaFisicaId)).filter(op => op.estado === 'pendiente');
  return ops.map(op => filaDePesajePendiente(op, tomaFisicaId));
}

/** Quita de la cola un conteo aún no enviado (con sus fotos guardadas). Los ya enviados se eliminan en el servidor. */
export async function quitarPesajePendiente(idFila: string): Promise<boolean> {
  const opId = opIdDeFilaPendiente(idFila);
  if (!opId) return false;
  await descartar(opId);
  return true;
}

/** Motivo por el que NO se puede culminar/cancelar la toma (sin conexión o con operaciones pendientes); null = se puede. */
export async function motivoNoCulminarToma(tomaFisicaId: string): Promise<string | null> {
  if (!offlineHabilitado()) return null; // interruptor apagado: comportamiento de siempre
  if (!estaOnline()) return MENSAJE_SOLO_EN_LINEA_TOMA;
  const opCreacion = registroIds().obtener(tomaFisicaId)?.opId ?? null;
  return bloqueoCulminarToma(await leerOperacionesCola(), idsDeToma(tomaFisicaId), opCreacion);
}
