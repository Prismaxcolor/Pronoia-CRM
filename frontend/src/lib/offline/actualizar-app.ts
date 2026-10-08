/** Procedimiento de actualización forzosa SIN pérdida de datos.
 *
 *  Escalera: (a) service worker en espera -> SKIP_WAITING; (b) buscar uno nuevo
 *  ~8 s; (c) si el SW está atascado -> restablecimiento SUAVE (desregistrar
 *  service workers + borrar Cache Storage) y recarga con cache-busting.
 *
 *  GARANTÍA: este archivo NO toca IndexedDB, localStorage ni los datos de
 *  sessionStorage (cola de pesajes, borradores, sesión local, PIN). Solo el
 *  contador anti-bucle usa una clave propia. Una prueba lo vigila. */

export const ESPERA_SW_NUEVO_MS = 8000;
export const ESPERA_ACTIVACION_MS = 5000;
export const MAX_INTENTOS_POR_SESION = 2;
export const CLAVE_INTENTOS = 'pronoia_actualizacion_intentos';
export const PARAM_BUSTING = '_act';

export type ViaActualizacion = 'activado' | 'restablecido' | 'recarga-simple' | 'sin-conexion';

export interface DepsEscalera {
  hayEsperando: () => Promise<boolean>;
  /** Envía SKIP_WAITING y espera a que el nuevo SW tome el control; false si no ocurre a tiempo. */
  activarEsperando: () => Promise<boolean>;
  buscarActualizacion: () => Promise<void>;
  /** Sondea hasta `ms` a que aparezca un SW en espera. */
  esperarEsperando: (ms: number) => Promise<boolean>;
  restablecer: () => Promise<void>;
  /** Conexión CONFIRMADA hace un momento (sonda real al servidor, no solo navigator.onLine). El restablecimiento
   *  suave borra la caché de la app: si la red cae justo después, la app no abriría. */
  conexionConfirmada: () => Promise<boolean>;
  recargar: (conBusting: boolean) => void;
}

async function viaServiceWorker(d: DepsEscalera): Promise<boolean> {
  try {
    if (!(await d.hayEsperando())) {
      await d.buscarActualizacion();
      if (!(await d.esperarEsperando(ESPERA_SW_NUEVO_MS))) return false;
    }
    return await d.activarEsperando();
  } catch {
    return false;
  }
}

export async function ejecutarEscalera(d: DepsEscalera): Promise<ViaActualizacion> {
  if (await viaServiceWorker(d)) {
    d.recargar(false);
    return 'activado';
  }
  // Sin conexión confirmada NO se desregistra el service worker ni se borra la caché: la app seguiría abriendo.
  const hayRed = await d.conexionConfirmada().catch(() => false);
  if (!hayRed) return 'sin-conexion';
  try {
    await d.restablecer();
    d.recargar(true);
    return 'restablecido';
  } catch {
    d.recargar(false);
    return 'recarga-simple';
  }
}

// ---- Restablecimiento suave -------------------------------------------------

export interface DepsRestablecer {
  registros: () => Promise<ReadonlyArray<{ unregister: () => Promise<boolean> }>>;
  cachesApi: { keys: () => Promise<string[]>; delete: (nombre: string) => Promise<boolean> } | null;
}

export interface ResumenRestablecimiento {
  registrosQuitados: number;
  cachesBorradas: number;
}

/** Desregistra los service workers y borra SOLO Cache Storage. Cada paso tolera fallos. */
export async function restablecimientoSuave(d: DepsRestablecer): Promise<ResumenRestablecimiento> {
  let registrosQuitados = 0;
  let cachesBorradas = 0;
  try {
    for (const r of await d.registros()) {
      try { if (await r.unregister()) registrosQuitados++; } catch { /* siguiente */ }
    }
  } catch { /* sin API de service workers */ }
  if (d.cachesApi) {
    try {
      for (const nombre of await d.cachesApi.keys()) {
        try { if (await d.cachesApi.delete(nombre)) cachesBorradas++; } catch { /* siguiente */ }
      }
    } catch { /* sin acceso a cachés */ }
  }
  return { registrosQuitados, cachesBorradas };
}

// ---- Anti-bucle -------------------------------------------------------------

export interface AlmacenIntentos {
  getItem: (clave: string) => string | null;
  setItem: (clave: string, valor: string) => void;
}

interface RegistroIntentos { n: number; t: number }

export function leerIntentos(almacen: AlmacenIntentos | null): RegistroIntentos {
  try {
    const crudo = almacen?.getItem(CLAVE_INTENTOS);
    if (!crudo) return { n: 0, t: 0 };
    const r = JSON.parse(crudo) as Partial<RegistroIntentos>;
    return { n: Number.isFinite(r.n) ? Number(r.n) : 0, t: Number.isFinite(r.t) ? Number(r.t) : 0 };
  } catch {
    return { n: 0, t: 0 };
  }
}

/** ¿Se puede intentar otra vez? Lo automático para tras 2 intentos por sesión; un toque del usuario siempre puede. */
export function puedeIntentar(almacen: AlmacenIntentos | null, manual: boolean): boolean {
  return manual || leerIntentos(almacen).n < MAX_INTENTOS_POR_SESION;
}

/** Anota el intento ANTES de recargar. Un toque manual reinicia la cuenta. */
export function registrarIntento(almacen: AlmacenIntentos | null, ahora: number, manual: boolean): void {
  try {
    const n = manual ? 1 : leerIntentos(almacen).n + 1;
    almacen?.setItem(CLAVE_INTENTOS, JSON.stringify({ n, t: ahora }));
  } catch { /* sin almacenamiento: se degrada sin anti-bucle */ }
}

/** Intento completo con anti-bucle. 'bloqueado' = ya se intentó el máximo en esta sesión. */
export async function actualizarConProteccion(
  d: DepsEscalera,
  almacen: AlmacenIntentos | null,
  ahora: () => number,
  manual: boolean,
): Promise<ViaActualizacion | 'bloqueado'> {
  if (!puedeIntentar(almacen, manual)) return 'bloqueado';
  registrarIntento(almacen, ahora(), manual);
  return ejecutarEscalera(d);
}

/** Aplazar "Más tarde": 1 hora. */
export const APLAZO_MS = 60 * 60 * 1000;
export function estaAplazado(hasta: number, ahora: number): boolean {
  return ahora < hasta;
}

/** URL de recarga con parámetro anti-caché. */
export function urlConBusting(href: string, ahora: number): string {
  const u = new URL(href);
  u.searchParams.set(PARAM_BUSTING, String(ahora));
  return u.toString();
}

/** Quita el parámetro anti-caché de la URL visible tras la recarga (null si no estaba). */
export function urlSinBusting(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has(PARAM_BUSTING)) return null;
  u.searchParams.delete(PARAM_BUSTING);
  return u.toString();
}
