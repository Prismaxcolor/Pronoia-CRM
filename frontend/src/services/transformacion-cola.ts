/** Transformaciones en el modo sin conexión (Fase 4): crear (ferroso/no ferroso, PCB) y completar pasan por
 *  la cola. El servidor valida el stock de entrada: si lo rechaza, la operación queda en «rechazadas» con
 *  el mensaje y no se pierde nada. Editar, valorar y eliminar siguen solo en línea. */
import type { Transformacion } from '@shared/types/index.js';
import { descartar } from '../lib/offline/cola';
import { esIdTemporal } from '../lib/offline/f4/ids-temporales';
import {
  peticionTransformacionCompletar, peticionTransformacionCrear,
  type CategoriaCreacion, type DatosTransformacionCrear, type PesadaEntradaConFotos, type SalidaConFotos, type VarianteCompletar,
} from '../lib/offline/f4/peticiones-f4';
import { ejecutarF4, entradaTemporal, idTemporalNuevo, leerOperacionesCola, provisionalesDe } from '../lib/offline/f4/servicio-f4';
import { TIPO_F4 } from '../lib/offline/f4/tipos-f4';
import { offlineHabilitado } from '../lib/offline/sesion';

export type ResultadoCrearTransformacion = { transformacion: Transformacion; enCola?: true } | { error: string };
export type ResultadoCompletarF4 =
  | { transformacion: Transformacion; advertencia?: string; enCola?: true }
  | { error: string };

const TIPOS_COMPLETAR: readonly string[] = [
  TIPO_F4.transformacionFerrosoCompletar, TIPO_F4.transformacionPcbCompletar, TIPO_F4.transformacionMixtaCompletar,
];

export const MENSAJE_COMPLETAR_YA_PENDIENTE = 'Ya hay una finalización de esta transformación esperando ser enviada. Revisa los pendientes de envío.';

/** Crea una transformación con una o varias pesadas de entrada. */
export async function crearTransformacionF4(
  categoria: CategoriaCreacion,
  datos: DatosTransformacionCrear,
  pesadas: PesadaEntradaConFotos[],
): Promise<ResultadoCrearTransformacion> {
  const idTemporal = idTemporalNuevo();
  const r = await ejecutarF4<{ transformacion: Transformacion }>(
    peticionTransformacionCrear(categoria, datos, pesadas, idTemporal, new Date().toISOString())
  );
  if (r.tipo === 'error') return { error: r.error };
  if (r.tipo === 'enviada') return { transformacion: r.respuesta.transformacion };
  const provisional = entradaTemporal(idTemporal)?.datos as unknown as Transformacion | undefined;
  if (!provisional) return { error: 'Quedó guardada en el teléfono, pero no se pudo mostrar. Revisa los pendientes de envío.' };
  return { transformacion: provisional, enCola: true };
}

async function completarYaPendiente(transformacionId: string): Promise<boolean> {
  const ops = await leerOperacionesCola();
  return ops.some(op => TIPOS_COMPLETAR.includes(op.tipo) && op.endpoint.includes(`/${transformacionId}/`));
}

/** Completa una transformación (en línea, o en la cola si no hay red / la transformación aún no existe en el servidor). */
export async function completarTransformacionF4(
  variante: VarianteCompletar,
  actual: Transformacion,
  salidas: SalidaConFotos[],
  mermaDetalle?: unknown,
): Promise<ResultadoCompletarF4> {
  if (offlineHabilitado() && (await completarYaPendiente(actual.id))) return { error: MENSAJE_COMPLETAR_YA_PENDIENTE };
  const r = await ejecutarF4<{ transformacion: Transformacion; advertencia?: string }>(
    peticionTransformacionCompletar(variante, actual.id, salidas, mermaDetalle)
  );
  if (r.tipo === 'error') return { error: r.error };
  if (r.tipo === 'enviada') {
    const { transformacion, advertencia } = r.respuesta;
    return { transformacion, ...(advertencia ? { advertencia } : {}) };
  }
  return { transformacion: actual, enCola: true };
}

/** Transformaciones creadas sin conexión que aún no se enviaron (para mezclarlas en el listado). */
export function transformacionesProvisionales(): Promise<Transformacion[]> {
  return offlineHabilitado() ? provisionalesDe<Transformacion>('transformacion') : Promise.resolve([]);
}

export function esTransformacionProvisional(id: string): boolean {
  return esIdTemporal(id);
}

/** Cancela una transformación creada sin conexión que aún no se envió: se quita de la cola (con sus fotos y
 *  lo que dependía de ella). false si no es provisional. */
export async function descartarTransformacionProvisional(id: string): Promise<boolean> {
  const entrada = entradaTemporal(id);
  if (!entrada || entrada.estado !== 'pendiente') return false;
  await descartar(entrada.opId);
  return true;
}
