import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { obtenerCategorias } from '../../../services/categoria-wallet-service';
import { indicePorId } from './categorias-logica';

export interface EstadoCategorias {
  categorias: CategoriaWallet[];
  indice: ReadonlyMap<string, CategoriaWallet>;
  cargando: boolean;
  /** Mensaje si no se pudieron cargar (p. ej. migración pendiente). El Wallet sigue funcionando sin categorías. */
  error: string | null;
  recargar: () => void;
}

/** Carga las categorías una vez. Si falla, queda la lista vacía y el error: ninguna pantalla del Wallet depende de ellas. */
export function useCategorias(): EstadoCategorias {
  const [categorias, setCategorias] = useState<CategoriaWallet[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelado = false;
    obtenerCategorias().then(r => {
      if (cancelado) return;
      if ('error' in r) { setCategorias([]); setError(r.error); } else { setCategorias(r.categorias); setError(null); }
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, [version]);

  const recargar = useCallback(() => setVersion(v => v + 1), []);
  const indice = useMemo(() => indicePorId(categorias), [categorias]);
  return { categorias, indice, cargando, error, recargar };
}
