import { useCallback, useEffect, useState } from 'react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { obtenerCategoriasCobro } from '../../services/cobro-service';
import { obtenerCategoriasPago } from '../../services/pago-service';
import { opcionesDeCobro, opcionesDePago } from './categoria-cobro';

export interface CategoriasCobro {
  opciones: CategoriaWallet[];
  cargando: boolean;
  /** true si la petición falló: no se sabe qué categorías hay, así que no se debe registrar un cobro con dinero. */
  fallo: boolean;
  reintentar: () => void;
}

/**
 * Carga las categorías entre las que se elige al registrar un cobro. Si no hay ninguna configurada la lista queda
 * vacía y el cobro no pide categoría; si la petición falla, `fallo` es true y la pantalla ofrece reintentar.
 * Con `uso = 'pago'` carga las de un pago a proveedor (egresos): son opcionales, sin elección el servidor usa la fija.
 * `habilitado = false` no hace la petición.
 */
export function useCategoriasCobro(habilitado: boolean, uso: 'cobro' | 'pago' = 'cobro'): CategoriasCobro {
  const [opciones, setOpciones] = useState<CategoriaWallet[]>([]);
  const [cargando, setCargando] = useState(habilitado);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!habilitado) return;
    let cancelado = false;
    setCargando(true);
    setFallo(false);
    (uso === 'pago' ? obtenerCategoriasPago() : obtenerCategoriasCobro())
      .then(r => {
        if (cancelado) return;
        if ('error' in r) { setOpciones([]); setFallo(true); } else setOpciones((uso === 'pago' ? opcionesDePago : opcionesDeCobro)(r.categorias));
      })
      .catch(() => { if (!cancelado) { setOpciones([]); setFallo(true); } })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [habilitado, uso, intento]);

  const reintentar = useCallback(() => setIntento(n => n + 1), []);
  return { opciones, cargando, fallo, reintentar };
}
