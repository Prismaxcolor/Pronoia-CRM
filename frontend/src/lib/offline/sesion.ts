/** Sesión local persistente (IndexedDB) para poder abrir la app sin red, y PIN de desbloqueo opcional.
 *  Todo con degradación segura: si IndexedDB falla, la app se comporta como antes (sin modo offline). */
import { getToken } from '../../services/api-client';
import { crearAlmacenKvIndexedDB, crearAlmacenKvMemoria, crearAlmacenKvSessionStorage } from './almacen-kv';
import { dependenciasPinPorDefecto } from './pin-logica';
import { crearServicioSesion, type ServicioSesion, type SesionOffline } from './sesion-servicio';
import type { Vigencia } from './sesion-logica';

export type { SesionOffline };
export { PinAgotadoError } from './sesion-servicio';

let servicioCompartido: ServicioSesion | null = null;
let alCambiarUsuario: (() => Promise<void>) | null = null;
let alIniciarSesion: ((usuarioId: string) => Promise<void>) | null = null;

/** Registra qué hacer cuando entra un usuario distinto al de la sesión previa (purgar la caché de lecturas). */
export function registrarAlCambiarUsuario(accion: () => Promise<void>): void {
  alCambiarUsuario = accion;
}

/** Registra qué hacer al iniciar o restaurar la sesión de un usuario (purgar la caché de otros usuarios). */
export function registrarAlIniciarSesion(accion: (usuarioId: string) => Promise<void>): void {
  alIniciarSesion = accion;
}

function servicio(): ServicioSesion {
  if (!servicioCompartido) {
    servicioCompartido = crearServicioSesion({
      kv: crearAlmacenKvIndexedDB() ?? crearAlmacenKvMemoria(),
      kvSesion: crearAlmacenKvSessionStorage() ?? undefined,
      alCambiarUsuario: async () => { await alCambiarUsuario?.(); },
      alIniciarSesion: async id => { await alIniciarSesion?.(id); },
      ahora: Date.now,
      leerToken: getToken,
      pin: dependenciasPinPorDefecto(),
    });
  }
  return servicioCompartido;
}

export const guardarSesionOffline: ServicioSesion['guardar'] = (u, t, o) => servicio().guardar(u, t, o);
export const leerSesionOffline: ServicioSesion['leer'] = () => servicio().leer();
export const limpiarSesionOffline: ServicioSesion['limpiar'] = () => servicio().limpiar();
/** Síncrono: válido tras haber llamado a `leerSesionOffline()` o `guardarSesionOffline()` (la app lo hace al arrancar). */
export function sesionOfflineVigente(): boolean { return servicio().vigente(); }
export function evaluarSesionOffline(): Vigencia { return servicio().evaluar(); }
/** Último valor conocido del interruptor OFFLINE_ACTIVO; false mientras no haya sesión guardada. */
export function offlineHabilitado(): boolean { return servicio().habilitado(); }
export const actualizarInterruptorOffline: ServicioSesion['actualizarInterruptor'] = a => servicio().actualizarInterruptor(a);
export const pinOfflineConfigurado: ServicioSesion['pinConfigurado'] = () => servicio().pinConfigurado();
export const configurarPinOffline: ServicioSesion['configurarPin'] = (p, u) => servicio().configurarPin(p, u);
export const validarPinOffline: ServicioSesion['validarPin'] = p => servicio().validarPin(p);
export const leerPinOffline: ServicioSesion['leerPin'] = () => servicio().leerPin();
export const quitarPinOffline: ServicioSesion['quitarPin'] = () => servicio().quitarPin();
