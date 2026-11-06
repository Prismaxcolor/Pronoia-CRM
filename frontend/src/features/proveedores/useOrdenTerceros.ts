import { useCallback, useMemo, useState } from 'react';
import type { TipoTercero } from '../../lib/terceros-kpis';
import { leerOrdenGuardado, moverEnOrden, ordenarBancas } from '../cochinito/orden-bancas';

/** Clave de almacenamiento: una por persona y por tipo, para que proveedores y clientes (y dos usuarios del mismo equipo) no se pisen. */
export const claveOrdenTerceros = (tipo: TipoTercero, usuarioId: string): string => `pronoia:orden-terceros:${tipo}:${usuarioId}`;

function leer(clave: string | null): string[] {
  if (!clave) return [];
  try { return leerOrdenGuardado(window.localStorage.getItem(clave)); } catch { return []; }
}

function guardar(clave: string | null, orden: readonly string[]): void {
  if (!clave) return;
  try { window.localStorage.setItem(clave, JSON.stringify(orden)); } catch { /* sin almacenamiento: el orden vale solo en esta sesión */ }
}

/**
 * Orden personal de proveedores o clientes (por usuario, recordado en este navegador), igual que el de las bancas.
 * `mover(id, vecinoId)` deja `id` en el lugar de `vecinoId`: con filtros activos el vecino es el que se VE al lado, no uno oculto.
 */
export function useOrdenTerceros<T extends { id: string }>(tipo: TipoTercero, usuarioId: string | undefined, filas: readonly T[]) {
  const clave = usuarioId ? claveOrdenTerceros(tipo, usuarioId) : null;
  const [guardado, setGuardado] = useState<{ clave: string | null; orden: string[] }>(() => ({ clave, orden: leer(clave) }));
  // Si cambia la persona con sesión (o el tipo), se relee su orden; mientras no cambie la clave se usa el estado.
  const orden = useMemo(() => (guardado.clave === clave ? guardado.orden : leer(clave)), [guardado, clave]);
  const ordenadas = useMemo(() => ordenarBancas(filas, orden), [filas, orden]);

  const mover = useCallback((id: string, vecinoId: string) => {
    const ids = ordenarBancas(filas, orden).map(f => f.id);
    const desde = ids.indexOf(id);
    const hasta = ids.indexOf(vecinoId);
    if (desde === -1 || hasta === -1 || desde === hasta) return;
    const nuevo = moverEnOrden(ids, id, hasta - desde);
    guardar(clave, nuevo);
    setGuardado({ clave, orden: nuevo });
  }, [filas, orden, clave]);

  const restablecer = useCallback(() => {
    guardar(clave, []);
    setGuardado({ clave, orden: [] });
  }, [clave]);

  return { ordenadas, mover, restablecer, personalizado: orden.length > 0 };
}
