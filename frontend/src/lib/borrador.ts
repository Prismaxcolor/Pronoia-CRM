/** Lógica pura de borradores persistentes de formularios (localStorage).
 *
 *  Sin React ni acceso directo a `window`: todas las funciones reciben el
 *  "storage" (interfaz mínima compatible con localStorage) y el reloj, para
 *  poder probarlas en node. Todo acceso al storage va en try/catch — en modo
 *  privado, con la cuota llena o con el storage bloqueado la app sigue
 *  funcionando, solo que sin borrador. */

import { borrarTodasLasImagenes, idDeArchivo, type FotoPendiente } from './borrador-imagenes';
import { almacenImagenesDelNavegador } from './borrador-imagenes-idb';

export interface StorageMinimo {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
  readonly length: number;
  key(indice: number): string | null;
}

export const PREFIJO_BORRADOR = 'pronoia:borrador:';
/** Un borrador más viejo que esto se descarta al leerlo. Por defecto 1 día: los
 *  formularios con pesos o dinero no deben reaparecer días después con datos
 *  que ya no reflejan la realidad. */
export const TTL_BORRADOR_MS = 24 * 60 * 60 * 1000;
/** TTL de los formularios de alta de maestros (proveedores, clientes, productos),
 *  donde no hay pesos ni dinero que se vuelvan obsoletos y reescribirlos cuesta más. */
export const TTL_ALTA_BORRADOR_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope de caracteres del borrador serializado (localStorage ronda 5 MB por
 *  origen y se comparte con el resto de la app). Un borrador de texto, aun el
 *  de un pesaje con muchas filas, queda muy por debajo. */
export const MAX_CARACTERES_BORRADOR = 200_000;
export const DEBOUNCE_BORRADOR_MS = 500;
/** Versión del sobre (no del formulario). Si cambia, todos los borradores previos se descartan. */
export const VERSION_SOBRE = 1;

/** Claves de campos que jamás se persisten, aunque aparezcan por error en el estado. */
const CLAVE_SENSIBLE = /pass(word)?|contrase|token|secret|api[-_]?key|authorization|credencial|llave/i;
/** Marca que deja en el JSON una foto sin subir: `{ __fotoPerdida: true, id }`. El `id` apunta al
 *  Blob guardado en el almacén de imágenes (borrador-imagenes.ts); los borradores antiguos no traen `id`. */
const MARCA_FOTO_PERDIDA = '__fotoPerdida';

/** Claves de datos personales que los formularios de proveedores y clientes NO persisten en el
 *  navegador (el usuario las vuelve a escribir al recuperar el borrador): identificación fiscal
 *  (RIF/RFC/cédula), teléfonos, correos y datos bancarios. Se pasan por formulario en
 *  `excluirCampos`; el filtro global CLAVE_SENSIBLE (contraseñas, tokens…) aplica siempre. */
export const CAMPOS_PERSONALES_BORRADOR: readonly string[] = [
  'identificacion', 'rfc', 'rif', 'cedula',
  'email', 'correo',
  'telefono', 'celular',
  'banco', 'cuentaBancaria', 'numeroCuenta', 'iban', 'titularCuenta',
];

export interface SobreBorrador {
  v: number;
  version: number;
  guardadoEn: number;
  /** TTL con el que se guardó (la limpieza global respeta el de cada formulario). */
  ttlMs?: number;
  /** Huella del documento base en un borrador de edición (ver huellaDocumento). */
  base?: string;
  datos: unknown;
}

export interface OpcionesBorrador {
  version: number;
  ttlMs?: number;
  maxCaracteres?: number;
  ahora?: () => number;
  /** Claves (en cualquier nivel) que no se persisten en este formulario: datos
   *  personales o bancarios que el usuario volverá a escribir. */
  excluirCampos?: readonly string[];
  /** Huella del documento que se editaba al guardar (solo formularios de edición). */
  base?: string | null;
  /** Al leer: no quitar las marcas de fotos pendientes (el llamador las rehidrata desde el almacén de imágenes). */
  conservarFotos?: boolean;
}

export type ResultadoGuardado = 'guardado' | 'grande' | 'error' | 'serializacion';

export interface BorradorLeido<T> {
  datos: T;
  guardadoEn: number;
  /** Huella del documento base guardada junto al borrador, si había. */
  base?: string;
  /** Fotos que estaban elegidas pero sin subir (File/Blob) y no se pudieron guardar. */
  fotosPerdidas: number;
  /** Ids de las fotos pendientes cuyo Blob debe leerse del almacén de imágenes. Solo con
   *  `conservarFotos`: en ese caso `datos` conserva las marcas para rehidratarlas con `rehidratarFotos`. */
  idsFotos: string[];
}

/** Clave por usuario + formulario (+ id del documento si aplica): dos usuarios
 *  del mismo equipo, o dos documentos distintos, nunca comparten borrador. */
export function claveBorrador(usuarioId: string, formulario: string, docId?: string | null): string {
  const partes = [usuarioId, formulario];
  if (docId) partes.push(docId);
  return PREFIJO_BORRADOR + partes.join(':');
}

function esFotoPendiente(valor: unknown): boolean {
  if (typeof valor !== 'object' || valor === null) return false;
  const o = valor as Record<string, unknown>;
  return o.tipo === 'nueva' && 'file' in o;
}

/** Reemplazador de JSON.stringify: quita campos sensibles, no serializa
 *  archivos y deja una marca donde había una foto sin subir. */
function crearReemplazador(excluir?: readonly string[], alFoto?: (foto: FotoPendiente) => void) {
  const extra = excluir && excluir.length > 0 ? new Set(excluir) : null;
  return function reemplazador(this: unknown, clave: string, valor: unknown): unknown {
    if (clave !== '' && extra?.has(clave)) return undefined;
    return reemplazadorBase.call(this, clave, valor, alFoto);
  };
}

function reemplazadorBase(this: unknown, clave: string, valor: unknown, alFoto?: (foto: FotoPendiente) => void): unknown {
  if (clave !== '' && CLAVE_SENSIBLE.test(clave)) return undefined;
  if (typeof File !== 'undefined' && valor instanceof File) return undefined;
  if (typeof Blob !== 'undefined' && valor instanceof Blob) return undefined;
  if (esFotoPendiente(valor)) {
    const archivo = (valor as { file: unknown }).file;
    if (typeof archivo !== 'object' || archivo === null) return { [MARCA_FOTO_PERDIDA]: true };
    const id = idDeArchivo(archivo);
    alFoto?.({ id, file: archivo as Blob });
    return { [MARCA_FOTO_PERDIDA]: true, id };
  }
  // Una URL blob: solo vale en la pestaña que la creó; guardarla dejaría una vista previa rota.
  if (typeof valor === 'string' && valor.startsWith('blob:')) return undefined;
  return valor;
}

/** Serializa el estado de un formulario para guardarlo. Devuelve null si no es serializable.
 *  `alFoto` recibe cada foto pendiente (File sin subir) que se reemplazó por su marca. */
export function serializarEstado(
  estado: unknown,
  excluirCampos?: readonly string[],
  alFoto?: (foto: FotoPendiente) => void,
): string | null {
  try {
    return JSON.stringify(estado, crearReemplazador(excluirCampos, alFoto)) ?? null;
  } catch {
    return null;
  }
}

/** Quita las marcas de fotos perdidas (recursivo) y cuenta cuántas había. */
export function quitarFotosPerdidas(valor: unknown): { datos: unknown; fotosPerdidas: number } {
  let fotosPerdidas = 0;
  const limpiar = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const salida: unknown[] = [];
      for (const item of v) {
        if (typeof item === 'object' && item !== null && MARCA_FOTO_PERDIDA in item) {
          fotosPerdidas += 1;
        } else {
          salida.push(limpiar(item));
        }
      }
      return salida;
    }
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, limpiar(val)]));
    }
    return v;
  };
  return { datos: limpiar(valor), fotosPerdidas };
}

/** Ids de las fotos pendientes que traen las marcas de un borrador leído con `conservarFotos`. */
export function idsFotosEnDatos(valor: unknown): string[] {
  const ids: string[] = [];
  const recorrer = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(recorrer);
    } else if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      if (MARCA_FOTO_PERDIDA in o) {
        if (typeof o.id === 'string' && o.id) ids.push(o.id);
        return;
      }
      Object.values(o).forEach(recorrer);
    }
  };
  recorrer(valor);
  return ids;
}

/** Cambia cada marca de foto por lo que devuelva `resolver(id)` (la foto rehidratada).
 *  Si no hay resultado (marca antigua sin id, Blob perdido) la foto se quita y se cuenta como perdida. */
export function rehidratarFotos(
  valor: unknown,
  resolver: (id: string) => unknown | undefined,
): { datos: unknown; fotosPerdidas: number } {
  let fotosPerdidas = 0;
  const marca = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && MARCA_FOTO_PERDIDA in v;
  const reemplazo = (v: Record<string, unknown>): unknown => (typeof v.id === 'string' ? resolver(v.id) : undefined);
  const rehidratar = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const salida: unknown[] = [];
      for (const item of v) {
        if (marca(item)) {
          const foto = reemplazo(item);
          if (foto === undefined) fotosPerdidas += 1;
          else salida.push(foto);
        } else {
          salida.push(rehidratar(item));
        }
      }
      return salida;
    }
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, rehidratar(val)]));
    }
    return v;
  };
  return { datos: rehidratar(valor), fotosPerdidas };
}

/** Cuenta cuántas fotos pendientes (sin subir) contiene un estado. */
export function contarFotosPendientes(estado: unknown): number {
  const texto = serializarEstado(estado);
  if (texto === null) return 0;
  return quitarFotosPerdidas(JSON.parse(texto)).fotosPerdidas;
}

export function borrarBorrador(storage: StorageMinimo | null, clave: string): void {
  if (!storage) return;
  try {
    storage.removeItem(clave);
  } catch {
    // Storage bloqueado: no hay nada que borrar de forma fiable.
  }
}

/** Guarda el borrador. Si no cabe (límite propio o cuota) borra el anterior
 *  para no dejar uno desactualizado y lo informa en el resultado. */
export function guardarBorrador(
  storage: StorageMinimo | null,
  clave: string,
  estado: unknown,
  opciones: OpcionesBorrador,
): ResultadoGuardado {
  if (!storage) return 'error';
  const ahora = opciones.ahora ?? Date.now;
  const datosTexto = serializarEstado(estado, opciones.excluirCampos);
  if (datosTexto === null) return 'serializacion';
  const ttl = opciones.ttlMs ?? TTL_BORRADOR_MS;
  const base = opciones.base ? `,"base":${JSON.stringify(opciones.base)}` : '';
  const sobre = `{"v":${VERSION_SOBRE},"version":${opciones.version},"guardadoEn":${ahora()},"ttlMs":${ttl}${base},"datos":${datosTexto}}`;
  if (sobre.length > (opciones.maxCaracteres ?? MAX_CARACTERES_BORRADOR)) {
    borrarBorrador(storage, clave);
    return 'grande';
  }
  try {
    storage.setItem(clave, sobre);
    return 'guardado';
  } catch {
    borrarBorrador(storage, clave);
    return 'error';
  }
}

/** Lee el borrador. Devuelve null (y borra la entrada) si no existe, está
 *  corrupto, es de otra versión de esquema o ya caducó. */
export function leerBorrador<T>(
  storage: StorageMinimo | null,
  clave: string,
  opciones: OpcionesBorrador,
): BorradorLeido<T> | null {
  if (!storage) return null;
  let crudo: string | null;
  try {
    crudo = storage.getItem(clave);
  } catch {
    return null;
  }
  if (crudo === null) return null;
  try {
    const sobre = JSON.parse(crudo) as Partial<SobreBorrador> | null;
    const ahora = (opciones.ahora ?? Date.now)();
    const ttl = opciones.ttlMs ?? TTL_BORRADOR_MS;
    const valido =
      sobre !== null &&
      typeof sobre === 'object' &&
      sobre.v === VERSION_SOBRE &&
      sobre.version === opciones.version &&
      typeof sobre.guardadoEn === 'number' &&
      ahora - sobre.guardadoEn <= ttl &&
      sobre.datos !== undefined;
    if (!valido) {
      borrarBorrador(storage, clave);
      return null;
    }
    const idsFotos = idsFotosEnDatos(sobre.datos);
    const { datos, fotosPerdidas } = opciones.conservarFotos
      ? { datos: sobre.datos, fotosPerdidas: 0 }
      : quitarFotosPerdidas(sobre.datos);
    return {
      datos: datos as T,
      guardadoEn: sobre.guardadoEn as number,
      fotosPerdidas,
      idsFotos: opciones.conservarFotos ? idsFotos : [],
      base: typeof sobre.base === 'string' ? sobre.base : undefined,
    };
  } catch {
    borrarBorrador(storage, clave);
    return null;
  }
}

function clavesConPrefijo(storage: StorageMinimo, prefijo: string): string[] {
  const claves: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k !== null && k.startsWith(prefijo)) claves.push(k);
  }
  return claves;
}

/** Borra todos los borradores de un usuario (al cerrar sesión). Sin usuarioId borra los de todos. */
export function borrarBorradoresDeUsuario(storage: StorageMinimo | null, usuarioId?: string): number {
  if (!storage) return 0;
  try {
    const prefijo = usuarioId ? `${PREFIJO_BORRADOR}${usuarioId}:` : PREFIJO_BORRADOR;
    const claves = clavesConPrefijo(storage, prefijo);
    claves.forEach(k => storage.removeItem(k));
    return claves.length;
  } catch {
    return 0;
  }
}

/** Elimina los borradores caducados o ilegibles (higiene al iniciar la app). */
export function limpiarBorradoresCaducados(
  storage: StorageMinimo | null,
  ahora: () => number = Date.now,
  ttlMs: number = TTL_BORRADOR_MS,
): number {
  if (!storage) return 0;
  let borrados = 0;
  try {
    for (const k of clavesConPrefijo(storage, PREFIJO_BORRADOR)) {
      let caducado = true;
      try {
        const sobre = JSON.parse(storage.getItem(k) ?? 'null') as Partial<SobreBorrador> | null;
        const ttl = typeof sobre?.ttlMs === 'number' ? sobre.ttlMs : ttlMs;
        caducado = !sobre || typeof sobre.guardadoEn !== 'number' || ahora() - sobre.guardadoEn > ttl;
      } catch {
        caducado = true;
      }
      if (caducado) {
        storage.removeItem(k);
        borrados += 1;
      }
    }
  } catch {
    // Storage bloqueado.
  }
  return borrados;
}

/** Compara dos estados ignorando ids locales de fila (uid) y URLs de vista
 *  previa (blob:), que cambian en cada render sin ser cambios del usuario. */
export function difiereEstado(actual: unknown, base: unknown, excluirCampos?: readonly string[]): boolean {
  const reemplazador = crearReemplazador(excluirCampos);
  const normalizar = (v: unknown) =>
    JSON.stringify(v, (k, val) => (k === 'uid' || k === 'preview' ? undefined : reemplazador.call(null, k, val)));
  try {
    return normalizar(actual) !== normalizar(base);
  } catch {
    return true;
  }
}

/** Texto "hace X" para el aviso de restauración. */
export function formatearAntiguedad(guardadoEn: number, ahora: number): string {
  const seg = Math.max(0, Math.floor((ahora - guardadoEn) / 1000));
  if (seg < 60) return 'hace instantes';
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/** Mensaje al restaurar un borrador que tenía fotos sin subir. */
export function mensajeFotosPerdidas(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 foto no se pudo recuperar, vuelve a agregarla.'
    : `${n} fotos no se pudieron recuperar, vuelve a agregarlas.`;
}

/** Mensaje al descartar un borrador de edición porque el documento cambió. */
export const MENSAJE_BORRADOR_OBSOLETO =
  'El documento cambió desde que guardaste este borrador, se descartó para no pisar cambios de otra persona.';

function probarStorage(candidato: () => StorageMinimo | undefined): StorageMinimo | null {
  try {
    const storage = candidato();
    if (!storage) return null;
    const prueba = `${PREFIJO_BORRADOR}__prueba`;
    storage.setItem(prueba, '1');
    storage.removeItem(prueba);
    return storage;
  } catch {
    return null;
  }
}

/** Dónde se guardan los borradores: sessionStorage si la sesión es solo de la
 *  pestaña (el usuario no marcó "Recordarme": al cerrar el navegador no debe
 *  quedar nada suyo), localStorage en caso contrario. null en modo
 *  privado/bloqueado o fuera del navegador. */
export function storageSeguro(soloSesion = false): StorageMinimo | null {
  return probarStorage(() => {
    if (soloSesion) return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  });
}

/** Borra todos los borradores (de cualquier usuario) de localStorage y de sessionStorage. */
export function borrarTodosLosBorradores(): void {
  borrarBorradoresDeUsuario(storageSeguro(false));
  borrarBorradoresDeUsuario(storageSeguro(true));
  // Las fotos de los borradores viven en IndexedDB: también salen al cerrar sesión.
  void borrarTodasLasImagenes(almacenImagenesDelNavegador());
}

/** Huella determinista de un documento (claves ordenadas, hash FNV-1a de 32 bits
 *  en hex): sirve para saber si el documento cambió desde que se guardó un borrador. */
export function huellaDocumento(valor: unknown): string {
  const canonico = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonico);
    if (typeof v === 'object' && v !== null) {
      // 'uid' y 'preview' son ids locales de fila / vistas previas: cambian en cada render sin ser parte del documento.
      return Object.fromEntries(Object.keys(v).filter(k => k !== 'uid' && k !== 'preview').sort().map(k => [k, canonico((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  const texto = JSON.stringify(canonico(valor)) ?? 'undefined';
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${texto.length}`;
}

export type DecisionRestauracion = 'restaurar' | 'obsoleto';

/** Un borrador de edición solo se restaura si el documento base no cambió desde
 *  que se guardó. Sin documento base (formularios de creación) siempre se restaura. */
export function decidirRestauracion(
  baseGuardada: string | null | undefined,
  baseActual: string | null | undefined,
): DecisionRestauracion {
  if (!baseActual) return 'restaurar';
  return baseGuardada === baseActual ? 'restaurar' : 'obsoleto';
}

/** Filas con uid y fotos recuperadas de un borrador: cada fila recibe un uid
 *  nuevo (los guardados podrían chocar con los ya repartidos), se completan
 *  los campos que falten con los de una fila vacía y siempre queda al menos una. */
export function restaurarFilas<T extends { uid: number; fotos?: unknown[] }>(
  filas: T[] | undefined,
  filaVacia: () => T,
): T[] {
  const lista = (filas ?? []).map(f => ({ ...filaVacia(), ...f, uid: filaVacia().uid, fotos: f.fotos ?? [] }));
  return lista.length > 0 ? lista : [filaVacia()];
}
