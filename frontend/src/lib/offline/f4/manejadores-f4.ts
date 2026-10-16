/** Manejadores (preparar / alExito / alRechazo) de los tipos de operación de la Fase 4 y la
 *  extensión de ids temporales para los tipos de pesaje de la Fase 3.
 *
 *  - preparar: antes de enviar, cambia cada id temporal por el real (endpoint y payload). Si alguno
 *    todavía no existe, LANZA: la cola lo reintenta más tarde; nunca se envía un id temporal.
 *  - alExito: guarda la equivalencia id temporal -> id real ANTES de que la cola quite la operación.
 *  - alRechazo: marca la alta como rechazada (deja de ofrecerse en las listas). */
import type { ManejadorTipo, OperacionCola } from '../cola-tipos';
import {
  idsTemporalesEn, idsTemporalesEnTexto, sustituirIdsTemporales, sustituirIdsTemporalesEnTexto,
  type RegistroIds, type TipoEntidadTemporal,
} from './ids-temporales';
import { TIPO_F4, ENTIDAD_DE_ALTA } from './tipos-f4';

export interface DepsManejadores {
  registro: RegistroIds;
  /** Se llama tras resolver una alta: p. ej. invalidar el catálogo en caché para que aparezca el real. */
  alResolverAlta?: (entidad: TipoEntidadTemporal) => void | Promise<void>;
}

/** Id real dentro de la respuesta 2xx de una alta (`{ proveedor: { id } }`, `{ tomaFisica: { id } }`...). */
export function idRealDeRespuesta(entidad: TipoEntidadTemporal, respuesta: unknown): string | null {
  const clave: Record<TipoEntidadTemporal, string> = {
    toma_fisica: 'tomaFisica', proveedor: 'proveedor', cliente: 'cliente', producto: 'producto', tara: 'tara',
    almacen: 'almacen', vehiculo: 'vehiculo', transformacion: 'transformacion', packing_list: 'packingList',
  };
  const interior = (respuesta as Record<string, { id?: unknown } | undefined> | null)?.[clave[entidad]];
  return typeof interior?.id === 'string' && interior.id !== '' ? interior.id : null;
}

/** Ajuste de la petición (endpoint y payload sin ids temporales) o error si falta alguno. */
export function prepararConIdsTemporales(
  op: Pick<OperacionCola, 'endpoint' | 'payload'>,
  registro: RegistroIds,
): { endpoint: string; payload: unknown } {
  const usados = [...new Set([...idsTemporalesEnTexto(op.endpoint), ...idsTemporalesEn(op.payload)])];
  const reales = registro.reales();
  for (const id of usados) {
    if (reales.has(id)) continue;
    const entrada = registro.obtener(id);
    if (entrada?.estado === 'rechazada') throw new Error('Lo que se creó sin conexión y se usa aquí fue rechazado por el servidor.');
    throw new Error('Falta enviar primero lo que se creó sin conexión y se usa aquí.');
  }
  return {
    endpoint: sustituirIdsTemporalesEnTexto(op.endpoint, reales),
    payload: sustituirIdsTemporales(op.payload, reales),
  };
}

/** Manejador común de todos los tipos de la Fase 4 (altas y operaciones que dependen de ellas). */
export function crearManejadorF4(deps: DepsManejadores): ManejadorTipo {
  return {
    async preparar(op) {
      return prepararConIdsTemporales(op, deps.registro);
    },
    async alExito(op, respuesta) {
      const entrada = deps.registro.deOperacion(op.id);
      if (!entrada) return;
      const idReal = idRealDeRespuesta(entrada.tipo, respuesta);
      if (!idReal) throw new Error('La respuesta del servidor no trae el id de lo creado.');
      deps.registro.marcarResuelta(op.id, idReal);
      await deps.alResolverAlta?.(entrada.tipo);
    },
    async alRechazo(op) {
      deps.registro.marcarRechazada(op.id);
    },
  };
}

/** Mismo marcador `{dep}` que usan los tipos de pesaje de la Fase 3 en su endpoint. */
const MARCADOR_DEPENDENCIA = '{dep}';

function idCreadoPorPesaje(resultado: unknown): string | null {
  const r = resultado as { ticket?: { id?: unknown }; traslado?: { id?: unknown } } | null;
  const id = r?.ticket?.id ?? r?.traslado?.id;
  return typeof id === 'string' ? id : null;
}

/** Extiende un tipo de pesaje de la Fase 3 (ticket/traslado): conserva el reemplazo de `{dep}` y suma la
 *  sustitución de ids temporales (proveedor, cliente, producto o tara creados sin conexión). */
export function crearManejadorPesajeConIdsTemporales(deps: DepsManejadores): ManejadorTipo {
  return {
    async preparar(op) {
      let endpoint = op.endpoint;
      if (endpoint.includes(MARCADOR_DEPENDENCIA)) {
        const id = idCreadoPorPesaje(op.resultadoDependencia);
        if (!id) throw new Error('Falta el resultado de la operación previa.');
        endpoint = endpoint.replace(MARCADOR_DEPENDENCIA, id);
      }
      return prepararConIdsTemporales({ endpoint, payload: op.payload }, deps.registro);
    },
  };
}

/** Tipos de la Fase 4 (todos usan el mismo manejador). */
export const TIPOS_OPERACION_F4: readonly string[] = Object.values(TIPO_F4);

export { ENTIDAD_DE_ALTA };
