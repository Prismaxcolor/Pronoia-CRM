import { useEffect, useSyncExternalStore } from 'react';

/**
 * Estado "minimizado" de los cuadros informativos (<Bloque/>) de cada pantalla, recordado en este navegador.
 * Cada bloque se identifica por "ruta sin ids|id o título". Un store mínimo permite además minimizar o expandir todos los
 * bloques de la pantalla con un solo botón (ver ControlColapsarTodo).
 */
const PREFIJO_ALMACEN = 'pronoia.bloque-minimizado.';

const oyentes = new Set<() => void>();
const valores = new Map<string, boolean>();
const registrados = new Map<string, number>();

const avisar = (): void => oyentes.forEach(o => o());
const suscribir = (o: () => void): (() => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };

/** Ruta actual (sin consulta) para separar el estado de cada pantalla. */
export const rutaActual = (): string => (typeof window === 'undefined' ? '' : window.location.pathname);

const SEGMENTO_ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Ruta sin ids: los segmentos numéricos o uuid pasan a ':id' para que el estado valga para todo el tipo de pantalla. */
const rutaNormalizada = (): string => rutaActual().split('/').map(seg => (SEGMENTO_ID.test(seg) ? ':id' : seg)).join('/');

/** Clave estable del bloque: `id` explícito si existe; si no, el título sin el contador final "(5)". */
export const claveDeBloque = (titulo: string, id?: string): string =>
  `${rutaNormalizada()}|${id ?? titulo.replace(/\s*\(\d+\)\s*$/, '').trim()}`;

function leerGuardado(clave: string): boolean {
  try { return window.localStorage.getItem(PREFIJO_ALMACEN + clave) === '1'; } catch { return false; }
}

function guardar(clave: string, minimizado: boolean): void {
  try {
    if (minimizado) window.localStorage.setItem(PREFIJO_ALMACEN + clave, '1');
    else window.localStorage.removeItem(PREFIJO_ALMACEN + clave);
  } catch { /* sin almacenamiento (modo privado): el estado vive solo en esta sesión */ }
}

export function estaMinimizado(clave: string): boolean {
  const cache = valores.get(clave);
  if (cache !== undefined) return cache;
  const guardado = leerGuardado(clave);
  valores.set(clave, guardado);
  return guardado;
}

export function establecerMinimizado(clave: string, minimizado: boolean): void {
  if (estaMinimizado(clave) === minimizado) return;
  valores.set(clave, minimizado);
  guardar(clave, minimizado);
  avisar();
}

const clavesDeLaPantalla = (): string[] => {
  const prefijo = `${rutaNormalizada()}|`;
  return [...registrados.keys()].filter(k => k.startsWith(prefijo));
};

/** Estado minimizado de un bloque + su registro en la pantalla (para el botón "Minimizar todo"). */
export function useBloqueMinimizado(clave: string): [boolean, (v: boolean) => void] {
  const minimizado = useSyncExternalStore(suscribir, () => estaMinimizado(clave), () => false);
  useEffect(() => {
    registrados.set(clave, (registrados.get(clave) ?? 0) + 1);
    avisar();
    return () => {
      const n = (registrados.get(clave) ?? 1) - 1;
      if (n <= 0) registrados.delete(clave); else registrados.set(clave, n);
      avisar();
    };
  }, [clave]);
  return [minimizado, v => establecerMinimizado(clave, v)];
}

/** "cantidad:todosMinimizados" de la pantalla actual (texto: así el snapshot es estable por valor). */
const resumenPantalla = (): string => {
  const claves = clavesDeLaPantalla();
  return `${claves.length}:${claves.length > 0 && claves.every(estaMinimizado) ? 1 : 0}`;
};

/** Cuántos bloques tiene la pantalla y si todos están minimizados; `alternarTodos` minimiza o expande todos a la vez. */
export function useResumenBloques(): { cantidad: number; todosMinimizados: boolean; alternarTodos: () => void } {
  const [cantidad, todos] = useSyncExternalStore(suscribir, resumenPantalla, () => '0:0').split(':');
  const todosMinimizados = todos === '1';
  return {
    cantidad: Number(cantidad),
    todosMinimizados,
    alternarTodos: () => clavesDeLaPantalla().forEach(k => establecerMinimizado(k, !todosMinimizados)),
  };
}
