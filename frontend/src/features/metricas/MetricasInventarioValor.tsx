import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import type { CostosInventario } from '@shared/types/inventario-pantalla.js';
import { obtenerCostosInventario, obtenerDetallePantalla } from '../../services/inventario-pantalla-service';
import { obtenerResumenInventario } from '../../services/inventario-resumen-service';
import { useAuth } from '../../hooks/use-auth-context';
import { Bloque, BotonAccion, EstadoVacio, SkeletonBloque, SkeletonKpis, useFiltrosUrl } from '../../components/ui';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import { parametrosPantalla } from '../../lib/inventario-pantalla';
import { useDashboardCarga } from '../dashboard/useDashboardCarga';
import { ErrorDeBloque } from '../dashboard/DashboardComun';
import CostosEditorPanel from '../inventario/nuevo/CostosEditorPanel';
import InventarioValorKpis, { type EstadoVenta } from './InventarioValorKpis';
import InventarioValorTabla from './InventarioValorTabla';
import PreciosLotesEditor from './PreciosLotesEditor';
import { resumirValor, valorPorAlmacen, type ProductoValor } from './lib/inventario-valor-kpis';

// Las gráficas y la tabla se cargan aparte y después de los indicadores.
const ValorPorCategoria = lazy(() => import('./InventarioValorGraficas').then(m => ({ default: m.ValorPorCategoria })));
const ValorPorAlmacen = lazy(() => import('./InventarioValorGraficas').then(m => ({ default: m.ValorPorAlmacen })));
const TopProductos = lazy(() => import('./InventarioValorGraficas').then(m => ({ default: m.TopProductos })));

const ESQUEMA: EsquemaFiltros = {
  campos: { q: { tipo: 'texto' }, categoria: { tipo: 'texto' }, soloSinCosto: { tipo: 'bandera' } },
};
const RETARDO_BLOQUES_PESADOS_MS = 150;
const MAX_FILAS_DETALLE = 2000;
const PARAMS_DETALLE = parametrosPantalla({}, { limite: MAX_FILAS_DETALLE, incluirClasificaciones: true });

async function pedir<T>(r: Promise<{ dato: T } | { error: string }>): Promise<T> {
  const res = await r;
  if ('error' in res) throw new Error(res.error);
  return res.dato;
}

const texto = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

function MetricasInventarioValor() {
  const { tienePermiso } = useAuth();
  const puedeVer = tienePermiso('facturacion', 'ver');
  const puedeEditar = tienePermiso('facturacion', 'editar');
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA);
  const [editorAbierto, setEditorAbierto] = useState(false);

  const costos = useDashboardCarga<CostosInventario>({ permitido: puedeVer, cargar: () => pedir(obtenerCostosInventario()) });
  const resumenInv = useDashboardCarga({
    permitido: puedeVer,
    cargar: async () => {
      const r = await obtenerResumenInventario();
      if ('error' in r) throw new Error(r.error);
      return r.resumen;
    },
  });

  const [mostrarPesados, setMostrarPesados] = useState(false);
  useEffect(() => {
    if (costos.estado !== 'listo') return;
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, [costos.estado]);

  const detalle = useDashboardCarga({
    permitido: puedeVer,
    habilitado: mostrarPesados,
    cargar: () => pedir(obtenerDetallePantalla(PARAMS_DETALLE)),
  });

  const { recargar: recargarCostos } = costos;
  const { recargar: recargarResumen } = resumenInv;
  const { recargar: recargarDetalle } = detalle;
  const refrescarTodo = useCallback(() => { recargarCostos(); recargarResumen(); recargarDetalle(); }, [recargarCostos, recargarResumen, recargarDetalle]);
  const refrescarLotes = useCallback(() => { recargarResumen(); }, [recargarResumen]);

  const productos = useMemo<ProductoValor[]>(() => (costos.estado === 'listo' ? costos.dato.productos : []), [costos]);
  const resumen = useMemo(() => resumirValor(productos), [productos]);
  const almacenes = useMemo(() => (detalle.estado === 'listo' ? valorPorAlmacen(detalle.dato.filas, productos) : []), [detalle, productos]);

  const venta: EstadoVenta = resumenInv.estado === 'listo'
    ? { estado: 'listo', dato: resumenInv.dato.valor ? resumenInv.dato.valor.ventaEstimadaLotes : null }
    : resumenInv.estado === 'error' ? { estado: 'error', mensaje: resumenInv.mensaje } : { estado: 'cargando' };

  if (!puedeVer) {
    return <EstadoVacio mensaje="Sin permiso para ver el inventario valorizado" descripcion="Los costos y valores solo los ven quienes tienen permiso de facturación. Pídele a un administrador acceso." />;
  }

  const soloSinCosto = filtros.soloSinCosto === true;

  return (
    <div>
      <Bloque
        titulo="Resumen del inventario"
        queEstasViendo="cuánto dinero hay hoy en los galpones. Es una foto de AHORA (no un periodo): cada producto con stock se multiplica por su costo por kg. El valor estimado de venta de los lotes se muestra aparte y nunca se suma al costo."
        acciones={<BotonAccion variante="secundario" onClick={() => setEditorAbierto(true)} icono={<Pencil size={16} />}>{puedeEditar ? 'Editar costos' : 'Ver costos'}</BotonAccion>}
      >
        {costos.estado === 'cargando' && <SkeletonKpis />}
        {costos.estado === 'error' && <ErrorDeBloque mensaje={costos.mensaje} onReintentar={costos.recargar} />}
        {costos.estado === 'listo' && (
          <InventarioValorKpis resumen={resumen} venta={venta} onEditarCostos={() => setEditorAbierto(true)} />
        )}
        {venta.estado === 'error' && costos.estado === 'listo' && (
          <div className="mt-3"><ErrorDeBloque mensaje={venta.mensaje} onReintentar={resumenInv.recargar} /></div>
        )}
      </Bloque>

      {costos.estado === 'listo' && (
        <>
          {productos.length === 0 ? (
            <EstadoVacio mensaje="No hay material con stock en los galpones" descripcion="El valor se calcula con lo que hay hoy. Registra una compra para que aparezca." accion={{ etiqueta: 'Ir a Inventario', to: '/inventario' }} />
          ) : mostrarPesados ? (
            <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2 print:block">
              <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráfica" />}><ValorPorCategoria productos={productos} /></Suspense>
              {detalle.estado === 'listo' && <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráfica" />}><ValorPorAlmacen almacenes={almacenes} /></Suspense>}
              {detalle.estado === 'cargando' && <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando valor por almacén" />}
              {detalle.estado === 'error' && (
                <Bloque titulo="Valor por almacén" queEstasViendo="cuánto vale a costo el material de cada galpón.">
                  <ErrorDeBloque mensaje={detalle.mensaje} onReintentar={detalle.recargar} />
                </Bloque>
              )}
              <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráfica" />}><TopProductos productos={productos} /></Suspense>
            </div>
          ) : (
            <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />
          )}

          <div className="print:hidden">
            <PreciosLotesEditor puedeEditar={puedeEditar} onGuardado={refrescarLotes} />
          </div>

          <InventarioValorTabla
            productos={productos}
            q={texto(filtros.q)}
            categoria={texto(filtros.categoria)}
            soloSinCosto={soloSinCosto}
            onFiltros={c => cambiar({ ...c })}
            onLimpiar={limpiar}
          />
          <p className="print:hidden text-xs text-text-muted">
            Para ver el detalle del stock (lotes, etapas, antigüedad) ve a <Link to="/inventario" className="font-medium text-brand-700 underline underline-offset-2">Inventario</Link>.
          </p>
        </>
      )}

      <CostosEditorPanel
        abierto={editorAbierto}
        onCerrar={() => setEditorAbierto(false)}
        onGuardado={refrescarTodo}
        puedeEditar={puedeEditar}
      />
    </div>
  );
}

export default MetricasInventarioValor;
