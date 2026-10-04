import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Recycle, RefreshCw } from 'lucide-react';
import { obtenerResumenInventario, type ResumenInventario } from '../../services/inventario-resumen-service';
import { filtrosAUrl, filtrosDesdeUrl, parametrosResumen, type FiltrosPantalla } from '../../lib/inventario-nuevo';
import BarraFiltros from './nuevo/BarraFiltros';
import GestionarMenu from './nuevo/GestionarMenu';
import KpisInventario, { KpisSkeleton } from './nuevo/KpisInventario';
import ProximoContenedor from './nuevo/ProximoContenedor';

// Lo pesado se carga aparte y después de los KPIs (ranuras que construye otro agente).
const FlujoSankey = lazy(() => import('./nuevo/FlujoSankey'));
const VistasCategorias = lazy(() => import('./nuevo/VistasCategorias'));
const TablaDetalleInventario = lazy(() => import('./nuevo/TablaDetalleInventario'));
const AlertasInventario = lazy(() => import('./nuevo/AlertasInventario'));

/** Espera antes de montar los bloques pesados, para que los KPIs pinten primero. */
const RETARDO_BLOQUES_PESADOS_MS = 150;

function BloqueSkeleton({ alto = 'h-48' }: { alto?: string }) {
  return <div className={`mb-8 ${alto} animate-pulse rounded-xl border border-border bg-surface-alt`} aria-busy="true" aria-label="Cargando bloque" />;
}

function InventarioNuevoPage() {
  const [params, setParams] = useSearchParams();
  const filtros = useMemo(() => filtrosDesdeUrl(params), [params]);

  const [resumen, setResumen] = useState<ResumenInventario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionCarga, setVersionCarga] = useState(0);
  const [mostrarPesados, setMostrarPesados] = useState(false);
  const [claveCargada, setClaveCargada] = useState<string | null>(null);

  const desde = filtros.desde;
  const hasta = filtros.hasta;
  const claveActual = `${desde ?? ''}|${hasta ?? ''}|${versionCarga}`;
  const cargando = claveCargada !== claveActual;
  useEffect(() => {
    let cancelado = false;
    obtenerResumenInventario(parametrosResumen({ desde, hasta })).then(r => {
      if (cancelado) return;
      if ('error' in r) { setError(r.error); } else { setResumen(r.resumen); setError(null); }
      setClaveCargada(claveActual);
    });
    return () => { cancelado = true; };
  }, [desde, hasta, claveActual]);

  useEffect(() => {
    if (!resumen) return;
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, [resumen]);

  const recargar = useCallback(() => setVersionCarga(v => v + 1), []);

  const cambiarFiltros = useCallback((cambios: Partial<FiltrosPantalla>) => {
    setParams(prev => filtrosAUrl({ ...filtrosDesdeUrl(prev), ...cambios }), { replace: true });
  }, [setParams]);
  const limpiarFiltros = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return (
    <div className="max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Inventario</h1>
          <p className="mt-1 text-sm text-text-secondary">Cuánto hay, cuánto vale, qué está listo para salir y qué se pierde en el proceso.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GestionarMenu />
          <Link to="/transformaciones" className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Recycle size={16} aria-hidden="true" /> Registrar transformación
          </Link>
        </div>
      </div>

      <BarraFiltros filtros={filtros} onCambiar={cambiarFiltros} onLimpiar={limpiarFiltros} />

      {error && (
        <div role="alert" className="mb-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">No se pudo cargar el resumen del inventario.</p>
          <p className="mt-0.5 text-xs">{error}</p>
          <button type="button" onClick={recargar} className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-red-100">
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      {resumen?.parcial && (
        <div role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Algunas cifras pueden estar incompletas.</p>
          {resumen.avisos.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{resumen.avisos.map(a => <li key={a}>{a}</li>)}</ul>}
        </div>
      )}

      {/* En móvil, KPIs y "Próximo contenedor" van primero: son los primeros bloques del orden natural. */}
      <section aria-label="Indicadores principales">
        {resumen ? <div className={cargando ? 'opacity-60 transition-opacity' : ''}><KpisInventario resumen={resumen} /></div> : !error && <KpisSkeleton />}
      </section>

      {resumen ? <div id="proximo-contenedor"><ProximoContenedor resumen={resumen} onCambio={recargar} /></div> : !error && <BloqueSkeleton alto="h-56" />}

      {mostrarPesados ? (
        <>
          <Suspense fallback={<BloqueSkeleton />}><FlujoSankey filtros={filtros} resumen={resumen} /></Suspense>
          <Suspense fallback={<BloqueSkeleton />}><VistasCategorias filtros={filtros} resumen={resumen} /></Suspense>
          <Suspense fallback={<BloqueSkeleton alto="h-64" />}><TablaDetalleInventario filtros={filtros} resumen={resumen} /></Suspense>
          <Suspense fallback={<BloqueSkeleton alto="h-32" />}><AlertasInventario filtros={filtros} resumen={resumen} /></Suspense>
        </>
      ) : (
        !error && <BloqueSkeleton alto="h-64" />
      )}
    </div>
  );
}

export default InventarioNuevoPage;
