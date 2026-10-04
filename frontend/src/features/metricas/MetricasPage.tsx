import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { obtenerMetricasCompras, type MetricaCompraLinea } from '../../services/metricas-service';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import { useAuth } from '../../hooks/use-auth-context';
import CompartirBoton from '../../components/CompartirBoton';
import {
  BotonAccion, Bloque, EncabezadoPagina, EstadoVacio, FiltrosBarra, SkeletonBloque, SkeletonKpis, formatearFecha, useFiltrosUrl,
} from '../../components/ui';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import { rangoDeAtajo, hoyLocal } from '../../lib/rango-fechas';
import { FECHA_INICIO_DATOS_REALES } from '../../lib/dashboard-kpis';
import { anteriorEsComparable, diasEntre, rangoAnterior, resumirCompras } from '../../lib/metricas-kpis';
import { useDashboardCarga } from '../dashboard/useDashboardCarga';
import { ErrorDeBloque } from '../dashboard/DashboardComun';
import MetricasKpis from './MetricasKpis';
import MetricasListas, { type VistaMetricas } from './MetricasListas';

// Las gráficas se cargan aparte y después de los indicadores.
const TendenciaCompras = lazy(() => import('./MetricasGraficas').then(m => ({ default: m.TendenciaCompras })));
const RepartoKg = lazy(() => import('./MetricasGraficas').then(m => ({ default: m.RepartoKg })));

const VISTAS = ['material', 'proveedor'] as const;
/** Parámetros de URL de esta pantalla: se AÑADEN (desde, hasta, vista, material, proveedor, q); la clave de sesión
 *  pronoia:metricas:vista se conserva y sigue recordando la última vista elegida. */
const ESQUEMA: EsquemaFiltros = {
  campos: {
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    vista: { tipo: 'opcion', opciones: VISTAS },
    material: { tipo: 'texto' },
    proveedor: { tipo: 'texto' },
    q: { tipo: 'texto' },
  },
  rangos: [['desde', 'hasta']],
};
const ATAJOS = ['7d', '30d', 'mes', 'todo'] as const;
const RETARDO_BLOQUES_PESADOS_MS = 150;

interface DatosPeriodo { actual: MetricaCompraLinea[]; anterior: MetricaCompraLinea[] }

const texto = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

function MetricasPage() {
  const { tienePermiso } = useAuth();
  const puedeVerCostos = tienePermiso('facturacion', 'ver');
  const puedeRegistrar = tienePermiso('pesaje', 'crear');
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA);
  const [vistaGuardada, setVistaGuardada] = usePestanaRecordada<VistaMetricas>('pronoia:metricas:vista', VISTAS, 'material');

  // Sin rango en la URL: últimos 30 días (igual que antes). Una URL con rango inválido se trata como "sin rango".
  const hoy = useMemo(() => hoyLocal(), []);
  const porDefecto = useMemo(() => rangoDeAtajo('30d', hoy), [hoy]);
  const desde = texto(filtros.desde) ?? porDefecto.desde;
  const hasta = texto(filtros.hasta) ?? porDefecto.hasta;
  const vista = (texto(filtros.vista) as VistaMetricas | undefined) ?? vistaGuardada;
  const material = texto(filtros.material);
  const proveedor = texto(filtros.proveedor);
  const busqueda = texto(filtros.q);

  const anterior = useMemo(() => rangoAnterior(desde, hasta), [desde, hasta]);
  const carga = useDashboardCarga<DatosPeriodo>({
    permitido: tienePermiso('dashboard', 'ver'),
    clave: `${desde}|${hasta}`,
    cargar: async () => {
      const [actual, previo] = await Promise.all([obtenerMetricasCompras(desde, hasta), obtenerMetricasCompras(anterior.desde, anterior.hasta)]);
      return { actual, anterior: previo };
    },
  });

  const [mostrarPesados, setMostrarPesados] = useState(false);
  useEffect(() => {
    if (carga.estado !== 'listo') return;
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, [carga.estado]);

  const lineas = carga.estado === 'listo' ? carga.dato.actual : null;
  const lineasAnterior = carga.estado === 'listo' ? carga.dato.anterior : null;
  const resumen = useMemo(() => resumirCompras(lineas ?? []), [lineas]);
  const resumenAnterior = useMemo(() => resumirCompras(lineasAnterior ?? []), [lineasAnterior]);
  const comparable = anteriorEsComparable(anterior.desde, lineasAnterior?.length ?? 0);

  const cambiarDetalle = useCallback((c: { vista?: VistaMetricas; material?: string; proveedor?: string }) => {
    if (c.vista) setVistaGuardada(c.vista);
    cambiar({ ...c });
  }, [cambiar, setVistaGuardada]);

  const rangoActivo = Boolean(filtros.desde && filtros.hasta);
  const dias = diasEntre(desde, hasta);
  const inicioReal = formatearFecha(FECHA_INICIO_DATOS_REALES);

  return (
    <div className="print-documento max-w-7xl print:max-w-none">
      <div className="print:hidden">
        <EncabezadoPagina
          titulo="Métricas de compras"
          subtitulo="Cuántos kilos se compraron, a qué costo, a quién y de qué material, comparado con el periodo anterior de la misma duración."
          acciones={
            <>
              <BotonAccion variante="secundario" onClick={() => window.print()} icono={<Printer size={16} />}>Imprimir</BotonAccion>
              <CompartirBoton titulo="Métricas" soloIcono />
            </>
          }
        />
      </div>
      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">Métricas de compras</h1>
        <p className="text-sm">Del {formatearFecha(desde)} al {formatearFecha(hasta)}</p>
      </div>

      <div className="print:hidden">
        <FiltrosBarra
          rango={{ desde: rangoActivo ? desde : undefined, hasta: rangoActivo ? hasta : undefined, atajos: ATAJOS, onCambiar: r => cambiar({ desde: r.desde, hasta: r.hasta }) }}
          buscador={{ id: 'metricas-buscar', valor: busqueda, etiqueta: vista === 'material' ? 'Buscar material' : 'Buscar proveedor', placeholder: vista === 'material' ? 'Nombre del material…' : 'Nombre del proveedor…', onCambiar: v => cambiar({ q: v }) }}
          onLimpiar={limpiar}
        />
      </div>

      {carga.estado === 'sinPermiso' && <EstadoVacio mensaje="Sin permiso para ver las métricas" descripcion="Pídele a un administrador acceso al dashboard." />}
      {carga.estado === 'error' && <div className="mb-8"><ErrorDeBloque mensaje={carga.mensaje} onReintentar={carga.recargar} /></div>}

      {carga.estado === 'cargando' && (
        <>
          <SkeletonKpis />
          <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando métricas" />
        </>
      )}

      {lineas && (
        <>
          <Bloque
            titulo="Resumen del periodo"
            queEstasViendo={`del ${formatearFecha(desde)} al ${formatearFecha(hasta)} (${dias} ${dias === 1 ? 'día' : 'días'}), frente al periodo anterior de la misma duración (${formatearFecha(anterior.desde)} al ${formatearFecha(anterior.hasta)}). ${comparable ? '' : `No se puede comparar: el periodo anterior no tiene compras o empieza antes del ${inicioReal}, cuando comenzó el registro real.`}`}
          >
            <MetricasKpis resumen={resumen} anterior={resumenAnterior} comparable={comparable} puedeVerCostos={puedeVerCostos} desde={desde} hasta={hasta} dias={dias} />
          </Bloque>

          {lineas.length === 0 ? (
            <EstadoVacio
              mensaje="No hay compras confirmadas en este periodo"
              descripcion={`Solo cuentan las compras confirmadas (no borradores ni anuladas). El registro real empieza el ${inicioReal}: prueba con un periodo más amplio.`}
              accion={puedeRegistrar ? { etiqueta: 'Registrar un pesaje', to: '/pesaje' } : undefined}
            />
          ) : (
            <>
              {mostrarPesados ? (
                <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2 print:block">
                  <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráfica" />}><TendenciaCompras lineas={lineas} desde={desde} hasta={hasta} /></Suspense>
                  <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráfica" />}><RepartoKg lineas={lineas} vista={vista} /></Suspense>
                </div>
              ) : (
                <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />
              )}
              <MetricasListas
                lineas={lineas}
                vista={vista}
                material={material}
                proveedor={proveedor}
                busqueda={busqueda}
                puedeVerCostos={puedeVerCostos}
                onCambiar={cambiarDetalle}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

export default MetricasPage;
