import { useMemo } from 'react';
import { Bloque, BarrasHorizontales, EstadoVacio, formatearKg, formatearUsd } from '../../components/ui';
import { estiloCategoria } from '../../lib/colores-categoria';
import {
  hayDatosParaGrafica, topProductosPorValor, valorPorCategoria,
  type ProductoValor, type ValorAlmacen,
} from './lib/inventario-valor-kpis';

const SIN_DATOS = 'Hace falta que al menos dos grupos tengan costo para comparar. Pon costos a los productos para ver esta gráfica.';
const TOP = 10;

export function ValorPorCategoria({ productos }: { productos: readonly ProductoValor[] }) {
  const grupos = useMemo(() => valorPorCategoria(productos), [productos]);
  const datos = useMemo(() => grupos.map(g => {
    const e = estiloCategoria(g.etiqueta);
    return { etiqueta: g.etiqueta, valor: g.valorUsd, color: e.color, simbolo: e.simbolo, detalle: `${formatearKg(g.kg)} con costo` };
  }), [grupos]);
  return (
    <Bloque titulo="Valor por categoría" queEstasViendo="cuánto vale a costo cada categoría de material (kg × costo por kg de sus productos). Solo cuenta lo que tiene costo.">
      {hayDatosParaGrafica(grupos.map(g => g.valorUsd))
        ? <BarrasHorizontales datos={datos} formatoValor={formatearUsd} etiquetaAria="Valor del inventario a costo por categoría" />
        : <EstadoVacio mensaje="Todavía no hay suficientes categorías con costo" descripcion={SIN_DATOS} />}
    </Bloque>
  );
}

export function ValorPorAlmacen({ almacenes }: { almacenes: readonly ValorAlmacen[] }) {
  const datos = useMemo(() => almacenes.map(a => ({
    etiqueta: a.nombre,
    valor: a.valorUsd,
    detalle: a.kgSinCosto > 0 ? `${formatearKg(a.kgConCosto)} con costo · ⚠ ${formatearKg(a.kgSinCosto)} sin costo (no entran)` : `${formatearKg(a.kgConCosto)} con costo`,
  })), [almacenes]);
  return (
    <Bloque titulo="Valor por almacén" queEstasViendo="cuánto vale a costo el material suelto de cada galpón (kg que hay allí × costo por kg del producto). Los lotes no se incluyen.">
      {almacenes.some(a => a.valorUsd > 0)
        ? <BarrasHorizontales datos={datos} ordenar={false} formatoValor={formatearUsd} etiquetaAria="Valor del inventario a costo por almacén" />
        : <EstadoVacio mensaje="Ningún almacén tiene material con costo" descripcion="Pon costo por kg a los productos que hay en los galpones para ver cuánto vale cada uno." />}
    </Bloque>
  );
}

export function TopProductos({ productos }: { productos: readonly ProductoValor[] }) {
  const top = useMemo(() => topProductosPorValor(productos, TOP), [productos]);
  const datos = useMemo(() => top.map(p => {
    const e = estiloCategoria(p.categoria);
    return { etiqueta: p.nombre, valor: p.valorUsd ?? 0, color: e.color, simbolo: e.simbolo, detalle: `${p.categoria} · ${formatearKg(p.kg)}` };
  }), [top]);
  return (
    <Bloque titulo={`Los ${TOP} productos que más valen`} queEstasViendo="los productos con mayor valor a costo en galpón (kg × costo por kg). Útil para saber dónde está el dinero.">
      {hayDatosParaGrafica(top.map(p => p.valorUsd ?? 0))
        ? <BarrasHorizontales datos={datos} formatoValor={formatearUsd} etiquetaAria={`Los ${TOP} productos de mayor valor a costo`} />
        : <EstadoVacio mensaje="Todavía no hay suficientes productos con costo" descripcion={SIN_DATOS} />}
    </Bloque>
  );
}
