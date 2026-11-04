import { useCallback, useSyncExternalStore } from 'react';

/** true cuando la media query coincide. Se actualiza al cambiar el ancho. Sin `window` (SSR/pruebas) devuelve `valorServidor`. */
export function useMediaQuery(consulta: string, valorServidor = false): boolean {
  const suscribir = useCallback((aviso: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const lista = window.matchMedia(consulta);
    lista.addEventListener('change', aviso);
    return () => lista.removeEventListener('change', aviso);
  }, [consulta]);
  const leer = useCallback(
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(consulta).matches : valorServidor),
    [consulta, valorServidor],
  );
  return useSyncExternalStore(suscribir, leer, () => valorServidor);
}
