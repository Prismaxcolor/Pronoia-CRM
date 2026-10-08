import { useMemo } from 'react';
import { Package } from 'lucide-react';
import { Insignia, TablaDatos } from '../../components/ui';
import type { ColumnaTabla } from '../../components/ui';
import { categoriaDeProducto, tieneLoteAncla } from '../../lib/productos-kpis';
import { admiteEstadoLimpieza, ETIQUETA_ESTADO_LIMPIEZA } from './estado-limpieza';
import AccionesProducto, { type AccionesComunes } from './AccionesProducto';
import { EtiquetaCategoria, InsigniaLimpieza, InsigniaTipo } from './ProductosInsignias';
import { TIPO_INSIGNIA } from './productos-tipos';
import type { Producto } from '@shared/types/index.js';

interface Props {
  productos: readonly Producto[];
  catalogo: readonly Producto[];
  acciones: AccionesComunes;
  /** Texto del estado vacío (distinto si el catálogo está vacío o si los filtros no dejan nada). */
  vacio: { mensaje: string; descripcion?: string; accion?: { etiqueta: string; onClick?: () => void } };
}

/** Vista de tabla del catálogo: ordenable (aria-sort), exportable a CSV y apilada como tarjetas en móvil. Sin precios. */
function ProductosTabla({ productos, catalogo, acciones, vacio }: Props) {
  const hayAcciones = acciones.puedeEditar || acciones.puedeBorrar;

  const columnas = useMemo<ColumnaTabla<Producto>[]>(() => {
    const base: ColumnaTabla<Producto>[] = [
      {
        clave: 'nombre',
        titulo: 'Producto',
        valorOrden: p => p.nombre,
        celda: p => (
          <span className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-brand-100 text-brand-700">
              {p.fotos[0] ? <img src={p.fotos[0]} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package size={16} aria-hidden="true" />}
            </span>
            <span className="min-w-0 font-medium text-text-primary">{p.nombre}</span>
          </span>
        ),
      },
      { clave: 'categoria', titulo: 'Categoría', valorOrden: categoriaDeProducto, celda: p => <EtiquetaCategoria producto={p} /> },
      { clave: 'tipo', titulo: 'Tipo', ayuda: 'Cómo está armado el producto. Básico: un producto simple con peso. Variantes: tiene varias presentaciones. Compuesto: está formado por subproductos. No se puede cambiar después de creado.', valorOrden: p => TIPO_INSIGNIA[p.tipo].etiqueta, celda: p => <InsigniaTipo tipo={p.tipo} /> },
      {
        clave: 'limpieza',
        titulo: 'Limpio / sucio',
        ayuda: 'Estado del material: limpio (sin residuos) o sucio (trae residuos). Sirve para separarlos en el inventario. Solo aplica a Ferroso y No ferroso; "Sin definir" quiere decir que falta indicarlo en el producto.',
        valorOrden: p => (admiteEstadoLimpieza(p.tipoMaterialNombre) ? ETIQUETA_ESTADO_LIMPIEZA[p.estadoLimpieza ?? ''] : null),
        celda: p => (admiteEstadoLimpieza(p.tipoMaterialNombre) ? <InsigniaLimpieza producto={p} /> : <span className="text-text-muted">—</span>),
      },
      {
        clave: 'lotes',
        titulo: 'Lotes ancla',
        alinear: 'derecha',
        ayuda: 'Cuántos lotes ancla tiene el producto (lotes fijos a los que pertenece). Al pesarlo solo se pueden elegir esos lotes. 0 = sin lote ancla: puede ir a cualquier lote.',
        valorOrden: p => p.loteIds?.length ?? 0,
        celda: p => (tieneLoteAncla(p) ? p.loteIds!.length : <span className="text-text-muted">0</span>),
      },
      {
        clave: 'estado',
        titulo: 'Estado',
        valorOrden: p => (p.activo ? 'Activo' : 'Inactivo'),
        celda: p => <Insignia tono={p.activo ? 'marca' : 'neutral'}>{p.activo ? 'Activo' : 'Inactivo'}</Insignia>,
      },
    ];
    if (!hayAcciones) return base;
    return [
      ...base,
      {
        clave: 'acciones',
        titulo: 'Acciones',
        valorCsv: false,
        celda: p => (
          <AccionesProducto
            {...acciones}
            producto={p}
            esPrimero={catalogo[0]?.id === p.id}
            esUltimo={catalogo[catalogo.length - 1]?.id === p.id}
          />
        ),
      },
    ];
  }, [acciones, catalogo, hayAcciones]);

  return (
    <TablaDatos
      titulo="Catálogo de productos"
      columnas={columnas}
      filas={productos}
      claveFila={p => p.id}
      etiquetaFila={p => p.nombre}
      vacio={vacio}
      exportar={{ nombreArchivo: 'productos' }}
      anchoMinimo="min-w-[48rem]"
      claseFila={p => (p.activo ? '' : 'opacity-70')}
    />
  );
}

export default ProductosTabla;
