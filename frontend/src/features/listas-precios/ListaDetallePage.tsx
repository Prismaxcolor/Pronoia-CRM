import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Check, Coins, Lock, PackageCheck, CalendarClock, ArrowUpDown } from 'lucide-react';
import { useParams } from 'react-router-dom';
import {
  obtenerListaDetalle,
  upsertPrecioEnLista,
  eliminarPrecio,
  reordenarPrecios,
} from '../../services/lista-precios-service';
import ReordenarPreciosPanel from './ReordenarPreciosPanel';
import { obtenerProductos } from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import {
  Bloque, EncabezadoPagina, EstadoVacio, GrillaKpis, Insignia, SkeletonBloque, SkeletonKpis, TarjetaKpi,
  formatearFecha, formatearNumero, formatearUsdDecimales,
} from '../../components/ui';
import type TablaDatosTipo from '../../components/ui/TablaDatos';
import type { ColumnaTabla } from '../../components/ui';
import { derivarKpisPreciosLista } from '../../lib/productos-kpis';
import { estiloCategoria } from '../../lib/colores-categoria';
import type { ListaPrecios, PrecioLista, Producto } from '@shared/types/index.js';

// lazy pierde el genérico de TablaDatos<T>: se restaura con su tipo.
const TablaDatos = lazy(() => import('../../components/ui/TablaDatos')) as unknown as typeof TablaDatosTipo;

const ID_CAMPO_MATERIAL = 'lista-nuevo-material';
const BOTON_ICONO = 'p-1.5 rounded-md text-text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Valor que el usuario no puede ver (sin facturacion:ver): con candado y texto, no solo con ícono. */
function SinPermiso() {
  return (
    <span className="inline-flex items-center gap-1 text-text-muted" title="Tu usuario no tiene permiso para ver precios">
      <Lock size={12} aria-hidden="true" /><span className="text-xs font-medium">Sin permiso</span>
    </span>
  );
}

function ListaDetallePage() {
  const { id = '' } = useParams();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const [lista, setLista] = useState<ListaPrecios | null>(null);
  const [precios, setPrecios] = useState<PrecioLista[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);

  // edición inline: precio editado por productoId
  const [editado, setEditado] = useState<Record<string, string>>({});
  // alta de nuevo material
  const [nuevoProductoId, setNuevoProductoId] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');
  const [reordenando, setReordenando] = useState(false);

  const puedeEditar = tienePermiso('listas_precios', 'editar');
  // Los precios son importes: se ven con permiso de facturación o con permiso para editar la lista.
  const puedeVerPrecios = tienePermiso('facturacion', 'ver') || puedeEditar;

  // Sin "loud" version con setCargando(true): las mutaciones de precios en esta
  // pantalla actualizan `precios` en el momento (setPrecios(prev => ...)), no
  // recargan la página entera.
  useEffect(() => {
    Promise.all([obtenerListaDetalle(id), obtenerProductos()])
      .then(([detalle, prods]) => {
        if (detalle) {
          setLista(detalle.lista);
          setPrecios(detalle.precios);
        }
        setProductos(prods);
      })
      .finally(() => setCargando(false));
  }, [id]);

  // productos que aún no tienen precio en esta lista
  const productosDisponibles = useMemo(() => {
    const yaConPrecio = new Set(precios.map(p => p.productoId));
    return productos.filter(p => p.activo && !yaConPrecio.has(p.id));
  }, [productos, precios]);

  const kpis = useMemo(() => derivarKpisPreciosLista(precios, productos), [precios, productos]);
  const categoriaPorProducto = useMemo(
    () => new Map(productos.map(p => [p.id, p.tipoMaterialNombre ?? null])),
    [productos],
  );

  const guardarPrecio = async (productoId: string, valorCrudo: string) => {
    const valor = Number(valorCrudo);
    if (!Number.isFinite(valor) || valor < 0) {
      toast.errorMsg('El precio no puede ser negativo.');
      return;
    }
    const result = await upsertPrecioEnLista(id, productoId, valor);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setPrecios(prev => prev.map(p => (p.productoId === productoId ? result.precio : p)));
    setEditado(prev => { const n = { ...prev }; delete n[productoId]; return n; });
    toast.exito('Precio actualizado.');
  };

  const handleAgregar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = Number(nuevoPrecio);
    if (!nuevoProductoId) { toast.errorMsg('Elige un material.'); return; }
    if (!Number.isFinite(valor) || valor < 0) { toast.errorMsg('El precio no puede ser negativo.'); return; }
    const result = await upsertPrecioEnLista(id, nuevoProductoId, valor);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setPrecios(prev => [...prev, result.precio]);
    setNuevoProductoId('');
    setNuevoPrecio('');
    toast.exito('Material agregado a la lista.');
  };

  const handleEliminar = async (p: PrecioLista) => {
    const ok = await confirmar({
      titulo: `Quitar "${p.nombreProducto ?? 'material'}" de la lista`,
      mensaje: 'Se eliminará su precio en esta lista.',
      confirmarLabel: 'Quitar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await eliminarPrecio(id, p.productoId);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setPrecios(prev => prev.filter(x => x.productoId !== p.productoId));
    toast.exito('Material quitado de la lista.');
  };

  const handleReordenar = async (nuevos: PrecioLista[]) => {
    const anteriores = precios;
    setPrecios(nuevos);
    const result = await reordenarPrecios(id, nuevos.map(p => p.productoId));
    if ('error' in result) {
      setPrecios(anteriores);
      toast.errorMsg(result.error);
    }
  };

  const nombreMaterial = (p: PrecioLista) => p.nombreProducto ?? p.productoId;

  const columnas: ColumnaTabla<PrecioLista>[] = [
    {
      clave: 'material',
      titulo: 'Material',
      valorOrden: nombreMaterial,
      celda: p => <span className="font-medium text-text-primary">{nombreMaterial(p)}</span>,
    },
    {
      clave: 'categoria',
      titulo: 'Categoría',
      valorOrden: p => categoriaPorProducto.get(p.productoId) ?? 'Sin categoría',
      celda: p => {
        const nombre = categoriaPorProducto.get(p.productoId);
        const e = estiloCategoria(nombre);
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
            <span aria-hidden="true" style={{ color: e.color }}>{e.simbolo}</span>{nombre ?? 'Sin categoría'}
          </span>
        );
      },
    },
    puedeVerPrecios
      ? {
          clave: 'precio',
          titulo: 'Precio por kg',
          ayuda: 'Cuánto vale cada kilo de este material en esta lista, en USD. Es el que se usa al facturar con esta lista.',
          alinear: 'derecha',
          valorOrden: p => p.precio,
          decimalesCsv: 2,
          celda: p => {
            if (!puedeEditar) return <span className="text-text-primary">{formatearUsdDecimales(p.precio)}</span>;
            const enEdicion = editado[p.productoId] !== undefined;
            const valor = enEdicion ? editado[p.productoId] : String(p.precio);
            return (
              <div className="flex items-center justify-end gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={valor}
                  aria-label={`Precio por kg de ${nombreMaterial(p)}`}
                  onChange={e => setEditado(prev => ({ ...prev, [p.productoId]: e.target.value }))}
                  className="w-28 px-2 py-1.5 bg-surface-alt border border-border rounded-lg text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                {enEdicion && (
                  <button
                    type="button"
                    onClick={() => guardarPrecio(p.productoId, editado[p.productoId])}
                    className={`${BOTON_ICONO} bg-brand-50 text-brand-600 hover:bg-brand-100`}
                    title="Guardar precio"
                    aria-label={`Guardar precio de ${nombreMaterial(p)}`}
                  >
                    <Check size={15} />
                  </button>
                )}
              </div>
            );
          },
        }
      : { clave: 'precio', titulo: 'Precio por kg', alinear: 'derecha', valorCsv: false, celda: () => <SinPermiso /> },
    {
      clave: 'cargado',
      titulo: 'Cargado el',
      ayuda: 'Fecha en que se agregó este precio a la lista. No cambia si después modificas el precio.',
      valorOrden: p => p.createdAt,
      celda: p => formatearFecha(p.createdAt),
      valorCsv: p => formatearFecha(p.createdAt),
      ocultaEnMovil: true,
    },
    ...(puedeEditar
      ? [{
          clave: 'acciones',
          titulo: 'Acciones',
          valorCsv: false as const,
          celda: (p: PrecioLista) => (
            <button
              type="button"
              onClick={() => handleEliminar(p)}
              className={`${BOTON_ICONO} hover:bg-red-50 hover:text-red-600`}
              title="Quitar de la lista"
              aria-label={`Quitar ${nombreMaterial(p)} de la lista`}
            >
              <Trash2 size={15} />
            </button>
          ),
        }]
      : []),
  ];

  if (cargando) {
    return (
      <div className="max-w-7xl">
        <EncabezadoPagina titulo="Lista de precios" subtitulo="Cargando…" />
        <SkeletonKpis cantidad={3} />
        <SkeletonBloque alto="h-56" conMargen etiqueta="Cargando precios" />
      </div>
    );
  }

  if (!lista) {
    return (
      <div className="max-w-7xl">
        <EncabezadoPagina titulo="Lista de precios" migas={[{ etiqueta: 'Listas de precios', to: '/listas-precios' }, { etiqueta: 'No encontrada' }]} />
        <EstadoVacio
          mensaje="No se encontró la lista"
          descripcion="Puede que se haya eliminado o que el enlace esté incompleto."
          accion={{ etiqueta: 'Volver a listas de precios', to: '/listas-precios' }}
        />
      </div>
    );
  }

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const tipoTexto = lista.tipo === 'venta' ? 'venta' : 'compra';

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina
        titulo={lista.nombre}
        subtitulo={`Lista de ${tipoTexto} · ${lista.vigenteDesde ? `vigente desde ${formatearFecha(lista.vigenteDesde)}` : 'sin fecha de vigencia'}`}
        migas={[{ etiqueta: 'Listas de precios', to: '/listas-precios' }, { etiqueta: lista.nombre }]}
        acciones={!lista.activo ? <Insignia tono="neutral">Inactiva</Insignia> : undefined}
      />

      <section aria-label="Indicadores principales" className="print:hidden">
        <GrillaKpis>
          <TarjetaKpi
            titulo="Materiales con precio"
            icono={<PackageCheck size={16} />}
            ayuda="Cuántos materiales tienen un precio por kilo en esta lista. Debajo se indica cuántos productos activos del catálogo todavía no tienen precio en ella."
            valor={`${formatearNumero(kpis.conPrecio, 0)} ${kpis.conPrecio === 1 ? 'material' : 'materiales'}`}
            subtitulo={kpis.activosSinPrecio > 0
              ? `${formatearNumero(kpis.activosSinPrecio, 0)} productos activos sin precio`
              : 'todos los productos activos tienen precio'}
            comparacion={null}
          />
          <TarjetaKpi
            titulo="Precio promedio"
            icono={<Coins size={16} />}
            ayuda="Se suman los precios por kilo de todos los materiales de esta lista y se divide entre cuántos son (USD por kg). Todos los materiales valen igual: no importa cuántos kilos se compren o vendan de cada uno. Debajo se muestran el precio más bajo y el más alto. Solo se ve con permiso de facturación."
            estado={!puedeVerPrecios ? 'sinPermiso' : kpis.promedio === null ? 'vacio' : 'listo'}
            mensajeVacio="Todavía no hay precios cargados"
            valor={kpis.promedio === null ? undefined : `${formatearUsdDecimales(kpis.promedio)} / kg`}
            subtitulo={kpis.minimo !== null && kpis.maximo !== null
              ? `mínimo ${formatearUsdDecimales(kpis.minimo)} · máximo ${formatearUsdDecimales(kpis.maximo)}`
              : undefined}
            comparacion={null}
          />
          <TarjetaKpi
            titulo="Último precio cargado"
            icono={<CalendarClock size={16} />}
            ayuda="Fecha en que se agregó a esta lista el precio más nuevo (la columna “Cargado el” de la tabla). Si cambias un precio que ya existía, esta fecha no se mueve: el sistema guarda cuándo se agregó cada precio, no cuándo se modificó."
            estado={kpis.ultimoPrecioCargado ? 'listo' : 'vacio'}
            mensajeVacio="Todavía no hay precios cargados"
            valor={formatearFecha(kpis.ultimoPrecioCargado)}
            subtitulo="cuándo se agregó el precio más nuevo"
            comparacion={null}
          />
        </GrillaKpis>
      </section>

      {/* Alta de material */}
      {puedeEditar && (
        <div className="print:hidden">
          <Bloque titulo="Agregar material" queEstasViendo="elige un material que todavía no tiene precio en esta lista y escribe cuánto vale cada kilo, en USD.">
            <form
              onSubmit={handleAgregar}
              className="bg-surface rounded-xl border border-border p-4 flex flex-col sm:flex-row gap-3 sm:items-end"
            >
              <div className="flex-1">
                <label htmlFor={ID_CAMPO_MATERIAL} className="block text-xs font-medium text-text-secondary mb-1">Material</label>
                <select
                  id={ID_CAMPO_MATERIAL}
                  value={nuevoProductoId}
                  onChange={e => setNuevoProductoId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">{productosDisponibles.length === 0 ? 'Todos los productos activos ya tienen precio' : 'Elige un material...'}</option>
                  {productosDisponibles.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="w-full sm:w-40">
                <label htmlFor="lista-nuevo-precio" className="block text-xs font-medium text-text-secondary mb-1">Precio por kg</label>
                <input
                  id="lista-nuevo-precio"
                  type="number"
                  step="0.01"
                  min="0"
                  value={nuevoPrecio}
                  onChange={e => setNuevoPrecio(e.target.value)}
                  className={inputClass}
                  placeholder="0.00"
                />
              </div>
              <button
                type="submit"
                className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Plus size={18} />
                Agregar
              </button>
            </form>
          </Bloque>
        </div>
      )}

      {/* Tabla de precios */}
      <Bloque
        titulo="Precios de la lista"
        queEstasViendo={puedeVerPrecios
          ? 'cuánto vale cada kilo de cada material, en USD, en esta lista. Ordena por cualquier columna y exporta a CSV.'
          : 'los materiales de esta lista. Los precios solo los ve quien tiene permiso de facturación.'}
        acciones={puedeEditar && precios.length > 1 ? (
          <button
            type="button"
            onClick={() => setReordenando(v => !v)}
            className="print:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-text-secondary hover:bg-surface-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <ArrowUpDown size={15} aria-hidden="true" />
            {reordenando ? 'Listo' : 'Reordenar'}
          </button>
        ) : undefined}
      >
        {reordenando && <ReordenarPreciosPanel precios={precios} onReordenar={handleReordenar} />}
        {!reordenando && <Suspense fallback={<SkeletonBloque alto="h-56" etiqueta="Cargando tabla de precios" />}>
          <TablaDatos
            titulo={`Precios de ${lista.nombre}`}
            columnas={columnas}
            filas={precios}
            claveFila={p => p.id}
            etiquetaFila={nombreMaterial}
            anchoMinimo="min-w-[36rem]"
            exportar={puedeVerPrecios ? { nombreArchivo: `precios-${lista.nombre}` } : undefined}
            vacio={{
              mensaje: 'Esta lista no tiene materiales todavía',
              descripcion: 'Agrega los materiales con su precio por kilo; después podrás elegir esta lista al facturar.',
              accion: puedeEditar
                ? { etiqueta: 'Agregar el primer material', onClick: () => document.getElementById(ID_CAMPO_MATERIAL)?.focus() }
                : undefined,
            }}
          />
        </Suspense>}
      </Bloque>
    </div>
  );
}

export default ListaDetallePage;
