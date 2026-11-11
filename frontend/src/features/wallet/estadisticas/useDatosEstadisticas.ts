import { useCallback, useEffect, useState } from 'react';
import type { Movimiento } from '@shared/types/index.js';
import { leerGet } from '../../../services/lectura-service';
import { ESPERA_TOTALES_MS } from '../../../lib/offline/lectura-logica';
import { deduplicarPorId } from '../registros/registros-logica';
import { recortarMovimientosGuardados } from './estadisticas-datos';

/** Misma clave que usa Registros: ambas pantallas comparten la copia guardada y la antigüedad que se muestra. */
export const RUTA_MOVIMIENTOS = '/api/cochinito/movimientos';

/** Una vez que algo se pidió, sigue pedido aunque la persona cambie de pestaña (no se vuelve a descargar). */
export function usePedidoPersistente(necesario: boolean): boolean {
  const [pedido, setPedido] = useState(necesario);
  if (necesario && !pedido) setPedido(true);
  return pedido || necesario;
}

export interface EstadoMovimientos {
  movimientos: Movimiento[];
  cargando: boolean;
  /** true solo si la carga falló: distinto de "no hay movimientos". */
  error: boolean;
  recargar: () => void;
}

/** Historial de movimientos de las cuentas visibles. A diferencia de obtenerMovimientos, NO traga el error. Guarda en la caché
 *  el mismo recorte que Registros (con red se ve la respuesta completa) y espera a la red como las listas que se suman. */
export function useMovimientosWallet(habilitado: boolean): EstadoMovimientos {
  const pedido = usePedidoPersistente(habilitado);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!pedido) return undefined;
    let vigente = true;
    leerGet<{ movimientos: Movimiento[] }>(RUTA_MOVIMIENTOS, { recortar: recortarMovimientosGuardados, esperaMs: ESPERA_TOTALES_MS })
      .then(r => { if (vigente) { setMovimientos(deduplicarPorId(r.movimientos)); setError(false); } })
      .catch(() => { if (vigente) setError(true); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [pedido, intento]);

  const recargar = useCallback(() => { setError(false); setCargando(true); setIntento(n => n + 1); }, []);
  return { movimientos, cargando, error, recargar };
}
