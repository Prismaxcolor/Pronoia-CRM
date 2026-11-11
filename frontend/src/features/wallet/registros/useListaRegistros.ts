import { useMemo } from 'react';
import type { Movimiento } from '@shared/types/index.js';
import type { NombreContraparte } from '../../../lib/cochinito-kpis';
import { filtrarRegistros, type FiltrosRegistros } from './registros-filtros';
import { agruparPorSemana } from './registros-logica';
import { expandirPatas, flujoNetoUsdFilas, idsNavegacionDeFilas } from './registros-patas';
import type { SemanaConFilas } from './SemanaRegistros';

/** Lista de Registros ya filtrada, agrupada por semana y expandida en filas (transferencias en dos patas), con su ∑ y los ids para anterior/siguiente. */
export function useListaRegistros(
  movimientos: readonly Movimiento[],
  filtros: FiltrosRegistros,
  nombreContraparte: NombreContraparte,
  monedasCuentas: ReadonlyMap<string, string>,
) {
  const { q, desde, hasta, tipo, subtipo, cuentas, incluirAnulados, categorias, categoria, subcategoria } = filtros;
  const filtrados = useMemo(
    () => filtrarRegistros(movimientos, { q, desde, hasta, tipo, subtipo, cuentas, incluirAnulados, categorias, categoria, subcategoria }, nombreContraparte),
    [movimientos, q, desde, hasta, tipo, subtipo, cuentas, incluirAnulados, categorias, categoria, subcategoria, nombreContraparte],
  );
  const conFiltroCuentas = cuentas.length > 0;
  const semanas = useMemo<SemanaConFilas[]>(
    () => agruparPorSemana(filtrados).map(g => {
      const filas = expandirPatas(g.movimientos, monedasCuentas, cuentas);
      return { clave: g.clave, semana: g.semana, filas, flujo: flujoNetoUsdFilas(filas, conFiltroCuentas) };
    }),
    [filtrados, monedasCuentas, cuentas, conFiltroCuentas],
  );
  const flujoTotal = useMemo(() => flujoNetoUsdFilas(semanas.flatMap(s => s.filas), conFiltroCuentas), [semanas, conFiltroCuentas]);
  const idsNavegacion = useMemo(() => idsNavegacionDeFilas(semanas.flatMap(s => s.filas)), [semanas]);
  return { filtrados, semanas, flujoTotal, idsNavegacion, conFiltroCuentas };
}
