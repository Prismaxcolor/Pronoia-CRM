import { useMemo } from 'react';
import { Bloque, Dona, EstadoVacio, formatearNumero } from '../../components/ui';
import { itemsDonaCategorias, type KpisProductos } from '../../lib/productos-kpis';

/** Mínimo de categorías para que una dona diga algo (con una sola, todo es 100 %). */
const MIN_CATEGORIAS_DONA = 2;

/** Bloque "Productos por categoría": dona de hasta 5 partes + "Otros", con los colores fijos de cada categoría. */
function ProductosDona({ kpis }: { kpis: KpisProductos }) {
  const items = useMemo(() => itemsDonaCategorias(kpis.porCategoria), [kpis.porCategoria]);
  return (
    <div className="print:hidden">
      <Bloque
        titulo="Productos por categoría"
        queEstasViendo="qué parte del catálogo ocupa cada categoría de material. Cada color y símbolo es el mismo en todas las pantallas."
      >
        {kpis.porCategoria.length < MIN_CATEGORIAS_DONA ? (
          <EstadoVacio
            mensaje="Aún no hay varias categorías para comparar"
            descripcion="La gráfica aparece cuando el catálogo tiene productos en al menos dos categorías. Asigna una categoría al crear o editar cada producto."
          />
        ) : (
          <div className="rounded-xl border border-border bg-surface p-4">
            <Dona
              items={items}
              rotuloTotal="Productos"
              formatoValor={v => formatearNumero(v, 0)}
              etiquetaAria="Productos del catálogo por categoría"
            />
          </div>
        )}
      </Bloque>
    </div>
  );
}

export default ProductosDona;
