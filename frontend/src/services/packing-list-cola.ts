/** Packing list en el modo sin conexión (Fase 4): crear y editar pasan por la cola.
 *  Editar lleva la versión base que el usuario cargó; si otra persona guardó antes, el servidor responde
 *  409 y la operación queda en «rechazadas» con «Otra persona modificó este packing list» (nada se pierde). */
import type { PackingListDetalle, PackingListResumen } from '@shared/types/index.js';
import { editarOperacion } from '../lib/offline/cola';
import { esIdTemporal } from '../lib/offline/f4/ids-temporales';
import { packingListProvisional, resumenDePackingList, type DatosPackingList } from '../lib/offline/f4/packing-f4';
import { peticionPackingListCrear, peticionPackingListEditar } from '../lib/offline/f4/peticiones-f4';
import { ejecutarF4, entradaTemporal, idTemporalNuevo, leerOperacionesCola, provisionalesDe, registroIds } from '../lib/offline/f4/servicio-f4';
import { TIPO_F4 } from '../lib/offline/f4/tipos-f4';
import { offlineHabilitado } from '../lib/offline/sesion';

/** Mismo texto que MENSAJE_PACKING_CONFLICTO del backend. */
export const MENSAJE_SERVIDOR_CONFLICTO_PACKING = 'Otra persona modificó este packing list; recarga.';

export type ResultadoGuardarPacking =
  | { packingList: PackingListDetalle; enCola?: true }
  | { error: string; conflicto?: true };

type EntradaGuardado = DatosPackingList & { version?: number };

const sinVersion = ({ version: _version, ...datos }: EntradaGuardado): DatosPackingList => {
  void _version;
  return datos;
};

const conflicto = (error: string): ResultadoGuardarPacking =>
  error === MENSAJE_SERVIDOR_CONFLICTO_PACKING ? { error, conflicto: true } : { error };

/** Edición pendiente de este packing list (para reemplazar su contenido en vez de apilar otra con la misma versión base). */
async function edicionPendiente(id: string) {
  const ops = await leerOperacionesCola();
  return ops.find(op => op.tipo === TIPO_F4.packingListEditar && op.estado === 'pendiente' && op.endpoint.endsWith(`/${id}`));
}

async function editarProvisional(idTemporal: string, datos: DatosPackingList): Promise<ResultadoGuardarPacking | null> {
  const entrada = entradaTemporal(idTemporal);
  if (!entrada || entrada.estado !== 'pendiente') return null;
  const anterior = entrada.datos as unknown as PackingListDetalle;
  const nuevo = packingListProvisional(datos, idTemporal, new Date().toISOString(), 1, anterior.createdAt);
  await editarOperacion(entrada.opId, datos);
  registroIds().registrar({ id: idTemporal, tipo: 'packing_list', opId: entrada.opId, datos: nuevo as unknown as Record<string, unknown> });
  return { packingList: nuevo, enCola: true };
}

export async function guardarPackingListF4(id: string | null, entrada: EntradaGuardado): Promise<ResultadoGuardarPacking> {
  const datos = sinVersion(entrada);
  if (id === null) {
    const idTemporal = idTemporalNuevo();
    const r = await ejecutarF4<{ packingList: PackingListDetalle }>(peticionPackingListCrear(datos as unknown as Record<string, unknown>, idTemporal, new Date().toISOString()));
    if (r.tipo === 'error') return conflicto(r.error);
    if (r.tipo === 'enviada') return { packingList: r.respuesta.packingList };
    const provisional = entradaTemporal(idTemporal)?.datos as unknown as PackingListDetalle | undefined;
    return provisional ? { packingList: provisional, enCola: true } : { error: 'Quedó guardado en el teléfono, pero no se pudo mostrar. Revisa los pendientes de envío.' };
  }

  if (esIdTemporal(id)) {
    const editado = await editarProvisional(id, datos);
    if (editado) return editado;
    id = registroIds().resolver(id) ?? id; // ya se sincronizó: se edita el real
  }
  if (entrada.version === undefined) return { error: 'Falta la versión del packing list que estás editando; recarga la página.' };

  const pendiente = offlineHabilitado() ? await edicionPendiente(id) : undefined;
  if (pendiente) {
    await editarOperacion(pendiente.id, { ...datos, version: entrada.version });
    return { packingList: packingListProvisional(datos, id, new Date().toISOString(), entrada.version), enCola: true };
  }
  const r = await ejecutarF4<{ packingList: PackingListDetalle }>(peticionPackingListEditar(id, datos as unknown as Record<string, unknown>, entrada.version));
  if (r.tipo === 'error') return conflicto(r.error);
  if (r.tipo === 'enviada') return { packingList: r.respuesta.packingList };
  return { packingList: packingListProvisional(datos, id, new Date().toISOString(), entrada.version), enCola: true };
}

/** Packing lists creados sin conexión y aún sin enviar, listos para el listado. */
export async function packingListsProvisionalesResumen(): Promise<PackingListResumen[]> {
  if (!offlineHabilitado()) return [];
  const detalles = await provisionalesDe<PackingListDetalle>('packing_list');
  return detalles.map(resumenDePackingList);
}

/** Detalle de un packing list creado sin conexión que aún no se envió (null si no es provisional). */
export function packingListTemporal(id: string): PackingListDetalle | null {
  const entrada = esIdTemporal(id) ? entradaTemporal(id) : null;
  return entrada && entrada.estado === 'pendiente' ? (entrada.datos as unknown as PackingListDetalle) : null;
}

/** Id real de un packing list creado sin conexión y ya sincronizado (el mismo id si no aplica). */
export function idServidorDePackingList(id: string): string {
  return esIdTemporal(id) ? registroIds().resolver(id) ?? id : id;
}
