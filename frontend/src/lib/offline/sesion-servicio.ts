/** Servicio de sesión local y PIN con dependencias inyectadas (sin api-client ni IndexedDB real: probable en node). */
import type { Usuario } from '@shared/types/index.js';
import type { AlmacenKV } from './almacen-kv';
import {
  crearRegistroPin, esRegistroPinValido, verificarPin,
  type DependenciasPin, type RegistroPin, type ResultadoPin,
} from './pin-logica';
import {
  VERSION_SESION, decodificarExpiracion, esSesionLocalValida, evaluarVigencia, resolverOfflineActivo,
  type SesionLocal, type Vigencia,
} from './sesion-logica';

const CLAVE_SESION = 'sesion';
const CLAVE_PIN = 'pin';

export type SesionOffline = SesionLocal<Usuario>;

/** Se agotaron los intentos del PIN: la sesión local ya se borró y hay que iniciar sesión en línea. */
export class PinAgotadoError extends Error {
  constructor() {
    super('Demasiados intentos fallidos del PIN. Por seguridad se cerró la sesión: inicia sesión con internet.');
    this.name = 'PinAgotadoError';
  }
}

export interface OpcionesGuardado {
  /** Valor del interruptor del servidor; si se omite se conserva el último conocido DEL MISMO usuario (o false). */
  offlineActivo?: boolean;
  desfaseRelojMs?: number;
  /** true = el usuario marcó "Recordarme": la sesión (con su token) puede guardarse en IndexedDB.
   *  false (por defecto) = el token NO se escribe en IndexedDB; la sesión local vive solo en sessionStorage. */
  recordar?: boolean;
}

export interface ServicioSesion {
  guardar(usuario: Usuario, token: string, opciones?: OpcionesGuardado): Promise<boolean>;
  leer(): Promise<SesionOffline | null>;
  limpiar(): Promise<void>;
  vigente(): boolean;
  evaluar(): Vigencia;
  habilitado(): boolean;
  actualizarInterruptor(activo: boolean): Promise<void>;
  pinConfigurado(): Promise<boolean>;
  /** Si ya hay un PIN, exige `pinActual` correcto (cuenta como intento). */
  configurarPin(pin: string, usuarioId: string, pinActual?: string): Promise<void>;
  validarPin(pin: string): Promise<ResultadoPin | null>;
  leerPin(): Promise<RegistroPin | null>;
  /** Exige `pinActual` correcto cuando hay un PIN configurado. */
  quitarPin(pinActual?: string): Promise<void>;
}

export interface DependenciasServicio {
  /** Persistente (IndexedDB): solo guarda sesiones de quien marcó "Recordarme", y el PIN. */
  kv: AlmacenKV;
  /** Solo de la pestaña (sessionStorage): sesión local de quien NO marcó "Recordarme". Sin él, esa sesión solo vive en memoria. */
  kvSesion?: AlmacenKV;
  /** Se invoca cuando entra un usuario distinto al de la sesión previa (limpiar caché de lecturas, etc.). */
  alCambiarUsuario?: () => Promise<void>;
  /** Se invoca al iniciar o restaurar la sesión de un usuario (una vez por usuario): purga la caché de los demás. Nunca bloquea. */
  alIniciarSesion?: (usuarioId: string) => Promise<void>;
  ahora: () => number;
  leerToken: () => string | null;
  pin: DependenciasPin;
}

/** Fábrica con dependencias inyectadas (las pruebas usan almacén en memoria y reloj falso). */
export function crearServicioSesion(deps: DependenciasServicio): ServicioSesion {
  // Copia en memoria: permite consultar la vigencia de forma síncrona tras el arranque.
  let cache: SesionOffline | null = null;
  // Dónde vive la sesión actual: IndexedDB (Recordarme) o solo la pestaña.
  let enIndexedDB = false;
  let purgadoPara: string | null = null;

  const purgarCacheAjena = async (usuarioId: string): Promise<void> => {
    if (purgadoPara === usuarioId) return;
    try {
      await deps.alIniciarSesion?.(usuarioId);
      purgadoPara = usuarioId;
    } catch {
      // La purga es una mejora de privacidad: si falla se reintenta en la próxima ocasión.
    }
  };

  const leerPersistida = async (): Promise<SesionOffline | null> => {
    const deSesion = deps.kvSesion ? await deps.kvSesion.leer(CLAVE_SESION) : null;
    if (esSesionLocalValida(deSesion)) {
      enIndexedDB = false;
      return deSesion as SesionOffline;
    }
    const valor = await deps.kv.leer(CLAVE_SESION);
    if (!esSesionLocalValida(valor)) return null;
    enIndexedDB = true;
    return valor as SesionOffline;
  };

  const escribir = async (sesion: SesionOffline): Promise<boolean> => {
    cache = sesion;
    if (enIndexedDB) {
      await deps.kvSesion?.borrar(CLAVE_SESION);
      return deps.kv.escribir(CLAVE_SESION, sesion);
    }
    // Sin "Recordarme": el token jamás llega a IndexedDB (y se borra cualquier sesión anterior de ahí).
    await deps.kv.borrar(CLAVE_SESION);
    return deps.kvSesion ? deps.kvSesion.escribir(CLAVE_SESION, sesion) : false;
  };

  const leerPin = async (): Promise<RegistroPin | null> => {
    const valor = await deps.kv.leer(CLAVE_PIN);
    return esRegistroPinValido(valor) ? valor : null;
  };

  const validarSinCandado = async (pin: string): Promise<ResultadoPin | null> => {
    const registro = await leerPin();
    if (!registro) return null;
    const resultado = await verificarPin(registro, pin, deps.pin);
    if (!resultado.ok && resultado.motivo === 'agotado') {
      // Demasiados bloqueos acumulados: se borra la sesión local y el PIN (la cola y los borradores no se tocan).
      await limpiarTodo();
      return resultado;
    }
    // Se persiste ANTES de devolver: recargar la página no reinicia el conteo de intentos.
    await deps.kv.escribir(CLAVE_PIN, resultado.registro);
    return resultado;
  };

  // Candado en memoria: dos validaciones en paralelo (doble toque) leerían el mismo registro y se saltarían el conteo de intentos.
  let candado: Promise<unknown> = Promise.resolve();
  const validar = (pin: string): Promise<ResultadoPin | null> => {
    const turno = candado.then(() => validarSinCandado(pin));
    candado = turno.catch(() => undefined);
    return turno;
  };

  /** Si ya hay PIN, comprueba el actual o lanza un error con el mensaje para el usuario. */
  const exigirPinActual = async (pinActual: string | undefined): Promise<void> => {
    if (!(await leerPin())) return;
    if (!pinActual) throw new Error('Escribe tu PIN actual para continuar.');
    const r = await validar(pinActual);
    if (r === null || r.ok) return;
    if (r.motivo === 'agotado') throw new PinAgotadoError();
    if (r.motivo === 'bloqueado') throw new Error('Demasiados intentos. Espera para volver a intentar.');
    throw new Error(`PIN actual incorrecto. Te quedan ${r.intentosRestantes} intento${r.intentosRestantes === 1 ? '' : 's'}.`);
  };

  const limpiarTodo = async (): Promise<void> => {
    cache = null;
    await deps.kv.borrar(CLAVE_SESION);
    await deps.kvSesion?.borrar(CLAVE_SESION);
    // El PIN pertenece a la sesión: se borra con ella.
    await deps.kv.borrar(CLAVE_PIN);
  };

  return {
    async guardar(usuario, token, opciones = {}) {
      const previa = cache ?? await leerPersistida();
      const mismoUsuario = previa !== null && previa.usuario.id === usuario.id;
      // Otro usuario en el mismo equipo: el PIN del anterior no le sirve y su caché de lecturas se purga.
      if (previa && !mismoUsuario) {
        await deps.kv.borrar(CLAVE_PIN);
        await deps.alCambiarUsuario?.();
      }
      enIndexedDB = opciones.recordar === true;
      const sesion: SesionOffline = {
        v: VERSION_SESION,
        usuario,
        token,
        expiraEn: decodificarExpiracion(token),
        ultimaVerificacion: deps.ahora(),
        offlineActivo: resolverOfflineActivo(opciones.offlineActivo, previa, usuario.id),
        desfaseRelojMs: opciones.desfaseRelojMs ?? (mismoUsuario ? previa.desfaseRelojMs : undefined),
        pinActivo: mismoUsuario ? previa.pinActivo : undefined,
      };
      await purgarCacheAjena(usuario.id);
      return escribir(sesion);
    },

    async leer() {
      cache = await leerPersistida();
      if (cache) await purgarCacheAjena(cache.usuario.id);
      return cache;
    },

    limpiar: limpiarTodo,

    evaluar: () => evaluarVigencia(cache, deps.ahora(), deps.leerToken()),
    vigente: () => evaluarVigencia(cache, deps.ahora(), deps.leerToken()).vigente,
    habilitado: () => cache?.offlineActivo ?? false,

    async actualizarInterruptor(activo) {
      if (cache && cache.offlineActivo !== activo) await escribir({ ...cache, offlineActivo: activo });
    },

    async pinConfigurado() {
      if ((await leerPin()) !== null) return true;
      // Sin registro pero la sesión dice que había PIN: se trata como configurado (el desbloqueo queda cerrado).
      return (cache ?? await leerPersistida())?.pinActivo === true;
    },

    async configurarPin(pin, usuarioId, pinActual) {
      await exigirPinActual(pinActual);
      const registro = await crearRegistroPin(pin, usuarioId, deps.pin);
      if (!(await deps.kv.escribir(CLAVE_PIN, registro))) {
        throw new Error('No se pudo guardar el PIN en este equipo.');
      }
      if (cache) await escribir({ ...cache, pinActivo: true });
    },

    leerPin,

    validarPin: validar,

    async quitarPin(pinActual) {
      await exigirPinActual(pinActual);
      await deps.kv.borrar(CLAVE_PIN);
      if (cache) await escribir({ ...cache, pinActivo: false });
    },
  };
}

