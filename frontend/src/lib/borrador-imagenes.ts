/** Lógica pura del almacén de imágenes de borrador (fotos pendientes de subir).
 *
 *  Un File no se serializa a JSON, así que el borrador de texto (localStorage)
 *  solo guarda una referencia (`id`) por foto y los Blobs viven aparte, en un
 *  `AlmacenImagenes` (IndexedDB en el navegador, en memoria en las pruebas).
 *
 *  Pensado para reutilizarse fuera de los borradores (p. ej. una cola de
 *  pesajes pendientes de envío sin conexión): el almacén es genérico, indexado
 *  por (clave, id); cualquier módulo puede usar su propia `clave`.
 *
 *  Sin React ni acceso directo a `window`: el almacén, el reloj y la
 *  compresión se inyectan. Todo acceso al almacén va en try/catch: en modo
 *  privado o con la cuota llena la app sigue, solo que sin fotos de borrador. */

import { esClaveDeCola } from './offline/cola-tipos';

/** Una foto del borrador no puede pesar más que esto (ya comprimida). */
/** Tope por foto en el cliente: menor que el del servidor para que nunca la rechace después de la espera. */
export const MAX_BYTES_IMAGEN = 5 * 1024 * 1024;
/** Tope de todas las imágenes guardadas (suma de todos los borradores del origen). */
export const MAX_BYTES_TOTAL_IMAGENES = 60 * 1024 * 1024;
/** Edad máxima absoluta de una imagen, aunque su borrador de texto siga vivo. */
export const MAX_EDAD_IMAGEN_MS = 7 * 24 * 60 * 60 * 1000;
/** Una imagen recién guardada no se considera huérfana: su borrador de texto se escribe con debounce. */
export const GRACIA_HUERFANA_MS = 2 * 60 * 1000;
/** Tope aparte para las fotos de la cola de pendientes de envío (claves `cola:`). */
export const MAX_BYTES_TOTAL_COLA = 400 * 1024 * 1024;

export interface MetaImagen {
  clave: string;
  id: string;
  bytes: number;
  guardadoEn: number;
  /** El borrador al que pertenece vive en sessionStorage (sesión sin "Recordarme"). */
  soloSesion: boolean;
  nombre: string;
  tipo: string;
}

export interface RegistroImagen extends MetaImagen {
  blob: Blob;
}

export interface AlmacenImagenes {
  poner(registro: RegistroImagen): Promise<void>;
  obtener(clave: string, id: string): Promise<RegistroImagen | null>;
  /** Metadatos de todas las imágenes (sin leer su contenido). */
  listar(): Promise<MetaImagen[]>;
  borrar(clave: string, id: string): Promise<void>;
  borrarClave(clave: string): Promise<void>;
  borrarTodo(): Promise<void>;
}

export type ResultadoImagen = 'guardada' | 'grande' | 'sin-cupo' | 'error';

export interface OpcionesImagenes {
  soloSesion?: boolean;
  ahora?: () => number;
  /** Compresión previa (en el navegador: comprimirImagen). Si falla se guarda el original. */
  comprimir?: (archivo: File) => Promise<File>;
  maxBytesImagen?: number;
  maxBytesTotal?: number;
}

export interface FotoPendiente {
  id: string;
  file: Blob;
}

// ---- ids estables por archivo ------------------------------------------------

const idsPorArchivo = new WeakMap<object, string>();
let contadorIds = 0;

function nuevoId(): string {
  contadorIds += 1;
  const azar = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${contadorIds.toString(36)}-${azar}`;
}

/** Id estable del archivo mientras exista en memoria: así la misma foto no se
 *  vuelve a guardar en cada autoguardado del borrador. */
export function idDeArchivo(archivo: object): string {
  let id = idsPorArchivo.get(archivo);
  if (!id) {
    id = nuevoId();
    idsPorArchivo.set(archivo, id);
  }
  return id;
}

/** Asocia un archivo recuperado de IndexedDB a su id original (no se reescribe al restaurar). */
export function registrarIdArchivo(archivo: object, id: string): void {
  idsPorArchivo.set(archivo, id);
}

// ---- operaciones sobre el almacén --------------------------------------------

/** Las fotos de la cola de envío (`cola:<id>`) no caducan ni se purgan como huérfanas: solo se
 *  borran al enviarse o descartarse la operación a la que pertenecen. */
function esProtegida(meta: Pick<MetaImagen, 'clave'>): boolean {
  return esClaveDeCola(meta.clave);
}

function esCaducada(meta: MetaImagen, ahora: number): boolean {
  return !esProtegida(meta) && ahora - meta.guardadoEn > MAX_EDAD_IMAGEN_MS;
}

/** Guarda (o reemplaza) una imagen. Comprime antes si se inyectó compresión. */
export async function guardarImagen(
  almacen: AlmacenImagenes,
  clave: string,
  id: string,
  archivo: File,
  opciones: OpcionesImagenes = {},
): Promise<ResultadoImagen> {
  try {
    const ahora = (opciones.ahora ?? Date.now)();
    let final = archivo;
    if (opciones.comprimir) {
      try {
        final = await opciones.comprimir(archivo);
      } catch {
        final = archivo;
      }
    }
    if (final.size > (opciones.maxBytesImagen ?? MAX_BYTES_IMAGEN)) return 'grande';
    const protegida = esClaveDeCola(clave);
    const maxTotal = opciones.maxBytesTotal ?? (protegida ? MAX_BYTES_TOTAL_COLA : MAX_BYTES_TOTAL_IMAGENES);
    let metas = await almacen.listar();
    for (const m of metas) {
      if (esCaducada(m, ahora)) await almacen.borrar(m.clave, m.id);
    }
    metas = metas.filter(m => !esCaducada(m, ahora));
    const usado = metas
      .filter(m => esProtegida(m) === protegida)
      .filter(m => !(m.clave === clave && m.id === id))
      .reduce((suma, m) => suma + m.bytes, 0);
    if (usado + final.size > maxTotal) return 'sin-cupo';
    await almacen.poner({
      clave,
      id,
      blob: final,
      bytes: final.size,
      guardadoEn: ahora,
      soloSesion: opciones.soloSesion ?? false,
      nombre: final.name || archivo.name,
      tipo: final.type || archivo.type,
    });
    return 'guardada';
  } catch {
    return 'error';
  }
}

/** Lee una imagen como File (null si no existe o el almacén falla). */
export async function leerImagen(almacen: AlmacenImagenes, clave: string, id: string): Promise<File | null> {
  try {
    const reg = await almacen.obtener(clave, id);
    if (!reg) return null;
    const blob = reg.blob;
    return typeof File !== 'undefined' && blob instanceof File
      ? blob
      : new File([blob], reg.nombre || 'foto.jpg', { type: reg.tipo || blob.type });
  } catch {
    return null;
  }
}

/** Lee varias imágenes de un borrador; las que falten no aparecen en el mapa. */
export async function cargarImagenes(
  almacen: AlmacenImagenes,
  clave: string,
  ids: readonly string[],
): Promise<Map<string, File>> {
  const mapa = new Map<string, File>();
  const leidas = await Promise.all(ids.map(async id => [id, await leerImagen(almacen, clave, id)] as const));
  for (const [id, file] of leidas) if (file) mapa.set(id, file);
  return mapa;
}

export async function borrarImagenesDeClave(almacen: AlmacenImagenes | null, clave: string): Promise<void> {
  if (!almacen) return;
  try {
    await almacen.borrarClave(clave);
  } catch {
    // Almacén bloqueado: las huérfanas se purgan al iniciar la app.
  }
}

export interface ResultadoSincronizacion {
  /** Ids que quedaron guardados en el almacén para esta clave (nuevo conjunto, no muta el recibido). */
  persistidos: Set<string>;
  /** Fotos nuevas que no se pudieron guardar (cuota, tamaño, almacén bloqueado). */
  fallidas: number;
}

/** Deja el almacén igual a las fotos presentes en el formulario: guarda las
 *  nuevas y borra las que el usuario quitó. Solo borra ids que ESTA instancia
 *  guardó o restauró (`persistidos`): otra pestaña con el mismo borrador no
 *  pierde sus fotos por un autoguardado ajeno. */
export async function sincronizarImagenes(
  almacen: AlmacenImagenes,
  clave: string,
  presentes: readonly FotoPendiente[],
  persistidos: ReadonlySet<string>,
  opciones: OpcionesImagenes = {},
): Promise<ResultadoSincronizacion> {
  const siguiente = new Set(persistidos);
  const idsPresentes = new Set(presentes.map(f => f.id));
  let fallidas = 0;
  for (const id of persistidos) {
    if (idsPresentes.has(id)) continue;
    try {
      await almacen.borrar(clave, id);
    } catch {
      // Se purgará como huérfana.
    }
    siguiente.delete(id);
  }
  for (const foto of presentes) {
    if (persistidos.has(foto.id)) continue;
    const archivo = foto.file as File;
    const r = await guardarImagen(almacen, clave, foto.id, archivo, opciones);
    if (r === 'guardada') siguiente.add(foto.id);
    else fallidas += 1;
  }
  return { persistidos: siguiente, fallidas };
}

export interface OpcionesLimpieza {
  ahora?: () => number;
  /** ¿Sigue existiendo el borrador de texto de esta clave? (en el storage que le corresponde) */
  existeBorrador: (clave: string, soloSesion: boolean) => boolean;
  graciaMs?: number;
}

/** Borra imágenes caducadas y las de borradores que ya no existen (higiene al iniciar la app). */
export async function limpiarImagenesHuerfanas(
  almacen: AlmacenImagenes | null,
  opciones: OpcionesLimpieza,
): Promise<number> {
  if (!almacen) return 0;
  let borradas = 0;
  try {
    const ahora = (opciones.ahora ?? Date.now)();
    const gracia = opciones.graciaMs ?? GRACIA_HUERFANA_MS;
    const existencia = new Map<string, boolean>();
    for (const m of await almacen.listar()) {
      const llave = `${m.soloSesion ? 's' : 'l'}|${m.clave}`;
      if (!existencia.has(llave)) existencia.set(llave, opciones.existeBorrador(m.clave, m.soloSesion));
      const huerfana = !esProtegida(m) && !existencia.get(llave) && ahora - m.guardadoEn > gracia;
      if (huerfana || esCaducada(m, ahora)) {
        await almacen.borrar(m.clave, m.id);
        borradas += 1;
      }
    }
  } catch {
    // Almacén bloqueado.
  }
  return borradas;
}

/** Borra todas las imágenes de borradores. Las de la cola de envío se conservan siempre. */
export async function borrarTodasLasImagenes(almacen: AlmacenImagenes | null): Promise<void> {
  if (!almacen) return;
  try {
    for (const m of await almacen.listar()) {
      if (!esProtegida(m)) await almacen.borrar(m.clave, m.id);
    }
  } catch {
    // Almacén bloqueado.
  }
}

/** Almacén en memoria: para pruebas y como degradación cuando no hay IndexedDB. */
export function crearAlmacenEnMemoria(): AlmacenImagenes {
  const datos = new Map<string, RegistroImagen>();
  const llave = (clave: string, id: string) => `${clave}\u0000${id}`;
  return {
    async poner(r) { datos.set(llave(r.clave, r.id), r); },
    async obtener(clave, id) { return datos.get(llave(clave, id)) ?? null; },
    async listar() {
      return [...datos.values()].map((r): MetaImagen => ({
        clave: r.clave, id: r.id, bytes: r.bytes, guardadoEn: r.guardadoEn,
        soloSesion: r.soloSesion, nombre: r.nombre, tipo: r.tipo,
      }));
    },
    async borrar(clave, id) { datos.delete(llave(clave, id)); },
    async borrarClave(clave) {
      for (const [k, r] of datos) if (r.clave === clave) datos.delete(k);
    },
    async borrarTodo() { datos.clear(); },
  };
}
