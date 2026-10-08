import { Suspense, lazy, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './hooks/use-auth';
import { useAuth } from './hooks/use-auth-context';
import { PortalAuthProvider } from './hooks/use-portal-auth';
import { usePortalAuth } from './hooks/use-portal-auth-context';
import { ToastProvider } from './hooks/use-toast';
import { ConfirmProvider } from './hooks/use-confirm';
import { PesajeBorradorProvider } from './hooks/use-pesaje-borrador';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import InstallPwaBanner from './components/InstallPwaBanner';
import PantallaCargando from './components/PantallaCargando';
import { elegirRutaInicial } from './lib/ruta-inicial';
import { consumirRutaDeRegreso } from './lib/ruta-de-regreso';
import AuthPage from './features/auth/AuthPage';

const CLAVE_RECARGA = 'pronoia:recarga-por-chunk';

/** Se muestra cuando un chunk no se pudo descargar ni tras reintentar (típico
 *  tras un deploy: el HTML en caché apunta a archivos que ya no existen). Ofrece
 *  recargar; la marca en sessionStorage evita insistir en bucle si el fallo
 *  persiste después de una recarga. */
function ErrorCargaPantalla() {
  const yaRecargo = (() => {
    try { return sessionStorage.getItem(CLAVE_RECARGA) === '1'; } catch { return false; }
  })();
  const recargar = () => {
    try { sessionStorage.setItem(CLAVE_RECARGA, '1'); } catch { /* sin sessionStorage: se recarga igual */ }
    window.location.reload();
  };
  return (
    <div role="alert" className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold text-text-primary mb-2">No se pudo cargar esta pantalla</h2>
        <p className="text-text-secondary mb-4">
          {yaRecargo
            ? 'Sigue sin cargar después de recargar. Revisa tu conexión e intenta de nuevo en unos minutos; si continúa, avisa a un administrador.'
            : 'Probablemente hay una versión nueva de la aplicación o se cortó la conexión. Recarga la página para continuar.'}
        </p>
        <button type="button" onClick={recargar} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">
          Recargar página
        </button>
      </div>
    </div>
  );
}

/** React.lazy con un reintento ante fallo del import() dinámico. Si falla de
 *  nuevo, resuelve a ErrorCargaPantalla en vez de romper el árbol de React. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyConReintento<T extends ComponentType<any>>(
  importar: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const modulo = await importar().catch(() => importar());
      try { sessionStorage.removeItem(CLAVE_RECARGA); } catch { /* ignorar */ }
      return modulo;
    } catch (error) {
      console.error('Falló la carga diferida de una pantalla', error);
      return { default: ErrorCargaPantalla as unknown as T };
    }
  });
}

const PortalLoginPage = lazyConReintento(() => import('./features/portal/PortalLoginPage'));
const PortalVerificarPage = lazyConReintento(() => import('./features/portal/PortalVerificarPage'));
const PortalHomePage = lazyConReintento(() => import('./features/portal/PortalHomePage'));
const PortalDocumentosPage = lazyConReintento(() => import('./features/portal/PortalDocumentosPage'));
const PortalEstadoCuentaPage = lazyConReintento(() => import('./features/portal/PortalEstadoCuentaPage'));
const PortalPreciosPage = lazyConReintento(() => import('./features/portal/PortalPreciosPage'));
const PortalAgendarPage = lazyConReintento(() => import('./features/portal/PortalAgendarPage'));
const PortalGuiasPage = lazyConReintento(() => import('./features/portal/PortalGuiasPage'));
const AprobarLlavePage = lazyConReintento(() => import('./features/llaves/AprobarLlavePage'));
const SolicitudesLlavePage = lazyConReintento(() => import('./features/llaves/SolicitudesLlavePage'));
const CitasPage = lazyConReintento(() => import('./features/citas/CitasPage'));
const DashboardPage = lazyConReintento(() => import('./features/dashboard/DashboardPage'));
const MetricasPage = lazyConReintento(() => import('./features/metricas/MetricasPage'));
const ProductosPage = lazyConReintento(() => import('./features/productos/ProductosPage'));
const InventarioPage = lazyConReintento(() => import('./features/inventario/InventarioPage'));
const InventarioNuevoPage = lazyConReintento(() => import('./features/inventario/InventarioNuevoPage'));
const TomaFisicaDetallePage = lazyConReintento(() => import('./features/inventario/TomaFisicaDetallePage'));
const ConteoTomaFisicaPage = lazyConReintento(() => import('./features/pesaje/ConteoTomaFisicaPage'));
const TransformacionesPage = lazyConReintento(() => import('./features/transformaciones/TransformacionesPage'));
const TransformacionDetallePage = lazyConReintento(() => import('./features/transformaciones/TransformacionDetallePage'));
const MermaPage = lazyConReintento(() => import('./features/transformaciones/MermaPage'));
const CochinitPage = lazyConReintento(() => import('./features/cochinito/CochinitPage'));
const UsuariosPage = lazyConReintento(() => import('./features/usuarios/UsuariosPage'));
const ClientesPage = lazyConReintento(() => import('./features/clientes/ClientesPage'));
const ProveedoresPage = lazyConReintento(() => import('./features/proveedores/ProveedoresPage'));
const EstadoCuentaPage = lazyConReintento(() => import('./features/estado-cuenta/EstadoCuentaPage'));
const ListasPreciosPage = lazyConReintento(() => import('./features/listas-precios/ListasPreciosPage'));
const ListaDetallePage = lazyConReintento(() => import('./features/listas-precios/ListaDetallePage'));
const TarasPage = lazyConReintento(() => import('./features/taras/TarasPage'));
const PackingListsPage = lazyConReintento(() => import('./features/packing-list/PackingListsPage'));
const PackingListEditorPage = lazyConReintento(() => import('./features/packing-list/PackingListEditorPage'));
const VehiculosPage = lazyConReintento(() => import('./features/vehiculos/VehiculosPage'));
const PesajePage = lazyConReintento(() => import('./features/pesaje/PesajePage'));
const TicketDetallePage = lazyConReintento(() => import('./features/pesaje/TicketDetallePage'));
const FacturaHistorialPage = lazyConReintento(() => import('./features/facturas/FacturaHistorialPage'));
const FacturaFormPage = lazyConReintento(() => import('./features/facturas/FacturaFormPage'));
const FacturaDetallePage = lazyConReintento(() => import('./features/facturas/FacturaDetallePage'));
const NotaDetallePage = lazyConReintento(() => import('./features/notas/NotaDetallePage'));
const PagoDetallePage = lazyConReintento(() => import('./features/estado-cuenta/PagoDetallePage'));

/** "/" para quien no tiene dashboard:ver (ej. trabajador): lo manda a su primera
 *  pantalla permitida; si no tiene ninguna, explica qué hacer en vez de un
 *  "Acceso denegado" seco. */
function InicioPage() {
  const { tienePermiso } = useAuth();
  if (tienePermiso('dashboard', 'ver')) return <DashboardPage />;
  const destino = elegirRutaInicial(tienePermiso);
  if (destino) return <Navigate to={destino} replace />;
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold text-text-primary mb-2">Aún no tienes pantallas asignadas</h2>
        <p className="text-text-secondary">Pídele a un administrador que te dé acceso a las secciones que necesitas.</p>
      </div>
    </div>
  );
}

/** Suspense dentro del Layout: el menú sigue visible mientras carga el chunk. */
function SalidaConSuspense() {
  return (
    <Suspense fallback={<PantallaCargando />}>
      <Outlet />
    </Suspense>
  );
}

// Rutas del portal de proveedores/clientes — sesión completamente separada de la
// del staff (usePortalAuth, no useAuth), por eso vive en su propio subárbol.
function PortalRoutes() {
  const { entidad, cargando } = usePortalAuth();

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Suspense fallback={<PantallaCargando />}>
    <Routes>
      <Route path="login" element={entidad ? <Navigate to="/portal" replace /> : <PortalLoginPage />} />
      <Route path="verificar" element={<PortalVerificarPage />} />
      <Route path="" element={entidad ? <PortalHomePage /> : <Navigate to="/portal/login" replace />} />
      <Route path="documentos" element={entidad ? <PortalDocumentosPage /> : <Navigate to="/portal/login" replace />} />
      <Route path="estado-cuenta" element={entidad ? <PortalEstadoCuentaPage /> : <Navigate to="/portal/login" replace />} />
      <Route path="precios" element={entidad ? <PortalPreciosPage /> : <Navigate to="/portal/login" replace />} />
      <Route path="agendar" element={entidad ? <PortalAgendarPage /> : <Navigate to="/portal/login" replace />} />
      <Route path="guias" element={entidad ? <PortalGuiasPage /> : <Navigate to="/portal/login" replace />} />
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
    </Suspense>
  );
}

/** Tras iniciar sesión vuelve a donde se quería ir (p. ej. el enlace de Telegram) o al inicio. */
function RegresoTrasLogin() {
  const [destino] = useState(() => consumirRutaDeRegreso() ?? '/');
  return <Navigate to={destino} replace />;
}

function AppRoutes() {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/portal/*" element={<PortalRoutes />} />
      <Route path="/auth" element={usuario ? <RegresoTrasLogin /> : <AuthPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route element={<SalidaConSuspense />}>
        <Route path="/" element={<InicioPage />} />
        <Route path="/metricas" element={<ProtectedRoute recurso="dashboard"><MetricasPage /></ProtectedRoute>} />
        <Route path="/productos" element={<ProtectedRoute recurso="productos"><ProductosPage /></ProtectedRoute>} />
        <Route path="/listas-precios" element={<ProtectedRoute recurso="listas_precios"><ListasPreciosPage /></ProtectedRoute>} />
        <Route path="/listas-precios/:id" element={<ProtectedRoute recurso="listas_precios"><ListaDetallePage /></ProtectedRoute>} />
        <Route path="/taras" element={<ProtectedRoute recurso="taras"><TarasPage /></ProtectedRoute>} />
        <Route path="/packing-list" element={<ProtectedRoute recurso="despachos"><PackingListsPage /></ProtectedRoute>} />
        <Route path="/packing-list/:id" element={<ProtectedRoute recurso="despachos"><PackingListEditorPage /></ProtectedRoute>} />
        <Route path="/vehiculos" element={<ProtectedRoute recurso="vehiculos"><VehiculosPage /></ProtectedRoute>} />
        <Route path="/inventario" element={<ProtectedRoute recurso="productos"><InventarioNuevoPage /></ProtectedRoute>} />
        {/* Pantalla anterior, íntegra. Acepta ?pestana=almacenes|lotes|traslados|toma-fisica. */}
        <Route path="/inventario-legacy" element={<ProtectedRoute recurso="productos"><InventarioPage /></ProtectedRoute>} />
        <Route path="/inventario/toma-fisica/:id" element={<ProtectedRoute recurso="toma_fisica"><TomaFisicaDetallePage /></ProtectedRoute>} />
        <Route path="/transformaciones" element={<ProtectedRoute recurso="transformaciones"><TransformacionesPage /></ProtectedRoute>} />
        <Route path="/transformaciones/merma" element={<ProtectedRoute recurso="transformaciones"><MermaPage /></ProtectedRoute>} />
        <Route path="/transformaciones/:id"element={<ProtectedRoute recurso="transformaciones"><TransformacionDetallePage /></ProtectedRoute>} />
        {/* "Lotes" pasó a ser una pestaña dentro de Inventario — se mantiene el
         *  redirect por si alguien tiene el link viejo guardado. */}
        <Route path="/lotes" element={<Navigate to="/inventario-legacy?pestana=lotes" replace />} />
        <Route path="/pesaje" element={<ProtectedRoute recurso="pesaje"><PesajePage /></ProtectedRoute>} />
        <Route path="/pesaje/:id" element={<ProtectedRoute recurso="pesaje"><TicketDetallePage /></ProtectedRoute>} />
        <Route path="/pesaje/conteo/:tomaFisicaId" element={<ProtectedRoute recurso="toma_fisica"><ConteoTomaFisicaPage /></ProtectedRoute>} />
        <Route path="/compras" element={<ProtectedRoute recurso="facturacion"><FacturaHistorialPage tipo="compra" /></ProtectedRoute>} />
        <Route path="/compras/nueva" element={<ProtectedRoute recurso="facturacion"><FacturaFormPage tipo="compra" /></ProtectedRoute>} />
        <Route path="/compras/:id" element={<ProtectedRoute recurso="facturacion"><FacturaDetallePage tipo="compra" /></ProtectedRoute>} />
        <Route path="/ventas" element={<ProtectedRoute recurso="facturacion"><FacturaHistorialPage tipo="venta" /></ProtectedRoute>} />
        <Route path="/ventas/nueva" element={<ProtectedRoute recurso="facturacion"><FacturaFormPage tipo="venta" /></ProtectedRoute>} />
        <Route path="/ventas/:id" element={<ProtectedRoute recurso="facturacion"><FacturaDetallePage tipo="venta" /></ProtectedRoute>} />
        <Route path="/cochinito" element={<ProtectedRoute recurso="cochinito"><CochinitPage /></ProtectedRoute>} />
        <Route path="/clientes" element={<ProtectedRoute recurso="clientes"><ClientesPage /></ProtectedRoute>} />
        <Route path="/clientes/:id/estado-cuenta" element={<ProtectedRoute recurso="clientes"><EstadoCuentaPage tipo="cliente" /></ProtectedRoute>} />
        <Route path="/clientes/:entidadId/notas/:notaId" element={<ProtectedRoute recurso="clientes"><NotaDetallePage tipoEntidad="cliente" /></ProtectedRoute>} />
        <Route path="/clientes/:entidadId/pagos/:grupoId" element={<ProtectedRoute recurso="clientes"><PagoDetallePage tipoEntidad="cliente" /></ProtectedRoute>} />
        <Route path="/proveedores" element={<ProtectedRoute recurso="proveedores"><ProveedoresPage /></ProtectedRoute>} />
        <Route path="/proveedores/:id/estado-cuenta" element={<ProtectedRoute recurso="proveedores"><EstadoCuentaPage tipo="proveedor" /></ProtectedRoute>} />
        <Route path="/proveedores/:entidadId/notas/:notaId" element={<ProtectedRoute recurso="proveedores"><NotaDetallePage tipoEntidad="proveedor" /></ProtectedRoute>} />
        <Route path="/proveedores/:entidadId/pagos/:grupoId" element={<ProtectedRoute recurso="proveedores"><PagoDetallePage tipoEntidad="proveedor" /></ProtectedRoute>} />
        <Route path="/usuarios" element={<ProtectedRoute recurso="usuarios"><UsuariosPage /></ProtectedRoute>} />
        <Route path="/aprobar-llave/:id" element={<AprobarLlavePage />} />
        <Route path="/solicitudes-llave" element={<SolicitudesLlavePage />} />
        <Route path="/citas" element={<ProtectedRoute recurso="despachos"><CitasPage /></ProtectedRoute>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <PortalAuthProvider>
              <PesajeBorradorProvider>
                <AppRoutes />
                <InstallPwaBanner />
              </PesajeBorradorProvider>
            </PortalAuthProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
