import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Recycle, Scale } from 'lucide-react';
import { useAuth } from '../../hooks/use-auth-context';
import { BotonAccion, EncabezadoPagina, SkeletonBloque } from '../../components/ui';
import { fechaLocalIso } from '../../lib/dashboard-kpis';
import DashboardKpis from './DashboardKpis';
import DashboardAlertas from './DashboardAlertas';
import ProximosDespachos from './ProximosDespachos';
import { useDashboardCarga } from './useDashboardCarga';
import { cargarBancas, cargarMerma, cargarSaldosProveedores, cargarSemanasKg, cargarTickets, cargarTomasAbiertas } from './dashboardFuentes';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

// Las gráficas se cargan aparte y después de los indicadores.
const TendenciaKg = lazy(() => import('./DashboardGraficas').then(m => ({ default: m.TendenciaKg })));
const SaldoBancas = lazy(() => import('./DashboardGraficas').then(m => ({ default: m.SaldoBancas })));

/** Espera antes de pedir lo pesado (resumen de inventario) y de montar las gráficas, para que los indicadores pinten primero. */
const RETARDO_BLOQUES_PESADOS_MS = 150;

function DashboardPage() {
  const { tienePermiso } = useAuth();
  const hoy = useMemo(() => fechaLocalIso(new Date()), []);
  const [mostrarPesados, setMostrarPesados] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, []);

  // Cada bloque comprueba SU permiso (la ruta solo exige dashboard:ver) y carga y falla por separado.
  const semanas = useDashboardCarga({ permitido: tienePermiso('dashboard', 'ver'), cargar: () => cargarSemanasKg(hoy) });
  const saldos = useDashboardCarga({ permitido: tienePermiso('proveedores', 'ver'), cargar: cargarSaldosProveedores });
  const tickets = useDashboardCarga({ permitido: tienePermiso('pesaje', 'ver'), cargar: () => cargarTickets(Date.now()) });
  const bancas = useDashboardCarga({ permitido: tienePermiso('cochinito', 'ver'), cargar: cargarBancas });
  const tomas = useDashboardCarga({ permitido: tienePermiso('toma_fisica', 'ver'), cargar: cargarTomasAbiertas });
  const merma = useDashboardCarga({ permitido: tienePermiso('productos', 'ver'), habilitado: mostrarPesados, cargar: cargarMerma });

  const puedePesar = tienePermiso('pesaje', 'crear');
  const puedeComprar = tienePermiso('facturacion', 'crear');
  const puedeTransformar = tienePermiso('transformaciones', 'crear');

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina lecturas={LECTURAS.dashboard}
        titulo="Dashboard"
        subtitulo="Cómo va la operación hoy: lo que se compró, lo que está pendiente, lo que se debe y lo que necesita atención."
        acciones={(puedePesar || puedeComprar || puedeTransformar) ? (
          <>
            {puedePesar && <BotonAccion to="/pesaje" icono={<Scale size={16} />}>Nuevo pesaje</BotonAccion>}
            {puedeComprar && <BotonAccion to="/compras/nueva" variante="secundario" icono={<FilePlus2 size={16} />}>Nueva compra</BotonAccion>}
            {puedeTransformar && <BotonAccion to="/transformaciones" variante="secundario" icono={<Recycle size={16} />}>Registrar transformación</BotonAccion>}
          </>
        ) : undefined}
      />

      <section aria-label="Indicadores principales">
        <DashboardKpis semanas={semanas} saldos={saldos} tickets={tickets} bancas={bancas} puedeFacturar={puedeComprar} />
      </section>

      <DashboardAlertas tickets={tickets} tomas={tomas} merma={merma} />

      {mostrarPesados ? (
        <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
          <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráfica" />}><TendenciaKg semanas={semanas} /></Suspense>
          <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráfica" />}><SaldoBancas bancas={bancas} /></Suspense>
        </div>
      ) : (
        <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />
      )}

      <ProximosDespachos />

      {/* Indicio de dónde profundizar: Métricas lleva el análisis de compras por material y proveedor. */}
      <p className="mb-8 text-xs text-text-secondary print:hidden">
        Para comparar periodos y ver compras por material o proveedor, abre <Link to="/metricas" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Métricas</Link>.
      </p>
    </div>
  );
}

export default DashboardPage;
