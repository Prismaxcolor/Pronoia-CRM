import { useCallback, useMemo, useState } from 'react';
import type { Banca } from '@shared/types/index.js';
import { claveOrdenBancas, leerOrdenGuardado, moverEnOrden, ordenarBancas } from './orden-bancas';

function leer(usuarioId: string | undefined): string[] {
  if (!usuarioId) return [];
  try { return leerOrdenGuardado(window.localStorage.getItem(claveOrdenBancas(usuarioId))); } catch { return []; }
}

function guardar(usuarioId: string | undefined, orden: readonly string[]): void {
  if (!usuarioId) return;
  try { window.localStorage.setItem(claveOrdenBancas(usuarioId), JSON.stringify(orden)); } catch { /* sin almacenamiento: el orden vale solo en esta sesión */ }
}

/** Orden personal de las bancas (por usuario, recordado en este navegador). `mover` desplaza una banca antes o después. */
export function useOrdenBancas(usuarioId: string | undefined, bancas: readonly Banca[]) {
  const [guardado, setGuardado] = useState<{ usuarioId: string | undefined; orden: string[] }>(() => ({ usuarioId, orden: leer(usuarioId) }));
  // Si cambia la persona con sesión, se relee su orden.
  // La relectura de localStorage se memoriza por usuario: no se repite en cada render mientras el estado no se actualice.
  const ordenLeido = useMemo(() => (guardado.usuarioId === usuarioId ? null : leer(usuarioId)), [guardado.usuarioId, usuarioId]);
  const orden = ordenLeido ?? guardado.orden;
  const ordenadas = useMemo(() => ordenarBancas(bancas, orden), [bancas, orden]);

  const mover = useCallback((id: string, desplazamiento: number) => {
    const actuales = ordenarBancas(bancas, orden).map(b => b.id);
    const nuevo = moverEnOrden(actuales, id, desplazamiento);
    guardar(usuarioId, nuevo);
    setGuardado({ usuarioId, orden: nuevo });
  }, [bancas, orden, usuarioId]);

  const restablecer = useCallback(() => {
    guardar(usuarioId, []);
    setGuardado({ usuarioId, orden: [] });
  }, [usuarioId]);

  return { ordenadas, mover, restablecer, personalizado: orden.length > 0 };
}
