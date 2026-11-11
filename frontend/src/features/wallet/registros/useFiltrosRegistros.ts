import { useCallback, useMemo } from 'react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { useFiltrosUrl } from '../../../components/ui';
import { PERIODO_POR_DEFECTO, resolverSeleccionPeriodo, seleccionDePeriodo, type ClavePeriodoRegistros } from '../wallet-periodos';
import { ESQUEMA_REGISTROS, categoriaUrlDesconocida, contarFiltrosAvanzados, eleccionCategoriaDeUrl } from './registros-filtros';
import { parsearCuentas, serializarCuentas } from './registros-logica';
import type { ValoresAvanzados } from './FiltrosAvanzadosDialogo';

const str = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

type CambiosAvanzados = { tipo?: string; subtipo?: string; categoria?: string; subcategoria?: string; sinanulados?: boolean };

/** Todos los filtros de Registros leídos de (y escritos en) la URL: período, rango, cuentas, tipo, categoría, pago/adelanto y anulados. */
export function useFiltrosRegistros(categorias: readonly CategoriaWallet[], hoy: Date) {
  const { filtros, cambiar } = useFiltrosUrl(ESQUEMA_REGISTROS);
  const p = str(filtros.p);
  const desde = str(filtros.desde);
  const hasta = str(filtros.hasta);
  const seleccion = useMemo(() => seleccionDePeriodo({ p, desde, hasta }), [p, desde, hasta]);
  const { rango, titulo } = useMemo(() => resolverSeleccionPeriodo(seleccion, hoy), [seleccion, hoy]);
  const banca = str(filtros.banca);
  const cuentas = useMemo(() => parsearCuentas(banca), [banca]);
  const cat = str(filtros.cat);
  const categoriaUrl = str(filtros.categoria);
  const subcategoriaUrl = str(filtros.subcategoria);
  const eleccion = useMemo(
    () => eleccionCategoriaDeUrl({ cat, categoria: categoriaUrl, subcategoria: subcategoriaUrl }, categorias),
    [cat, categoriaUrl, subcategoriaUrl, categorias],
  );
  // Solo es fiable con las categorías ya cargadas: quien lo usa espera a que terminen de cargar.
  const catDesconocida = useMemo(
    () => categoriaUrlDesconocida({ cat, categoria: categoriaUrl, subcategoria: subcategoriaUrl }, categorias),
    [cat, categoriaUrl, subcategoriaUrl, categorias],
  );
  const tipo = str(filtros.tipo);
  const subtipo = str(filtros.subtipo);
  const incluirAnulados = filtros.sinanulados !== true;

  const elegirRapido = useCallback((clave: ClavePeriodoRegistros) => {
    cambiar({ p: clave === PERIODO_POR_DEFECTO ? undefined : clave, desde: undefined, hasta: undefined });
  }, [cambiar]);
  const elegirRango = useCallback((r: { desde?: string; hasta?: string }) => cambiar({ p: undefined, desde: r.desde, hasta: r.hasta }), [cambiar]);
  const elegirCuentas = useCallback((ids: readonly string[]) => cambiar({ banca: serializarCuentas(ids) }), [cambiar]);

  // Cualquier cambio de categoría escribe las dos (y borra `cat`) para que la elección explícita no se pierda ni se contradiga.
  const cambiarAvanzados = useCallback((c: CambiosAvanzados) => {
    const { categoria, subcategoria, ...resto } = c;
    const tocaCategoria = 'categoria' in c || 'subcategoria' in c;
    cambiar({
      ...resto,
      ...(tocaCategoria ? {
        categoria: 'categoria' in c ? categoria : eleccion.categoria,
        subcategoria: 'subcategoria' in c ? subcategoria : eleccion.subcategoria,
        cat: undefined,
      } : {}),
    });
  }, [cambiar, eleccion]);

  const limpiarAvanzados = useCallback(() => {
    cambiar({ tipo: undefined, subtipo: undefined, categoria: undefined, subcategoria: undefined, cat: undefined, sinanulados: undefined });
  }, [cambiar]);

  const valoresAvanzados: ValoresAvanzados = { tipo, subtipo, categoria: eleccion.categoria, subcategoria: eleccion.subcategoria, incluirAnulados };
  const avanzadosActivos = contarFiltrosAvanzados(filtros);

  return {
    seleccion, rango, titulo, cuentas, eleccion, tipo, subtipo, incluirAnulados, cat, catDesconocida,
    valoresAvanzados, avanzadosActivos,
    elegirRapido, elegirRango, elegirCuentas, cambiarAvanzados, limpiarAvanzados,
  };
}
