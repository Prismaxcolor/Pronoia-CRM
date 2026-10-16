/** Conexión de la Fase 4 con el navegador real: red, cola, fotos, interruptor y registro de ids
 *  temporales. La lógica está en los demás archivos de esta carpeta (puros y con dependencias inyectadas). */
import { apiFetch } from '../../../services/api-client';
import { subirFotoTicket } from '../../../services/storage-service';
import { almacenFotosColaDelNavegador } from '../cola-fotos-idb';
import { subirFotosLocal } from '../../foto-picker';
import { comprimirImagen } from '../../image-compress';
import { invalidarCatalogo } from '../catalogos';
import { almacenColaDelNavegador } from '../cola-almacen';
import { encolar, nuevoIdOperacion, registrarTipoOperacion } from '../cola';
import { normalizarOperacion, type OperacionCola } from '../cola-tipos';
import { esErrorDeRed, estaOnline } from '../conexion';
import { offlineHabilitado } from '../sesion';
import { ejecutarOEncolar, type DepsEjecucion, type PeticionF4, type ResultadoF4 } from './ejecutar-o-encolar';
import {
  crearAlmacenRegistroLocalStorage, crearRegistroIds, nuevoIdTemporal, type EntradaTemporal, type RegistroIds, type TipoEntidadTemporal,
} from './ids-temporales';
import { crearManejadorF4, crearManejadorPesajeConIdsTemporales, TIPOS_OPERACION_F4 } from './manejadores-f4';
import { CATALOGO_DE_ENTIDAD, TIPOS_PESAJE_F3 } from './tipos-f4';

/** Tiempo máximo del intento en línea: pasado esto se guarda en la cola con el mismo id (idempotente). */
const TIMEOUT_ENLINEA_MS = 20_000;

let registroCompartido: RegistroIds | null = null;

export function registroIds(): RegistroIds {
  if (!registroCompartido) registroCompartido = crearRegistroIds(crearAlmacenRegistroLocalStorage());
  return registroCompartido;
}

export function idTemporalNuevo(): string {
  return nuevoIdTemporal();
}

function depsReales(): DepsEjecucion {
  return {
    offlineHabilitado,
    estaOnline,
    esErrorDeRed,
    enviar: ({ metodo, endpoint, cuerpo }) => apiFetch(endpoint, { method: metodo, body: cuerpo, timeoutMs: TIMEOUT_ENLINEA_MS }),
    // subirFotosLocal ya comprime cada foto nueva antes de subirla.
    subirFotos: fotos => subirFotosLocal(fotos, subirFotoTicket),
    encolar,
    nuevoIdOperacion,
    registro: registroIds(),
    // Las fotos de la cola viven en SU almacén ('fotos-cola'), el mismo que lee el motor al enviar.
    fotos: almacenFotosColaDelNavegador(),
    opcionesFotos: { comprimir: comprimirImagen },
    ahora: Date.now,
  };
}

/** Envía en línea o guarda en la cola (ver ejecutarOEncolar). */
export function ejecutarF4<T>(peticion: PeticionF4): Promise<ResultadoF4<T>> {
  return ejecutarOEncolar<T>(peticion, depsReales());
}

/** Operaciones que siguen en la cola (lectura directa del almacén; vacío si no hay IndexedDB). */
export async function leerOperacionesCola(): Promise<OperacionCola[]> {
  try {
    const crudas = (await almacenColaDelNavegador()?.listar()) ?? [];
    return crudas.map(normalizarOperacion).filter((op): op is OperacionCola => op !== null);
  } catch {
    return [];
  }
}

/** Entidades creadas sin conexión que siguen esperando su envío (para mezclarlas en listas y selectores). */
export async function provisionalesDe<T>(entidad: TipoEntidadTemporal): Promise<T[]> {
  const registro = registroIds();
  if (registro.pendientes(entidad).length === 0) return [];
  const vivas = new Set((await leerOperacionesCola()).filter(op => op.estado === 'pendiente').map(op => op.id));
  return registro.pendientes(entidad, vivas).map(e => e.datos as T);
}

export function entradaTemporal(id: string): EntradaTemporal | null {
  return registroIds().obtener(id);
}

/** Registra los manejadores de la Fase 4 (y extiende los de pesaje para aceptar ids temporales). Idempotente. */
let tiposRegistrados = false;
export function registrarTiposF4(): void {
  if (tiposRegistrados) return;
  tiposRegistrados = true;
  const deps = {
    registro: registroIds(),
    alResolverAlta: (entidad: TipoEntidadTemporal) => {
      const catalogo = CATALOGO_DE_ENTIDAD[entidad];
      if (catalogo) void invalidarCatalogo(catalogo);
    },
  };
  const manejador = crearManejadorF4(deps);
  for (const tipo of TIPOS_OPERACION_F4) registrarTipoOperacion(tipo, manejador);
  const pesaje = crearManejadorPesajeConIdsTemporales(deps);
  for (const tipo of TIPOS_PESAJE_F3) registrarTipoOperacion(tipo, pesaje);
}
