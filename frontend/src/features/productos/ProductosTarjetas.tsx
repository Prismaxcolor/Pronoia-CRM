import { Package } from 'lucide-react';
import { Insignia } from '../../components/ui';
import { tieneLoteAncla } from '../../lib/productos-kpis';
import AccionesProducto, { type AccionesComunes } from './AccionesProducto';
import { EtiquetaCategoria, InsigniaLimpieza, InsigniaTipo } from './ProductosInsignias';
import type { Producto } from '@shared/types/index.js';

interface Props {
  productos: readonly Producto[];
  /** Catálogo completo en su orden real (para saber si una tarjeta es la primera o la última al reordenar). */
  catalogo: readonly Producto[];
  acciones: AccionesComunes;
}

/** Vista de tarjetas del catálogo (la de siempre, con el lenguaje del kit). */
function ProductosTarjetas({ productos, catalogo, acciones }: Props) {
  const hayAcciones = acciones.puedeEditar || acciones.puedeBorrar;
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {productos.map(p => (
        <li
          key={p.id}
          className={`group relative rounded-xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md ${p.activo ? '' : 'opacity-70'}`}
        >
          {hayAcciones && (
            <div className="absolute right-2 top-2 z-10 rounded-md bg-surface/90 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <AccionesProducto
                {...acciones}
                producto={p}
                esPrimero={catalogo[0]?.id === p.id}
                esUltimo={catalogo[catalogo.length - 1]?.id === p.id}
              />
            </div>
          )}

          <div className="mb-3 flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-brand-100 text-brand-700">
            {p.fotos[0]
              ? <img src={p.fotos[0]} alt={p.nombre} loading="lazy" className="h-full w-full object-cover" />
              : <Package size={28} aria-hidden="true" />}
          </div>

          <h3 className="mb-1 text-sm font-semibold leading-tight text-text-primary">{p.nombre}</h3>
          <p className="mb-3 line-clamp-2 min-h-[2rem] text-xs text-text-secondary">{p.descripcion || 'Sin descripción'}</p>

          <div className="flex items-center justify-between gap-2">
            <EtiquetaCategoria producto={p} />
            {p.tipo === 'azul' && <span className="text-xs text-text-muted">{p.variantes.length} variante(s)</span>}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <InsigniaTipo tipo={p.tipo} />
            <InsigniaLimpieza producto={p} />
            {tieneLoteAncla(p) && (
              <Insignia tono="marca" title="Tiene lotes posibles asignados: en el pesaje se ofrecen primero">
                {p.loteIds!.length === 1 ? '1 lote ancla' : `${p.loteIds!.length} lotes ancla`}
              </Insignia>
            )}
            {!p.activo && <Insignia tono="neutral">Inactivo</Insignia>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default ProductosTarjetas;
