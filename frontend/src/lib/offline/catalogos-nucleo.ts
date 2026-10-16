/** Lógica pura de la caché de catálogos (modo sin conexión, fase 2).
 *
 *  Sin React ni acceso directo a IndexedDB/navigator: el almacén, el reloj, el
 *  usuario y las señales de red se inyectan, así se prueba en node. Principio
 *  rector: ante cualquier duda o falla de la caché, se comporta como la app
 *  de siempre (pide a la red y devuelve lo que la red responda). */

export const NOMBRE_BD_OFFLINE = 'pronoia-offline';
export const TIENDA_CATALOGOS = 'catalogos';
/** Súbela si cambia la FORMA de los datos cacheados: invalida lo guardado. */
export const SCHEMA_VERSION_CATALOGOS = 1;
export const MAX_EDAD_POR_DEFECTO_MS = 48 * 60 * 60 * 1000;
/** Tope duro: un dato guardado más viejo que esto NUNCA se sirve sin conexión ('obsoleto' solo avisa; esto bloquea). */
export const MAX_EDAD_DURA_MS = 7 * 24 * 60 * 60 * 1000;
export const TIMEOUT_REVALIDACION_MS = 4000;
export const MAX_ENTRADAS = 200;
export const MAX_CARACTERES_REGISTRO = 4_000_000;
export const MENSAJE_SIN_DATOS = 'Sin conexión y sin datos guardados';

export interface RegistroCatalogo {
  /** Clave de almacén: `${usuarioId}::${clave}` (keyPath de IndexedDB). */
  clave: string;
  usuarioId: string;
  datos: unknown;
  descargadoEn: number;
  schemaVersion: number;
}

export interface AlmacenCatalogos {
  leer(claveCompleta: string): Promise<RegistroCatalogo | undefined>;
  poner(registro: RegistroCatalogo): Promise<void>;
  borrar(claveCompleta: string): Promise<void>;
  listar(): Promise<RegistroCatalogo[]>;
  vaciar(): Promise<void>;
}

export interface ResultadoCatalogo<T> {
  datos: T;
  descargadoEn: number;
  obsoleto: boolean;
  origen: 'red' | 'cache';
}

export interface MetaAntiguedad {
  descargadoEn: number;
  obsoleto: boolean;
}

export interface DependenciasCatalogos {
  /** null = sin IndexedDB: la caché queda desactivada (comportamiento actual). */
  almacen: AlmacenCatalogos | null;
  ahora: () => number;
  usuarioId: () => string | null;
  /** Interruptor OFFLINE_ACTIVO: apagado = no se cachea ni se sirven datos viejos. */
  offlineActivo: () => boolean;
  estaOnline: () => boolean;
  esErrorDeRed: (err: unknown) => boolean;
  /** Se invoca al servir datos del caché (meta) o al traer datos frescos (null). */
  alRegistrar?: (clave: string, meta: MetaAntiguedad | null) => void;
  timeoutMs?: number;
  schemaVersion?: number;
  maxEntradas?: number;
  maxCaracteres?: number;
  maxEdadDuraMs?: number;
}

export function claveCompleta(usuarioId: string, clave: string): string {
  return `${usuarioId}::${clave}`;
}

export function esObsoleto(descargadoEn: number, ahora: number, maxEdadMs: number): boolean {
  return ahora - descargadoEn > maxEdadMs;
}

/** Extrae `sub` del payload del JWT SOLO para separar la caché por usuario (no
 *  es una verificación de identidad; el servidor sigue validando el token). */
export function usuarioIdDeToken(token: string | null): string | null {
  if (!token) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

/** "hace 5 min", "hace 3 h", "hace 2 días". */
export function textoAntiguedad(descargadoEn: number, ahora: number): string {
  const min = Math.max(0, Math.floor((ahora - descargadoEn) / 60_000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} días`;
}

function tamanoAproximado(datos: unknown): number | null {
  try {
    return JSON.stringify(datos)?.length ?? 0;
  } catch {
    return null;
  }
}

class TimeoutRevalidacion extends Error {
  constructor() {
    super('Tiempo de espera agotado');
    this.name = 'TimeoutRevalidacion';
  }
}

function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutRevalidacion()), ms);
    promesa.then(
      v => { clearTimeout(id); resolve(v); },
      e => { clearTimeout(id); reject(e); },
    );
  });
}

/** Fallas tras las que es seguro servir el dato guardado: red, timeout o 5xx.
 *  Un 401/403/4xx NO se enmascara (permisos o sesión cambiaron). */
export function esFalloDegradable(err: unknown, esErrorDeRed: (e: unknown) => boolean): boolean {
  if (err instanceof TimeoutRevalidacion || esErrorDeRed(err)) return true;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 500;
}

export interface GestorCatalogos {
  obtenerCatalogo<T>(
    clave: string,
    cargar: () => Promise<T>,
    opciones?: { maxEdadMs?: number },
  ): Promise<ResultadoCatalogo<T>>;
  invalidarCatalogo(clave: string): Promise<void>;
  limpiarCatalogos(): Promise<void>;
  /** Borra los registros cuyo usuarioId NO es `usuarioId` (cierre de sesión sin limpieza explícita). Devuelve cuántos borró. */
  purgarDeOtrosUsuarios(usuarioId: string): Promise<number>;
}

export function crearGestorCatalogos(deps: DependenciasCatalogos): GestorCatalogos {
  const schema = deps.schemaVersion ?? SCHEMA_VERSION_CATALOGOS;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_REVALIDACION_MS;
  const maxEntradas = deps.maxEntradas ?? MAX_ENTRADAS;
  const maxCaracteres = deps.maxCaracteres ?? MAX_CARACTERES_REGISTRO;
  const maxEdadDuraMs = deps.maxEdadDuraMs ?? MAX_EDAD_DURA_MS;
  const enVuelo = new Map<string, Promise<ResultadoCatalogo<unknown>>>();

  const contextoActivo = (): { almacen: AlmacenCatalogos; usuarioId: string } | null => {
    if (!deps.almacen || !deps.offlineActivo()) return null;
    const usuarioId = deps.usuarioId();
    return usuarioId ? { almacen: deps.almacen, usuarioId } : null;
  };

  async function leerVigente(almacen: AlmacenCatalogos, id: string): Promise<RegistroCatalogo | undefined> {
    try {
      const reg = await almacen.leer(id);
      if (!reg) return undefined;
      if (reg.schemaVersion !== schema) {
        await almacen.borrar(id).catch(() => undefined);
        return undefined;
      }
      if (esObsoleto(reg.descargadoEn, deps.ahora(), maxEdadDuraMs)) {
        // Pasó el tope duro de edad: se descarta, no se sirve ni sin conexión.
        await almacen.borrar(id).catch(() => undefined);
        return undefined;
      }
      return reg;
    } catch {
      return undefined;
    }
  }

  async function aplicarTopeEntradas(almacen: AlmacenCatalogos): Promise<void> {
    const todos = await almacen.listar();
    const exceso = todos.length - maxEntradas;
    if (exceso <= 0) return;
    const masViejos = [...todos].sort((a, b) => a.descargadoEn - b.descargadoEn).slice(0, exceso);
    await Promise.all(masViejos.map(r => almacen.borrar(r.clave)));
  }

  async function guardar(
    almacen: AlmacenCatalogos, usuarioId: string, clave: string, datos: unknown, descargadoEn: number,
  ): Promise<void> {
    try {
      const tam = tamanoAproximado(datos);
      if (tam === null || tam > maxCaracteres) return;
      const id = claveCompleta(usuarioId, clave);
      await almacen.poner({ clave: id, usuarioId, datos, descargadoEn, schemaVersion: schema });
      await aplicarTopeEntradas(almacen);
    } catch {
      // La caché es una mejora: si no se puede guardar, la app sigue como hoy.
    }
  }

  function servirDeCache<T>(reg: RegistroCatalogo, clave: string, maxEdadMs: number): ResultadoCatalogo<T> {
    const obsoleto = esObsoleto(reg.descargadoEn, deps.ahora(), maxEdadMs);
    deps.alRegistrar?.(clave, { descargadoEn: reg.descargadoEn, obsoleto });
    return { datos: reg.datos as T, descargadoEn: reg.descargadoEn, obsoleto, origen: 'cache' };
  }

  async function resolver<T>(
    clave: string, cargar: () => Promise<T>, maxEdadMs: number,
  ): Promise<ResultadoCatalogo<T>> {
    const ctx = contextoActivo();
    const desdeRed = async (): Promise<ResultadoCatalogo<T>> => {
      const datos = await cargar();
      const descargadoEn = deps.ahora();
      // Si mientras cargaba cambió el usuario (o se cerró la sesión), no se escribe en la caché de otro usuario.
      if (ctx && deps.usuarioId() === ctx.usuarioId) await guardar(ctx.almacen, ctx.usuarioId, clave, datos, descargadoEn);
      return { datos, descargadoEn, obsoleto: false, origen: 'red' };
    };
    // Caché desactivada (interruptor apagado, sin IndexedDB o sin sesión): como hoy.
    if (!ctx) return desdeRed();

    const registro = await leerVigente(ctx.almacen, claveCompleta(ctx.usuarioId, clave));
    if (registro && !deps.estaOnline()) return servirDeCache<T>(registro, clave, maxEdadMs);

    try {
      let resultado: ResultadoCatalogo<T>;
      if (registro) {
        // Con dato guardado no se espera a la red más de timeoutMs; si la
        // petición termina tarde igual refresca la caché para la próxima vez.
        const pendiente = desdeRed();
        pendiente.catch(() => undefined);
        resultado = await conTimeout(pendiente, timeoutMs);
      } else {
        resultado = await desdeRed();
      }
      deps.alRegistrar?.(clave, null);
      return resultado;
    } catch (err) {
      const degradable = esFalloDegradable(err, deps.esErrorDeRed);
      if (registro && degradable) return servirDeCache<T>(registro, clave, maxEdadMs);
      if (!registro && degradable && !deps.estaOnline()) throw new Error(MENSAJE_SIN_DATOS, { cause: err });
      throw err;
    }
  }

  return {
    obtenerCatalogo<T>(clave: string, cargar: () => Promise<T>, opciones?: { maxEdadMs?: number }) {
      const maxEdadMs = opciones?.maxEdadMs ?? MAX_EDAD_POR_DEFECTO_MS;
      const llave = claveCompleta(deps.usuarioId() ?? '', clave);
      const previo = enVuelo.get(llave);
      if (previo) return previo as Promise<ResultadoCatalogo<T>>;
      const p = resolver<T>(clave, cargar, maxEdadMs).finally(() => { enVuelo.delete(llave); });
      enVuelo.set(llave, p as Promise<ResultadoCatalogo<unknown>>);
      return p;
    },

    async invalidarCatalogo(clave: string) {
      const ctx = contextoActivo();
      if (!ctx) return;
      deps.alRegistrar?.(clave, null);
      try {
        await ctx.almacen.borrar(claveCompleta(ctx.usuarioId, clave));
      } catch {
        // Sin caché utilizable: no hay nada que invalidar.
      }
    },

    async purgarDeOtrosUsuarios(usuarioId: string) {
      if (!deps.almacen) return 0;
      try {
        const ajenos = (await deps.almacen.listar()).filter(r => r.usuarioId !== usuarioId);
        for (const r of ajenos) await deps.almacen.borrar(r.clave);
        return ajenos.length;
      } catch {
        return 0; // Sin caché utilizable: no hay nada que purgar.
      }
    },

    async limpiarCatalogos() {
      try {
        await deps.almacen?.vaciar();
      } catch {
        // Idem.
      }
    },
  };
}
