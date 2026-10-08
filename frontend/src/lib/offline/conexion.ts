/** Estado de conexión de la app. Combina los eventos online/offline del navegador (rápidos pero con
 *  falsos positivos: wifi sin internet, portal cautivo) con una sonda real HEAD /health y con el
 *  resultado de las propias peticiones (api-client llama a `reportarResultadoRed`). */
import { useSyncExternalStore } from 'react';
import {
  comprobarConexion, crearAlmacenConexion, esErrorDeRed,
  type EstadoConexion, type Sonda,
} from './conexion-logica';

export { esErrorDeRed };
export type { EstadoConexion };

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const URL_SALUD = `${API_URL}/health`;
/** Con red aparente se re-comprueba cada tanto; sin red se reintenta más seguido para recuperarse rápido. */
const INTERVALO_ONLINE_MS = 60_000;
const INTERVALO_OFFLINE_MS = 10_000;

const almacen = crearAlmacenConexion(typeof navigator === 'undefined' ? true : navigator.onLine);
const sondaFetch: Sonda = (url, init) => fetch(url, init);

let temporizador: ReturnType<typeof setTimeout> | null = null;
let iniciado = false;

/** Comprueba de verdad si hay servidor alcanzable y actualiza el estado. */
export async function verificarConexion(): Promise<boolean> {
  const navegadorOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  const ok = navegadorOnline ? await comprobarConexion(URL_SALUD, sondaFetch) : false;
  almacen.fijar(ok);
  return ok;
}

function programarSiguiente(): void {
  if (temporizador) clearTimeout(temporizador);
  const espera = almacen.obtener().online ? INTERVALO_ONLINE_MS : INTERVALO_OFFLINE_MS;
  temporizador = setTimeout(() => { void verificarConexion().finally(programarSiguiente); }, espera);
}

/** Arranca los oyentes una sola vez (idempotente). Se llama al montar la barra de estado. */
export function iniciarMonitorConexion(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  window.addEventListener('offline', () => { almacen.fijar(false); programarSiguiente(); });
  window.addEventListener('online', () => { void verificarConexion().finally(programarSiguiente); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void verificarConexion().finally(programarSiguiente);
  });
  void verificarConexion().finally(programarSiguiente);
}

/** Síncrono: último estado conocido. */
export function estaOnline(): boolean {
  return almacen.obtener().online;
}

/** Lo llama api-client tras cada petición: un fetch fallido por red marca offline al instante, uno
 *  que obtuvo respuesta HTTP marca online. */
export function reportarResultadoRed(huboRespuesta: boolean): void {
  almacen.fijar(huboRespuesta);
  if (iniciado) programarSiguiente();
}

/** Suscripción para código que no es React (p. ej. el motor de sincronización o revalidar sesión). */
export function suscribirConexion(oyente: (e: EstadoConexion) => void): () => void {
  return almacen.suscribir(() => oyente(almacen.obtener()));
}

export function useEstadoConexion(): { online: boolean; desde: number } {
  return useSyncExternalStore(almacen.suscribir, almacen.obtener, almacen.obtener);
}
