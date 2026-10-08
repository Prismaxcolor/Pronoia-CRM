import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Tags } from 'lucide-react';
import {
  obtenerProductos,
  desactivarProducto,
  reactivarProducto,
  borrarProducto,
  reordenarProductos,
} from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import {
  Bloque, BotonAccion, Chip, ControlSegmentado, EncabezadoPagina, EstadoVacio, FiltrosBarra, SkeletonBloque, SkeletonKpis,
  useFiltrosUrl,
} from '../../components/ui';
import type { OpcionFiltro } from '../../components/ui';
import { estiloCategoria } from '../../lib/colores-categoria';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import {
  TIPOS_PRODUCTO, categoriasPresentes, derivarKpisProductos, filtrarProductos,
  type FiltroActivo, type FiltrosProductos,
} from '../../lib/productos-kpis';
import ProductoForm from './ProductoForm';
import CategoriasModal from './CategoriasModal';
import ProductosKpis from './ProductosKpis';
import ProductosTarjetas from './ProductosTarjetas';
import { TIPO_INSIGNIA } from './productos-tipos';
import type { AccionesComunes } from './AccionesProducto';
import type { Producto, TipoProducto } from '@shared/types/index.js';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

// Lo pesado se carga después de los indicadores.
const ProductosDona = lazy(() => import('./ProductosDona'));
const ProductosTabla = lazy(() => import('./ProductosTabla'));

type Vista = 'tarjetas' | 'tabla';

/** Filtros en la URL (se pueden compartir y sobreviven a F5): q, categoria, activo, tipo, sinestado y vista. */
const ESQUEMA: EsquemaFiltros = {
  campos: {
    q: { tipo: 'texto' },
    categoria: { tipo: 'texto' },
    activo: { tipo: 'opcion', opciones: ['activos', 'inactivos'] },
    tipo: { tipo: 'opcion', opciones: TIPOS_PRODUCTO },
    sinestado: { tipo: 'bandera' },
    vista: { tipo: 'opcion', opciones: ['tarjetas', 'tabla'] },
  },
};

const OPCIONES_ACTIVO: ReadonlyArray<OpcionFiltro> = [
  { valor: 'activos', etiqueta: 'Activos' },
  { valor: 'inactivos', etiqueta: 'Inactivos' },
];

/** Espera antes de montar los bloques pesados, para que los indicadores pinten primero. */
const RETARDO_BLOQUES_PESADOS_MS = 150;

function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarPesados, setMostrarPesados] = useState(false);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; producto: Producto | null } | { abierto: false }>({ abierto: false });
  const [categoriasAbierto, setCategoriasAbierto] = useState(false);
  const { filtros: valores, cambiar } = useFiltrosUrl(ESQUEMA);
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');
  const puedeBorrar = tienePermiso('productos', 'eliminar');

  const filtros = useMemo<FiltrosProductos>(() => ({
    q: valores.q as string | undefined,
    categoria: valores.categoria as string | undefined,
    activo: valores.activo as FiltroActivo | undefined,
    tipo: valores.tipo as TipoProducto | undefined,
    // Modo rápido: solo Ferroso / No ferroso cuyo estado (limpio/sucio) aún no se definió.
    sinEstado: valores.sinestado === true,
  }), [valores]);
  const vista: Vista = valores.vista === 'tabla' ? 'tabla' : 'tarjetas';

  const kpis = useMemo(() => derivarKpisProductos(productos), [productos]);
  const categorias = useMemo(() => categoriasPresentes(productos), [productos]);
  const filtrados = useMemo(() => filtrarProductos(productos, filtros), [productos, filtros]);
  const opcionesCategoria = useMemo<OpcionFiltro[]>(
    () => categorias.map(c => ({ valor: c, etiqueta: `${estiloCategoria(c).simbolo} ${c}` })),
    [categorias],
  );

  const recargar = () => obtenerProductos().then(setProductos).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  useEffect(() => {
    if (cargando) return;
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, [cargando]);

  const limpiarFiltros = useCallback(
    () => cambiar({ q: undefined, categoria: undefined, activo: undefined, tipo: undefined, sinestado: undefined }),
    [cambiar],
  );

  const handleDesactivar = async (p: Producto) => {
    const ok = await confirmar({
      titulo: `Desactivar "${p.nombre}"`,
      mensaje: 'El producto dejará de aparecer en el catálogo de facturación. Las facturas existentes que lo contienen no se modifican. Podrás reactivarlo más adelante.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarProducto(p.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`"${p.nombre}" desactivado.`);
    cargar();
  };

  const handleReactivar = async (p: Producto) => {
    const result = await reactivarProducto(p.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`"${p.nombre}" reactivado.`);
    cargar();
  };

  const handleBorrar = async (p: Producto) => {
    const ok = await confirmar({
      titulo: `Borrar "${p.nombre}" definitivamente`,
      mensaje: 'Esta acción es irreversible. Solo se permite si el producto NO aparece en ninguna factura.\n\nSi tiene historial, mantenlo desactivado en su lugar.',
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarProducto(p.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`"${p.nombre}" eliminado.`);
    cargar();
  };

  // Mueve contra el arreglo completo (no el filtrado) — así el orden real
  // no se corrompe si hay una búsqueda o filtro activo mientras se reordena.
  const mover = (id: string, direccion: 'arriba' | 'abajo') => {
    const idx = productos.findIndex(p => p.id === id);
    const destino = direccion === 'arriba' ? idx - 1 : idx + 1;
    if (idx === -1 || destino < 0 || destino >= productos.length) return;

    const reordenados = [...productos];
    [reordenados[idx], reordenados[destino]] = [reordenados[destino], reordenados[idx]];
    setProductos(reordenados);

    reordenarProductos(reordenados.map(p => p.id)).then(result => {
      if ('error' in result) {
        toast.errorMsg(result.error);
        cargar();
      }
    });
  };

  const acciones: AccionesComunes = {
    puedeEditar,
    puedeBorrar,
    onMover: mover,
    onEditar: p => setFormAbierto({ abierto: true, producto: p }),
    onDesactivar: handleDesactivar,
    onReactivar: handleReactivar,
    onBorrar: handleBorrar,
  };

  const encabezado = (
    <EncabezadoPagina lecturas={LECTURAS.catalogos}
      titulo="Productos"
      subtitulo="Los materiales que se pesan, se compran y se venden: su categoría, su estado y a qué lotes pertenecen."
      acciones={
        <>
          {puedeEditar && (
            <BotonAccion variante="secundario" icono={<Tags size={16} />} onClick={() => setCategoriasAbierto(true)}>
              Gestionar categorías
            </BotonAccion>
          )}
          {puedeCrear && (
            <BotonAccion soloEnLinea icono={<Plus size={16} />} onClick={() => setFormAbierto({ abierto: true, producto: null })}>
              Nuevo producto
            </BotonAccion>
          )}
        </>
      }
    />
  );

  if (cargando) {
    return (
      <div className="max-w-7xl">
        {encabezado}
        <SkeletonKpis />
        <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando productos" />
      </div>
    );
  }

  const hayFiltros = Boolean(filtros.q || filtros.categoria || filtros.activo || filtros.tipo || filtros.sinEstado);
  const vacio = productos.length === 0
    ? {
        mensaje: 'Todavía no hay productos en el catálogo',
        descripcion: 'Un producto es un material que se puede pesar, comprar o vender (por ejemplo, "Placa verde"). Sin productos no se puede registrar un pesaje ni una factura.',
        accion: puedeCrear ? { etiqueta: 'Crear el primer producto', onClick: () => setFormAbierto({ abierto: true, producto: null }) } : undefined,
      }
    : {
        mensaje: 'Ningún producto coincide con los filtros',
        descripcion: 'Prueba con otra palabra, otra categoría o quita algún filtro para ver todo el catálogo.',
        accion: { etiqueta: 'Quitar los filtros', onClick: limpiarFiltros },
      };

  return (
    <div className="max-w-7xl">
      {encabezado}

      <FiltrosBarra
        selectores={[
          { id: 'prod-categoria', etiqueta: 'Categoría', valor: filtros.categoria, opciones: opcionesCategoria, textoTodas: 'Todas', onCambiar: v => cambiar({ categoria: v }) },
          { id: 'prod-activo', etiqueta: 'Estado', valor: filtros.activo, opciones: OPCIONES_ACTIVO, textoTodas: 'Todos', onCambiar: v => cambiar({ activo: v }) },
        ]}
        buscador={{ id: 'prod-buscar', valor: filtros.q, placeholder: 'Nombre, descripción o categoría', onCambiar: v => cambiar({ q: v }) }}
        onLimpiar={limpiarFiltros}
      />

      <section aria-label="Indicadores principales">
        <ProductosKpis kpis={kpis} />
      </section>

      {mostrarPesados ? (
        <Suspense fallback={<SkeletonBloque alto="h-56" conMargen etiqueta="Cargando gráfica" />}>
          <ProductosDona kpis={kpis} />
        </Suspense>
      ) : (
        <SkeletonBloque alto="h-56" conMargen etiqueta="Cargando gráfica" />
      )}

      <Bloque
        titulo="Catálogo"
        queEstasViendo={`${filtrados.length === productos.length ? 'todos los productos' : `${filtrados.length} de ${productos.length} productos, según los filtros`}. Puedes verlos como tarjetas o como tabla; en la tabla se ordena por columna y se exporta a CSV.`}
        acciones={
          <ControlSegmentado<Vista>
            etiquetaAria="Vista del catálogo"
            valor={vista}
            onCambiar={v => cambiar({ vista: v === 'tarjetas' ? undefined : v })}
            opciones={[
              { valor: 'tarjetas', etiqueta: 'Tarjetas' },
              { valor: 'tabla', etiqueta: 'Tabla' },
            ]}
          />
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por tipo y estado de limpieza">
          {TIPOS_PRODUCTO.map(tipo => (
            <Chip key={tipo} seleccionado={filtros.tipo === tipo} onClick={() => cambiar({ tipo: filtros.tipo === tipo ? undefined : tipo })}>
              {TIPO_INSIGNIA[tipo].etiqueta}
            </Chip>
          ))}
          {(kpis.sinEstado > 0 || filtros.sinEstado) && (
            <span title="Productos Ferroso y No ferroso a los que todavía no se les indicó si son limpios (sin residuos) o sucios (con residuos)">
              <Chip seleccionado={Boolean(filtros.sinEstado)} onClick={() => cambiar({ sinestado: filtros.sinEstado ? undefined : true })}>
                Sin definir limpio/sucio ({kpis.sinEstado})
              </Chip>
            </span>
          )}
          {hayFiltros && (
            <button type="button" onClick={limpiarFiltros} className="ml-1 text-xs text-text-muted underline hover:text-text-primary">
              Quitar filtros
            </button>
          )}
        </div>

        {vista === 'tabla' ? (
          <Suspense fallback={<SkeletonBloque alto="h-64" etiqueta="Cargando tabla" />}>
            <ProductosTabla productos={filtrados} catalogo={productos} acciones={acciones} vacio={vacio} />
          </Suspense>
        ) : filtrados.length === 0 ? (
          <EstadoVacio mensaje={vacio.mensaje} descripcion={vacio.descripcion} accion={vacio.accion} />
        ) : (
          <ProductosTarjetas productos={filtrados} catalogo={productos} acciones={acciones} />
        )}
      </Bloque>

      {formAbierto.abierto && (
        <ProductoForm
          producto={formAbierto.producto}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}

      {categoriasAbierto && (
        <CategoriasModal
          onClose={() => setCategoriasAbierto(false)}
          onCambios={cargar}
        />
      )}
    </div>
  );
}

export default ProductosPage;
