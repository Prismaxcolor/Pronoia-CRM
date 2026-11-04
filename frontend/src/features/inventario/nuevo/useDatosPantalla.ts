import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { filtrosAUrl, filtrosDesdeUrl, type FiltrosPantalla } from '../../../lib/inventario-nuevo';
import type { Resultado } from '../../../services/inventario-pantalla-service';

interface Estado<T> {
  /** Clave de los parámetros con los que se pidió el dato guardado. */
  clave: string | null;
  dato: T | null;
  error: string | null;
}

/** Pide un dato cuando cambia `clave` (parámetros del servidor). Mientras llega lo nuevo, conserva lo anterior
 *  (`actualizando`), para que el bloque no parpadee a skeleton con cada filtro. `recargar` repite la petición. */
export function useDatosPantalla<T>(clave: string, cargar: () => Promise<Resultado<T>>) {
  const [estado, setEstado] = useState<Estado<T>>({ clave: null, dato: null, error: null });
  const [version, setVersion] = useState(0);
  const claveCompleta = `${clave}#${version}`;

  useEffect(() => {
    let cancelado = false;
    cargar().then(r => {
      if (cancelado) return;
      setEstado(prev => 'error' in r ? { clave: claveCompleta, dato: prev.dato, error: r.error } : { clave: claveCompleta, dato: r.dato, error: null });
    });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la petición depende solo de la clave (los parámetros ya van dentro).
  }, [claveCompleta]);

  const recargar = useCallback(() => setVersion(v => v + 1), []);
  return { dato: estado.dato, error: estado.error, actualizando: estado.clave !== claveCompleta, recargar };
}

/** Cambia filtros de la pantalla en la URL (mismo criterio que la página: reemplaza, no apila historial). */
export function useCambiarFiltros() {
  const [, setParams] = useSearchParams();
  return useCallback((cambios: Partial<FiltrosPantalla>) => {
    setParams(prev => filtrosAUrl({ ...filtrosDesdeUrl(prev), ...cambios }), { replace: true });
  }, [setParams]);
}
