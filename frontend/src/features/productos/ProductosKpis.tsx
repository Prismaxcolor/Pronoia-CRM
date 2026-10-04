import { Anchor, CheckCircle2, Package, Tags } from 'lucide-react';
import { GrillaKpis, TarjetaKpi, formatearNumero, formatearPct } from '../../components/ui';
import { estiloCategoria } from '../../lib/colores-categoria';
import type { KpisProductos } from '../../lib/productos-kpis';

const CATEGORIAS_EN_TARJETA = 3;

const plural = (n: number, uno: string, varios: string) => `${formatearNumero(n, 0)} ${n === 1 ? uno : varios}`;

/** Los 4 indicadores de /productos. Cuentan TODO el catálogo (no cambian al filtrar). Es un conteo de hoy: no hay
 *  historial del catálogo, por eso no se compara con un periodo anterior. */
function ProductosKpis({ kpis }: { kpis: KpisProductos }) {
  const top = kpis.porCategoria.slice(0, CATEGORIAS_EN_TARJETA);
  const resto = kpis.porCategoria.length - top.length;
  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Productos en el catálogo"
        icono={<Package size={16} />}
        ayuda="Cuántos productos hay registrados en total, contando los activos y los inactivos. Un producto es un material que se pesa, se compra o se vende. No cambia al usar los filtros."
        valor={plural(kpis.total, 'producto', 'productos')}
        subtitulo="todo el catálogo, activos e inactivos"
        comparacion={null}
      />
      <TarjetaKpi
        titulo="Activos"
        icono={<CheckCircle2 size={16} />}
        ayuda="Cuántos productos están activos, es decir, disponibles para usarse al pesar y facturar. Un producto inactivo se guarda en el historial, pero ya no se ofrece."
        valor={plural(kpis.activos, 'activo', 'activos')}
        subtitulo={kpis.inactivos > 0 ? `${plural(kpis.inactivos, 'inactivo', 'inactivos')} (no aparecen al facturar)` : 'ninguno inactivo'}
        comparacion={null}
      />
      <TarjetaKpi
        titulo="Con lote ancla"
        icono={<Anchor size={16} />}
        ayuda="Cuántos productos tienen al menos un lote ancla, es decir, un lote fijo al que pertenecen. Al pesar un producto con lote ancla, solo se pueden elegir sus lotes ancla. Los demás pueden ir a cualquier lote. El porcentaje es sobre todo el catálogo."
        valor={plural(kpis.conLoteAncla, 'producto', 'productos')}
        subtitulo={kpis.pctConLoteAncla === null ? 'sin productos todavía' : `${formatearPct(kpis.pctConLoteAncla, 0)} del catálogo`}
        comparacion={null}
      />
      <TarjetaKpi
        titulo="Por categoría"
        icono={<Tags size={16} />}
        ayuda="Cuántas categorías de material (por ejemplo Ferroso) tienen al menos un producto. Abajo se listan las 3 con más productos; cada categoría tiene siempre el mismo color y símbolo en toda la app."
        valor={plural(kpis.porCategoria.length, 'categoría', 'categorías')}
        subtitulo="con al menos un producto"
        comparacion={null}
      >
        {top.length > 0 && (
          <ul className="mt-1 text-xs text-text-secondary">
            {top.map(c => {
              const e = estiloCategoria(c.nombre);
              return (
                <li key={c.nombre} className="flex justify-between gap-2">
                  <span><span aria-hidden="true" style={{ color: e.color }}>{e.simbolo}</span> {c.nombre}</span>
                  <span className="tabular-nums">{formatearNumero(c.cantidad, 0)}</span>
                </li>
              );
            })}
            {resto > 0 && <li className="text-text-muted">y {plural(resto, 'categoría más', 'categorías más')}</li>}
          </ul>
        )}
      </TarjetaKpi>
    </GrillaKpis>
  );
}

export default ProductosKpis;
