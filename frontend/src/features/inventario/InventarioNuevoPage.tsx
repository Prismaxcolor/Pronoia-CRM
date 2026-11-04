import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Recycle, RefreshCw } from 'lucide-react';
import { obtenerResumenInventario, type ResumenInventario } from '../../services/inventario-resumen-service';
import { fechaCorteSaldo, filtrosAUrl, filtrosDesdeUrl, parametrosResumen, rotuloSaldo, type FiltrosPantalla } from '../../lib/inventario-nuevo';
import { avisosSinDinero } from '../../lib/inventario-pantalla';
import BarraFiltros from './nuevo/BarraFiltros';
import GestionarMenu from './nuevo/GestionarMenu';
import KpisInventario, { KpisSkeleton } from './nuevo/KpisInventario';
import ProximoContenedor from './nuevo/ProximoContenedor';
import TablaDetalleInventario from './nuevo/TablaDetalleInventario';
import { BotonAccion, EncabezadoPagina, SkeletonBloque } from '../../components/ui';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

// Orden de la pantalla: filtros -> KPIs -> detalle -> vistas -> alertas -> próximo contenedor.
// El detalle se importa directo (sin lazy ni retardo) para que se vea de inmediato; lo demás se carga aparte.
const VistasCategorias = lazy(() => import('./nuevo/VistasCategorias'));
const AlertasInventario = lazy(() => import('./nuevo/AlertasInventario'));

function BloqueSkeleton({ alto = 'h-48' }: { alto?: string }) {
  return <SkeletonBloque alto={alto} conMargen etiqueta="Cargando bloque" />;
}

/** Rótulo fijo de la pantalla con fecha: «Saldo al dd/mm/aaaa», solo lectura y qué tan exacto es. */
function AvisoSaldoAFecha({ saldoAl }: { saldoAl: string }) {
  return (
    <div role="status" className="mb-6 flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
      <CalendarClock size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">{rotuloSaldo(saldoAl)} · solo lectura</p>
        <p className="mt-0.5 text-xs">
          Son los kg que tenía cada producto y lote al cierre de ese día, armados con los movimientos registrados hasta esa fecha.
          Si después se corrigieron pesos o fechas, el saldo usa el dato corregido. Aquí no se pueden registrar cambios.
          Para volver al stock de hoy, quita el filtro de fechas.
        </p>
      </div>
    </div>
  );
}

function InventarioNuevoPage() {
  const [params, setParams] = useSearchParams();
  const filtros = useMemo(() => filtrosDesdeUrl(params), [params]);
  const [resumen, setResumen] = useState<ResumenInventario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionCarga, setVersionCarga] = useState(0);
  const [claveCargada, setClaveCargada] = useState<string | null>(null);

  const desde = filtros.desde;
  const hasta = filtros.hasta;
  // Un «hasta» anterior a hoy muestra el SALDO al cierre de ese día: pantalla de solo lectura.
  const corte = fechaCorteSaldo(filtros);
  const claveActual = `${desde ?? ''}|${hasta ?? ''}|${versionCarga}`;
  const cargando = claveCargada !== claveActual;
  useEffect(() => {
    let cancelado = false;
    obtenerResumenInventario({ ...parametrosResumen({ desde, hasta }), sinValor: true }).then(r => {
      if (cancelado) return;
      if ('error' in r) { setError(r.error); } else { setResumen(r.resumen); setError(null); }
      setClaveCargada(claveActual);
    });
    return () => { cancelado = true; };
  }, [desde, hasta, claveActual]);

  const recargar = useCallback(() => setVersionCarga(v => v + 1), []);

  const cambiarFiltros = useCallback((cambios: Partial<FiltrosPantalla>) => {
    setParams(prev => filtrosAUrl({ ...filtrosDesdeUrl(prev), ...cambios }), { replace: true });
  }, [setParams]);
  const limpiarFiltros = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  // Vistas y alertas esperan al resumen (sin temporizador): así el detalle pide sus datos primero.
  const secundariosListos = resumen !== null || error !== null;

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina lecturas={LECTURAS.inventario}
        titulo="Inventario"
        subtitulo="Cuánto hay, dónde está, qué está listo para salir y qué se pierde en el proceso."
        acciones={
          corte ? undefined : (
            <>
              <GestionarMenu />
              <BotonAccion to="/transformaciones" icono={<Recycle size={16} />}>Registrar transformación</BotonAccion>
            </>
          )
        }
      />

      <BarraFiltros filtros={filtros} onCambiar={cambiarFiltros} onLimpiar={limpiarFiltros} />

      {corte && <AvisoSaldoAFecha saldoAl={corte} />}

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
          {avisosSinDinero(resumen.avisos).length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{avisosSinDinero(resumen.avisos).map(a => <li key={a}>{a}</li>)}</ul>}
        </div>
      )}

      <section aria-label="Indicadores principales">
        {resumen
          ? <div className={cargando ? 'opacity-60 transition-opacity' : ''}><KpisInventario resumen={resumen} filtros={filtros} recarga={versionCarga} /></div>
          : !error && <KpisSkeleton />}
      </section>

      <TablaDetalleInventario filtros={filtros} recarga={versionCarga} />

      {secundariosListos ? (
        <>
          <Suspense fallback={<BloqueSkeleton />}><VistasCategorias filtros={filtros} resumen={resumen} recarga={versionCarga} /></Suspense>
          {!corte && <Suspense fallback={<BloqueSkeleton alto="h-32" />}><AlertasInventario filtros={filtros} resumen={resumen} /></Suspense>}
        </>
      ) : (
        !error && <BloqueSkeleton alto="h-64" />
      )}

      {!corte && (resumen ? <div id="proximo-contenedor"><ProximoContenedor resumen={resumen} onCambio={recargar} /></div> : !error && <BloqueSkeleton alto="h-56" />)}

    </div>
  );
}

export default InventarioNuevoPage;
