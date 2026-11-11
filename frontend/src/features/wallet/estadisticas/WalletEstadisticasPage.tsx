import { Suspense, lazy, useCallback, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { hoyLocal } from '../../../lib/rango-fechas';
import { useCategorias } from '../../cochinito/categorias/useCategorias';
import { useTasasUsd } from '../../cochinito/useTasasUsd';
import PeriodoSelector from '../PeriodoSelector';
import { useCuentasWallet } from '../useCuentasWallet';
import { PERIODO_POR_DEFECTO, periodoDesdeTexto, tituloPeriodo, rangoDePeriodo, type ClavePeriodo } from '../wallet-periodos';
import { useWalletPrefs } from '../wallet-prefs';
import { CompartirContext, type DatosCompartir } from './compartir-contexto';
import { rotuloPeriodo } from './estadisticas-compartir';
import { idPanel, idTab, tabDesdeTexto, usaCategorias, usaMovimientos, usaPeriodo, usaTasas, type ClaveTab } from './estadisticas-tabs';
import AvisoDatosGuardados from './AvisoDatosGuardados';
import PestanasEstadisticas from './PestanasEstadisticas';
import { useContextoEstadisticas } from './useContextoEstadisticas';
import { useMovimientosWallet, usePedidoPersistente } from './useDatosEstadisticas';

const TabSaldo = lazy(() => import('./TabSaldo'));
const TabFlujo = lazy(() => import('./TabFlujo'));
const TabGastos = lazy(() => import('./TabGastos'));
const TabInformes = lazy(() => import('./TabInformes'));
const TabActivos = lazy(() => import('./TabActivos'));

const TAB_COMPONENTE: Readonly<Record<ClaveTab, typeof TabSaldo>> = {
  saldo: TabSaldo, flujo: TabFlujo, gastos: TabGastos, informes: TabInformes, activos: TabActivos,
};

function Esqueleto() {
  return (
    <div aria-busy="true" aria-label="Cargando estadísticas" className="space-y-4">
      <div className="h-40 animate-pulse rounded-2xl bg-w-tarjeta" />
      <div className="h-56 animate-pulse rounded-2xl bg-w-tarjeta" />
    </div>
  );
}

function ErrorCarga({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div role="alert" className="rounded-2xl bg-w-tarjeta p-8 text-center">
      <p className="text-lg font-medium">No se pudieron cargar los datos</p>
      <p className="mt-1 text-sm text-w-texto2">Revisa tu conexión e inténtalo de nuevo. Esto no significa que no haya movimientos.</p>
      <button type="button" onClick={onReintentar} className="mt-4 rounded-lg bg-w-acento px-4 py-2 text-sm font-medium text-w-sobre-acento focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento focus-visible:ring-offset-2 focus-visible:ring-offset-w-tarjeta">
        Reintentar
      </button>
    </div>
  );
}

function Panel({ tab, children }: { tab: ClaveTab; children: ReactNode }) {
  return <div role="tabpanel" id={idPanel(tab)} aria-labelledby={idTab(tab)} tabIndex={0} className="mt-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">{children}</div>;
}

/** Aviso de las pestañas de saldos: el período no les afecta (son los saldos de hoy). */
function NotaSinPeriodo() {
  return <p className="mb-4 rounded-lg border border-w-borde bg-w-grupo px-3 py-2 text-xs text-w-texto2">Esta pestaña muestra los saldos de hoy: el período no la cambia.</p>;
}

/** Estadísticas de la Wallet nueva: saldo, flujo de caja, gastos, informes y activos. Pestaña en `?t=`, período en `?p=`. */
function WalletEstadisticasPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabDesdeTexto(params.get('t'));
  const periodo = periodoDesdeTexto(params.get('p'));
  const { ocultarCantidades, cuentasOcultas } = useWalletPrefs();
  // Con archivadas: para nombrar movimientos de cuentas archivadas. Los saldos y activos solo usan las no archivadas.
  const cuentas = useCuentasWallet(true);
  const movs = useMovimientosWallet(usaMovimientos(tab));
  const categorias = useCategorias(usePedidoPersistente(usaCategorias(tab)));
  const tasas = useTasasUsd(usePedidoPersistente(usaTasas(tab)));
  const hoy = useMemo(() => hoyLocal(), []);

  const cambiarParam = useCallback((clave: string, valor: string, porDefecto: string) => {
    setParams(previos => {
      const nuevos = new URLSearchParams(previos);
      if (valor === porDefecto) nuevos.delete(clave); else nuevos.set(clave, valor);
      return nuevos;
    }, { replace: true });
  }, [setParams]);

  const ctx = useContextoEstadisticas({
    periodo, hoy, movimientos: movs.movimientos, cuentas: cuentas.cuentas, indiceCategorias: categorias.indice, errorCategorias: categorias.error,
    tasaBinance: tasas.tasas.binance?.tasa ?? null, cargandoTasas: tasas.cargando, ocultarCantidades, cuentasOcultas,
  });

  const datosCompartir = useMemo<DatosCompartir>(
    () => ({ rotuloPeriodo: rotuloPeriodo(tituloPeriodo(periodo), rangoDePeriodo(periodo, hoy)), huella: `${periodo}|${ocultarCantidades ? 'oculto' : 'visible'}` }),
    [periodo, hoy, ocultarCantidades],
  );
  const conMovimientos = usaMovimientos(tab);
  // Las cuentas también hacen falta con movimientos: sin ellas todo saldría como "Cuenta archivada u oculta".
  const hayError = cuentas.error || (conMovimientos && movs.error);
  const cargando = cuentas.cargando || (conMovimientos && movs.cargando) || (usaCategorias(tab) && categorias.cargando);
  const Contenido = TAB_COMPONENTE[tab];
  const reintentar = (): void => { cuentas.recargar(); if (conMovimientos) movs.recargar(); };

  return (
    <div>
      {usaPeriodo(tab) && (
        <div className="mb-4 overflow-x-auto">
          <PeriodoSelector valor={periodo} onCambiar={(c: ClavePeriodo) => cambiarParam('p', c, PERIODO_POR_DEFECTO)} />
        </div>
      )}
      <PestanasEstadisticas activa={tab} onCambiar={c => cambiarParam('t', c, 'saldo')} />
      <Panel tab={tab}>
        {hayError ? <ErrorCarga onReintentar={reintentar} /> : cargando ? <Esqueleto /> : (
          <CompartirContext.Provider value={datosCompartir}>
            {!usaPeriodo(tab) && <NotaSinPeriodo />}
            {conMovimientos && <AvisoDatosGuardados onReintentar={movs.recargar} />}
            <Suspense fallback={<Esqueleto />}><Contenido ctx={ctx} /></Suspense>
          </CompartirContext.Provider>
        )}
      </Panel>
    </div>
  );
}

export default WalletEstadisticasPage;
