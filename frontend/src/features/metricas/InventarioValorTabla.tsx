import { useMemo } from 'react';
import { Bloque, EstadoVacio, FiltrosBarra, TablaDatos, formatearKg, formatearUsdDecimales, formatearUsd } from '../../components/ui';
import type { ColumnaTabla } from '../../components/ui';
import { estiloCategoria } from '../../lib/colores-categoria';
import { categoriasDe, etiquetaFuente, filtrarProductos, simboloFuente, type ProductoValor } from './lib/inventario-valor-kpis';

export interface InventarioValorTablaProps {
  productos: readonly ProductoValor[];
  q: string | undefined;
  categoria: string | undefined;
  soloSinCosto: boolean;
  onFiltros: (c: { q?: string; categoria?: string; soloSinCosto?: boolean }) => void;
  onLimpiar: () => void;
}

const TEXTO_FUENTE = 'Manual: costo por kg que se puso a mano (manda sobre las facturas). Facturas: promedio ponderado de las facturas de compra. Sin costo: aún no tiene ninguno y no entra en el valor.';

/** Esta tabla solo tiene materiales sueltos. Si el nombre empieza por "Lote" (p. ej. «LOTE 2» de PCB) se aclara el tipo
 *  para no confundirlo con un lote de exportación. */
const nombreVisible = (p: ProductoValor): string => (/^lote\b/i.test(p.nombre.trim()) ? `${p.nombre} (material)` : p.nombre);

const COLUMNAS: ReadonlyArray<ColumnaTabla<ProductoValor>> = [
  { clave: 'producto', titulo: 'Producto', valorOrden: p => p.nombre.toLowerCase(), celda: nombreVisible, valorCsv: nombreVisible },
  {
    clave: 'categoria', titulo: 'Categoría', valorOrden: p => p.categoria,
    celda: p => <span><span aria-hidden="true" style={{ color: estiloCategoria(p.categoria).color }}>{estiloCategoria(p.categoria).simbolo}</span> {p.categoria}</span>,
    valorCsv: p => p.categoria,
  },
  { clave: 'kg', titulo: 'Kg', alinear: 'derecha', valorOrden: p => p.kg, celda: p => <span className="tabular-nums">{formatearKg(p.kg)}</span>, valorCsv: p => p.kg, decimalesCsv: 3, total: filas => <span className="tabular-nums">{formatearKg(filas.reduce((s, p) => s + p.kg, 0))}</span> },
  {
    clave: 'costo', titulo: 'Costo por kg', alinear: 'derecha', valorOrden: p => p.costoEfectivoKg,
    celda: p => <span className="tabular-nums">{p.costoEfectivoKg === null ? '—' : formatearUsdDecimales(p.costoEfectivoKg)}</span>,
    valorCsv: p => p.costoEfectivoKg, decimalesCsv: 4,
  },
  {
    clave: 'fuente', titulo: 'Fuente', ayuda: TEXTO_FUENTE, valorOrden: p => etiquetaFuente(p.fuente),
    celda: p => <span className={p.fuente === null ? 'font-medium text-amber-800' : ''}><span aria-hidden="true">{simboloFuente(p.fuente)}</span> {etiquetaFuente(p.fuente)}</span>,
    valorCsv: p => etiquetaFuente(p.fuente),
  },
  {
    clave: 'valor', titulo: 'Valor', alinear: 'derecha', valorOrden: p => p.valorUsd,
    ayuda: 'Kg × costo por kg, en USD. Vacío (—) si el producto no tiene costo.',
    celda: p => <span className="tabular-nums">{p.valorUsd === null ? '—' : formatearUsdDecimales(p.valorUsd)}</span>,
    valorCsv: p => p.valorUsd, decimalesCsv: 2,
    total: filas => <span className="tabular-nums">{formatearUsd(filas.reduce((s, p) => s + (p.valorUsd ?? 0), 0))}</span>,
  },
];

function InventarioValorTabla({ productos, q, categoria, soloSinCosto, onFiltros, onLimpiar }: InventarioValorTablaProps) {
  const categorias = useMemo(() => categoriasDe(productos), [productos]);
  const filas = useMemo(() => filtrarProductos(productos, { q, categoria, soloSinCosto }), [productos, q, categoria, soloSinCosto]);

  return (
    <Bloque titulo="Productos con stock" queEstasViendo="cada producto que hay hoy en los galpones, con su costo por kg, de dónde sale ese costo y cuánto vale. Toca un encabezado para ordenar.">
      <FiltrosBarra
        buscador={{ id: 'inv-valor-buscar', valor: q, etiqueta: 'Buscar producto', placeholder: 'Nombre del producto…', onCambiar: v => onFiltros({ q: v }) }}
        selectores={[{ id: 'inv-valor-categoria', etiqueta: 'Categoría', valor: categoria, opciones: categorias.map(c => ({ valor: c, etiqueta: c })), onCambiar: v => onFiltros({ categoria: v }), textoTodas: 'Todas' }]}
        onLimpiar={onLimpiar}
      />
      <label className="mb-3 inline-flex items-center gap-2 text-sm text-text-primary">
        <input type="checkbox" checked={soloSinCosto} onChange={e => onFiltros({ soloSinCosto: e.target.checked || undefined })} className="h-4 w-4 rounded border-border accent-brand-600" />
        Solo los que no tienen costo
      </label>
      {productos.length === 0 ? (
        <EstadoVacio mensaje="No hay productos con stock" descripcion="Cuando haya material en los galpones aparecerá aquí con su valor." />
      ) : (
        <TablaDatos
          titulo="Productos con stock y su valor a costo"
          columnas={COLUMNAS}
          filas={filas}
          claveFila={p => p.productoId}
          totales={{ etiqueta: 'Total de lo filtrado' }}
          ordenInicial={{ columna: 'valor', sentido: 'desc' }}
          vacio={{ mensaje: 'Ningún producto coincide con los filtros', descripcion: 'Prueba quitar el texto, la categoría o la casilla «Solo los que no tienen costo».' }}
          exportar={{ nombreArchivo: 'inventario-valorizado' }}
          paginacion={{ tamano: 50 }}
        />
      )}
      <p className="mt-2 text-xs text-text-muted">Aviso: el archivo CSV incluye costos y valores internos; compártelo solo con quien deba verlos.</p>
    </Bloque>
  );
}

export default InventarioValorTabla;
