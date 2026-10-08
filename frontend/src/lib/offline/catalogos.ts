/** Catálogos en el teléfono (modo sin conexión, fase 2): API pública.
 *  La lógica vive en catalogos-nucleo.ts (pura y probada); aquí solo se
 *  conecta con el navegador (IndexedDB, token, red) y con React. */
import { useSyncExternalStore } from 'react';
import { getToken } from '../../services/api-client';
import type { Recurso } from '@shared/types/index.js';
import { almacenCatalogosDelNavegador } from './catalogos-idb';
import { esErrorDeRed, estaOnline } from './conexion';
import { offlineHabilitado } from './sesion';
import {
  crearGestorCatalogos,
  usuarioIdDeToken,
  type MetaAntiguedad,
  type ResultadoCatalogo,
} from './catalogos-nucleo';

export type { ResultadoCatalogo } from './catalogos-nucleo';

// Interruptor OFFLINE_ACTIVO (F0/1): apagado = no se cachea ni se sirven datos viejos.
const offlineActivo = (): boolean => offlineHabilitado();

// --- Antigüedad observable (para EtiquetaAntiguedad) -----------------------

const SIN_DATOS: MetaAntiguedad | null = null;
let metas: ReadonlyMap<string, MetaAntiguedad> = new Map();
const oyentes = new Set<() => void>();

function registrarMeta(clave: string, meta: MetaAntiguedad | null): void {
  const actual = metas.get(clave) ?? null;
  if (actual === meta || (actual && meta && actual.descargadoEn === meta.descargadoEn && actual.obsoleto === meta.obsoleto)) return;
  const siguiente = new Map(metas);
  if (meta) siguiente.set(clave, meta); else siguiente.delete(clave);
  metas = siguiente;
  oyentes.forEach(o => o());
  oyentesMeta.forEach(o => o(clave, meta));
}

const oyentesMeta = new Set<(clave: string, meta: MetaAntiguedad | null) => void>();

/** (F5) Notifica cada cambio de antigüedad de una clave: lo usa lectura.ts para el banner y el pie de documentos. */
export function suscribirMetas(oyente: (clave: string, meta: MetaAntiguedad | null) => void): () => void {
  oyentesMeta.add(oyente);
  return () => { oyentesMeta.delete(oyente); };
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/** Antigüedad del dato que la pantalla muestra desde el caché. `descargadoEn`
 *  es null cuando el dato viene fresco de la red (no hay nada que avisar). */
export function useAntiguedad(clave: string): { descargadoEn: number | null; obsoleto: boolean } {
  const meta = useSyncExternalStore(suscribir, () => metas.get(clave) ?? SIN_DATOS, () => SIN_DATOS);
  return meta ?? { descargadoEn: null, obsoleto: false };
}

/** Claves cuyo dato en pantalla está obsoleto (>48 h): alimenta el banner global. */
export function useHayDatosObsoletos(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => hayObsoletos(metas),
    () => false,
  );
}

function hayObsoletos(m: ReadonlyMap<string, MetaAntiguedad>): boolean {
  for (const meta of m.values()) if (meta.obsoleto) return true;
  return false;
}

// --- Gestor ----------------------------------------------------------------

const gestor = crearGestorCatalogos({
  almacen: almacenCatalogosDelNavegador(),
  ahora: () => Date.now(),
  usuarioId: () => usuarioIdDeToken(getToken()),
  offlineActivo,
  estaOnline,
  esErrorDeRed: err => esErrorDeRed(err),
  alRegistrar: registrarMeta,
});

let persistenciaSolicitada = false;
/** Pide a Chrome/Safari que no purgue el almacenamiento; una sola vez por carga. */
function solicitarPersistencia(): void {
  if (persistenciaSolicitada) return;
  persistenciaSolicitada = true;
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // Sin API de almacenamiento persistente: no pasa nada.
  }
}

export function obtenerCatalogo<T>(
  clave: string,
  cargar: () => Promise<T>,
  opciones?: { maxEdadMs?: number },
): Promise<ResultadoCatalogo<T>> {
  solicitarPersistencia();
  return gestor.obtenerCatalogo(clave, cargar, opciones);
}

export function invalidarCatalogo(clave: string): Promise<void> {
  return gestor.invalidarCatalogo(clave);
}

/** Vaciar la caché de catálogos: SOLO al cerrar sesión de verdad y con confirmación. */
export async function limpiarCatalogos(): Promise<void> {
  await gestor.limpiarCatalogos();
  metas = new Map();
  oyentes.forEach(o => o());
}

/** Borra de IndexedDB los catálogos y lecturas de cualquier usuario distinto al indicado (al iniciar o restaurar sesión). */
export function purgarCatalogosDeOtrosUsuarios(usuarioId: string): Promise<number> {
  return gestor.purgarDeOtrosUsuarios(usuarioId);
}

/** Descarga en segundo plano los catálogos que el usuario puede ver. Nunca
 *  lanza ni bloquea: cada catálogo falla por separado y en silencio (la
 *  pantalla que lo necesite lo pedirá y mostrará su propio error). */
export async function precargarCatalogos(
  puedeVer?: (recurso: Recurso) => boolean,
): Promise<void> {
  if (!offlineActivo() || !estaOnline() || !usuarioIdDeToken(getToken())) return;
  try {
    const { catalogosPrecargables } = await import('./precarga-lista');
    const permitidos = catalogosPrecargables.filter(c => !puedeVer || puedeVer(c.recurso));
    await Promise.allSettled(permitidos.map(c => c.cargar()));
  } catch {
    // Precarga es una mejora: cualquier falla deja la app como estaba.
  }
}
