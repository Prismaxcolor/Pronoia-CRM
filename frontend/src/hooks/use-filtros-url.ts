import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { contarFiltrosActivos, escribirFiltros, leerFiltros, limpiarFiltros, type EsquemaFiltros, type ValoresFiltros } from '../lib/filtros-url';

/** CUÁNDO USARLO: filtros de una pantalla que deben sobrevivir a recargar, al botón "atrás" y a compartir el enlace.
 *  Declara el esquema FUERA del componente (constante de módulo) para que sea estable:
 *    const ESQUEMA = { campos: { desde: {tipo:'fecha'}, hasta: {tipo:'fecha'}, q: {tipo:'texto'} }, rangos: [['desde','hasta']] } as const;
 *    const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA);
 *  Valores inválidos en la URL se descartan; las demás claves de la URL se conservan; los cambios reemplazan (no apilan historial).
 *  La lógica vive en lib/filtros-url.ts (probada en backend/tests). */
export function useFiltrosUrl(esquema: EsquemaFiltros) {
  const [params, setParams] = useSearchParams();
  const filtros = useMemo<ValoresFiltros>(() => leerFiltros(params, esquema), [params, esquema]);

  const cambiar = useCallback((cambios: ValoresFiltros) => {
    setParams(prev => escribirFiltros(prev, esquema, cambios), { replace: true });
  }, [setParams, esquema]);

  const limpiar = useCallback(() => {
    setParams(prev => limpiarFiltros(prev, esquema), { replace: true });
  }, [setParams, esquema]);

  return { filtros, cambiar, limpiar, cantidadActivos: contarFiltrosActivos(filtros) };
}
