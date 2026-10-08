/** Ejecución idempotente de las operaciones que la cola sin conexión (Fase 4) reintenta:
 *  toma física, altas de maestros, transformaciones y packing list.
 *  Sin `clientRequestId` ejecuta `fn` directo: el comportamiento de siempre queda intacto.
 *  Con él, `ejecutarIdempotente` (Fase 3) garantiza una sola ejecución por reintentos. */
import type { Response } from 'express';
import { ejecutarIdempotente, responderErrorIdempotencia, type OpcionesIdempotencia } from './idempotencia-service.js';
import { z } from 'zod';
import { clienteOperacionCampos } from '../schemas/cliente-operacion.js';

export interface Idempotente<T> { resultado: T; repetida: boolean }

export interface MetaCliente {
  clientRequestId?: string;
  capturadoEn?: string;
}

/** Tipos de operación guardados en operaciones_cliente.tipo (uno por endpoint de la cola). */
export const TIPO_OPERACION = {
  tomaFisicaCrear: 'toma_fisica_crear',
  tomaFisicaPesaje: 'toma_fisica_pesaje',
  proveedorCrear: 'proveedor_crear',
  clienteCrear: 'cliente_crear',
  productoCrear: 'producto_crear',
  taraCrear: 'tara_crear',
  almacenCrear: 'almacen_crear',
  vehiculoCrear: 'vehiculo_crear',
  transformacionFerrosoCrear: 'transformacion_ferroso_crear',
  transformacionPcbCrear: 'transformacion_pcb_crear',
  transformacionFerrosoCompletar: 'transformacion_ferroso_completar',
  transformacionPcbCompletar: 'transformacion_pcb_completar',
  transformacionMixtaCompletar: 'transformacion_mixta_completar',
  packingListCrear: 'packing_list_crear',
  packingListEditar: 'packing_list_editar',
} as const;

export type TipoOperacion = (typeof TIPO_OPERACION)[keyof typeof TIPO_OPERACION];

/** Tipo ligado al recurso afectado (`<tipo>:<id>`): reusar un UUID de operación sobre OTRO recurso
 *  da conflicto 409 en vez de devolver el resultado del primero. Para operaciones sobre un registro existente. */
export type TipoOperacionConRecurso = `${TipoOperacion}:${string}`;

const UUID_RECURSO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Defensa extra: el id acaba en operaciones_cliente.tipo, así que solo se admite un UUID (36 caracteres). */
export function exigirIdRecurso(recursoId: string): string {
  if (!UUID_RECURSO_RE.test(recursoId)) throw new Error('Identificador de recurso inválido.');
  return recursoId;
}

export function tipoDeRecurso(tipo: TipoOperacion, recursoId: string): TipoOperacionConRecurso {
  exigirIdRecurso(recursoId);
  return `${tipo}:${recursoId}`;
}

/** Agrega `clientRequestId`/`capturadoEn` opcionales a un esquema que no los trae
 *  (los esquemas de alta de maestros también se reutilizan para actualizar, por eso no se tocan). */
export function conOperacionCliente<S extends z.ZodType>(esquema: S) {
  return z.intersection(esquema, z.object(clienteOperacionCampos));
}

type Ejecutor = typeof ejecutarIdempotente;

/** Núcleo puro: el ejecutor se inyecta para poder probarlo sin base de datos. */
export async function ejecutarOperacionCon<T>(
  ejecutor: Ejecutor,
  tipo: TipoOperacion | TipoOperacionConRecurso,
  meta: MetaCliente,
  usuarioId: string,
  fn: () => Promise<T>,
  opciones: Omit<OpcionesIdempotencia<T>, 'capturadoEn'> = {},
): Promise<Idempotente<T>> {
  if (!meta.clientRequestId) return { resultado: await fn(), repetida: false };
  return ejecutor(meta.clientRequestId, tipo, usuarioId, fn, { ...opciones, capturadoEn: meta.capturadoEn });
}

/** Ejecuta `fn` de forma idempotente; si hay un error de idempotencia (409/503) ya respondió y devuelve null. */
export async function ejecutarOperacion<T>(
  res: Response,
  tipo: TipoOperacion | TipoOperacionConRecurso,
  meta: MetaCliente,
  usuarioId: string,
  fn: () => Promise<T>,
  opciones: Omit<OpcionesIdempotencia<T>, 'capturadoEn'> = {},
): Promise<Idempotente<T> | null> {
  try {
    return await ejecutarOperacionCon(ejecutarIdempotente, tipo, meta, usuarioId, fn, opciones);
  } catch (e) {
    if (responderErrorIdempotencia(res, e)) return null;
    throw e;
  }
}

/** Cuerpo de respuesta: si es una repetición se avisa con `repetida: true` (mismo estilo que pesajes). */
export function cuerpoConRepetida<T extends object>(resultado: T, repetida: boolean): T | (T & { repetida: true }) {
  return repetida ? { ...resultado, repetida: true as const } : resultado;
}
