/** Tipos y utilidades puras de la cola de operaciones pendientes de envío (modo sin conexión).
 *
 *  Una operación = una petición HTTP (POST/PATCH/...) que se guardó en el teléfono porque no había
 *  red. Su `id` es también el `clientRequestId` que el servidor usa para no duplicarla. */

/** Versión del formato guardado en IndexedDB y en los respaldos exportados. */
export const VERSION_COLA = 1;

export type MetodoCola = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** pendiente: se enviará solo. rechazada: el servidor la rechazó, requiere acción humana.
 *  ilegible: la creó una versión más nueva de la app; se conserva intacta y no se envía. */
export type EstadoOperacion = 'pendiente' | 'rechazada' | 'ilegible';

export interface FotoCola {
  /** Id de la foto en el almacén de imágenes. */
  id: string;
  /** Clave del almacén de imágenes (siempre empieza por PREFIJO_CLAVE_COLA). */
  clave: string;
  /** URL ya subida: un reintento no vuelve a subir la foto. */
  url?: string;
}

export interface RechazoCola {
  status: number;
  mensaje: string;
  en: number;
}

export interface OperacionCola {
  v: number;
  /** UUID: identifica la operación en la cola y es el clientRequestId enviado al servidor. */
  id: string;
  tipo: string;
  endpoint: string;
  metodo: MetodoCola;
  payload: unknown;
  fotos: FotoCola[];
  dependeDe?: string;
  /** Resultado (respuesta 2xx) de la operación de la que depende, para que `preparar` lo use. */
  resultadoDependencia?: unknown;
  descripcion: string;
  codigoProvisional?: string;
  /** Usuario que la creó: no se envía con la sesión de otro usuario. */
  usuarioId?: string;
  estado: EstadoOperacion;
  /** Momento real (ISO) en que el usuario hizo la operación. */
  capturadoEn: string;
  creadoEn: number;
  intentos: number;
  /** No reintentar antes de este momento (ms epoch). */
  proximoIntento: number;
  ultimoError?: string;
  rechazo?: RechazoCola;
}

export interface NuevaOperacion {
  tipo: string;
  endpoint: string;
  metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  payload: unknown;
  fotos?: Array<{ id: string; clave: string }>;
  dependeDe?: string;
  descripcion: string;
  codigoProvisional?: string;
  /** Id propio (el clientRequestId ya usado en un primer intento online). Si se omite se genera. */
  id?: string;
  /** Momento real de la captura si ya se conoce (ISO). */
  capturadoEn?: string;
}

export interface ManejadorTipo {
  /** Puede devolver `{endpoint?, payload?}` para ajustar la petición justo antes de enviarla
   *  (p. ej. usando `op.resultadoDependencia`). */
  preparar?: (op: OperacionCola) => Promise<unknown>;
  /** Persistir/propagar el resultado (se ejecuta ANTES de quitar la operación de la cola). */
  alExito?: (op: OperacionCola, respuesta: unknown) => Promise<void>;
  alRechazo?: (op: OperacionCola, error: RechazoCola) => Promise<void>;
}

export interface EstadoCola {
  pendientes: OperacionCola[];
  rechazadas: OperacionCola[];
  /** Operaciones de OTROS usuarios de este equipo: solo se cuentan, sin detalle ni acciones. */
  ajenas: number;
  enviando: boolean;
  /** Hay operaciones esperando una sesión válida (401). */
  pausadaPorSesion: boolean;
}

// ---- claves y referencias de fotos --------------------------------------------

/** Las imágenes con este prefijo de clave NUNCA se purgan mientras la operación esté en la cola. */
export const PREFIJO_CLAVE_COLA = 'cola:';
const PREFIJO_REF_FOTO = 'local:';

export function claveDeCola(idOperacion: string): string {
  return `${PREFIJO_CLAVE_COLA}${idOperacion}`;
}

export function esClaveDeCola(clave: string): boolean {
  return clave.startsWith(PREFIJO_CLAVE_COLA);
}

/** Texto que se pone en el payload en lugar de la URL de una foto aún no subida. */
export function refFoto(idFoto: string): string {
  return `${PREFIJO_REF_FOTO}${idFoto}`;
}

export function idDeRefFoto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_REF_FOTO) ? valor.slice(PREFIJO_REF_FOTO.length) : null;
}

/** Devuelve una copia del valor con cada referencia `local:<id>` cambiada por su URL (no muta). */
export function sustituirReferencias(valor: unknown, urls: ReadonlyMap<string, string>): unknown {
  const id = idDeRefFoto(valor);
  if (id !== null) return urls.get(id) ?? valor;
  if (Array.isArray(valor)) return valor.map(v => sustituirReferencias(v, urls));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, sustituirReferencias(v, urls)]));
  }
  return valor;
}

/** Referencias `local:<id>` que quedan sin resolver en el valor. */
export function referenciasPendientes(valor: unknown, acumulado: string[] = []): string[] {
  const id = idDeRefFoto(valor);
  if (id !== null) acumulado.push(id);
  else if (Array.isArray(valor)) valor.forEach(v => referenciasPendientes(v, acumulado));
  else if (valor && typeof valor === 'object') Object.values(valor).forEach(v => referenciasPendientes(v, acumulado));
  return acumulado;
}

// ---- reintentos ------------------------------------------------------------------

export const ESPERA_BASE_MS = 5_000;
export const ESPERA_MAX_MS = 5 * 60_000;

/** Retroceso exponencial: 5 s, 10 s, 20 s ... tope 5 min. `intentos` ya incluye el que falló. */
export function esperaTrasFallo(intentos: number): number {
  const exponente = Math.max(0, Math.min(intentos, 20) - 1);
  return Math.min(ESPERA_BASE_MS * 2 ** exponente, ESPERA_MAX_MS);
}

// ---- clasificación de respuestas ----------------------------------------------------

export type ClaseRespuesta = 'exito' | 'sesion' | 'reintentar' | 'rechazo';

const ESTADOS_SIN_SERVIDOR: ReadonlySet<number> = new Set([0, 408, 425, 429, 502, 503, 504]);

/** 2xx éxito; 401 pausa por sesión; 5xx/red/409 con `reintentar` reintenta; el resto de 4xx se rechaza. */
export function clasificarRespuesta(status: number, cuerpo: unknown): ClaseRespuesta {
  if (status >= 200 && status < 300) return 'exito';
  if (status === 401) return 'sesion';
  if (status >= 500 || ESTADOS_SIN_SERVIDOR.has(status)) return 'reintentar';
  if (status === 409 && cuerpo && typeof cuerpo === 'object' && (cuerpo as { reintentar?: unknown }).reintentar === true) {
    return 'reintentar';
  }
  return 'rechazo';
}

/** Mensaje legible del servidor (error + detalles de validación) para mostrar en una rechazada. */
export function mensajeDeRechazo(status: number, cuerpo: unknown): string {
  const body = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as {
    error?: unknown;
    detalles?: Array<{ campo?: string; mensaje?: string }>;
  };
  let mensaje = typeof body.error === 'string' && body.error ? body.error : `El servidor rechazó la operación (error ${status}).`;
  if (Array.isArray(body.detalles) && body.detalles.length > 0) {
    const dets = body.detalles
      .map(d => (d.campo && d.campo !== '(raíz)' ? `${d.campo}: ${d.mensaje ?? ''}` : d.mensaje ?? ''))
      .filter(Boolean)
      .join(' · ');
    if (dets) mensaje = `${mensaje} (${dets})`;
  }
  return mensaje;
}

// ---- formato versionado ---------------------------------------------------------------

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Convierte un registro leído de IndexedDB o de un respaldo en una OperacionCola válida.
 *  - Registros de la versión actual (o anteriores, que se migran) → operación normal.
 *  - Versión MÁS NUEVA que la conocida → 'ilegible': se conserva sin tocar y no se envía.
 *  - Basura sin id/endpoint → null (el llamador decide; nunca se borra solo del almacén). */
export function normalizarOperacion(raw: unknown): OperacionCola | null {
  if (!esObjeto(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  const version = typeof raw.v === 'number' ? raw.v : 1;
  const base: OperacionCola = {
    v: VERSION_COLA,
    id: raw.id,
    tipo: typeof raw.tipo === 'string' ? raw.tipo : 'desconocida',
    endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : '',
    metodo: (['POST', 'PATCH', 'PUT', 'DELETE'] as const).find(m => m === raw.metodo) ?? 'POST',
    payload: raw.payload,
    fotos: Array.isArray(raw.fotos)
      ? raw.fotos.filter((f): f is FotoCola => esObjeto(f) && typeof f.id === 'string' && typeof f.clave === 'string')
      : [],
    dependeDe: typeof raw.dependeDe === 'string' ? raw.dependeDe : undefined,
    resultadoDependencia: raw.resultadoDependencia,
    descripcion: typeof raw.descripcion === 'string' ? raw.descripcion : 'Operación pendiente',
    codigoProvisional: typeof raw.codigoProvisional === 'string' ? raw.codigoProvisional : undefined,
    usuarioId: typeof raw.usuarioId === 'string' ? raw.usuarioId : undefined,
    estado: raw.estado === 'rechazada' ? 'rechazada' : 'pendiente',
    capturadoEn: typeof raw.capturadoEn === 'string' ? raw.capturadoEn : new Date(0).toISOString(),
    creadoEn: typeof raw.creadoEn === 'number' ? raw.creadoEn : 0,
    intentos: typeof raw.intentos === 'number' ? raw.intentos : 0,
    proximoIntento: typeof raw.proximoIntento === 'number' ? raw.proximoIntento : 0,
    ultimoError: typeof raw.ultimoError === 'string' ? raw.ultimoError : undefined,
    rechazo: esObjeto(raw.rechazo) && typeof raw.rechazo.mensaje === 'string'
      ? { status: Number(raw.rechazo.status) || 0, mensaje: raw.rechazo.mensaje, en: Number(raw.rechazo.en) || 0 }
      : undefined,
  };
  if (base.endpoint === '' && version <= VERSION_COLA) return null;
  if (version > VERSION_COLA) {
    // Se conserva el registro original completo para no perder campos que esta versión no conoce.
    return { ...(raw as unknown as OperacionCola), estado: 'ilegible' };
  }
  return base;
}
