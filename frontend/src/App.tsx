import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import AuthPage from './features/auth/AuthPage';
import PortalLoginPage from './features/portal/PortalLoginPage';
import PortalVerificarPage from './features/portal/PortalVerificarPage';
import PortalHomePage from './features/portal/PortalHomePage';
import PortalDocumentosPage from './features/portal/PortalDocumentosPage';
import PortalEstadoCuentaPage from './features/portal/PortalEstadoCuentaPage';
import PortalPreciosPage from './features/portal/PortalPreciosPage';
import PortalAgendarPage from './features/portal/PortalAgendarPage';
import PortalGuiasPage from './features/portal/PortalGuiasPage';
import CitasPage from './features/citas/CitasPage';
import DashboardPage from './features/dashboard/DashboardPage';
import MetricasPage from './features/metricas/MetricasPage';
import ProductosPage from './features/productos/ProductosPage';
import InventarioPage from './features/inventario/InventarioPage';
import TomaFisicaDetallePage from './features/inventario/TomaFisicaDetallePage';
import ConteoTomaFisicaPage from './features/pesaje/ConteoTomaFisicaPage';
import TransformacionesPage from './features/transformaciones/TransformacionesPage';
import CochinitPage from './features/cochinito/CochinitPage';
import UsuariosPage from './features/usuarios/UsuariosPage';
import ClientesPage from './features/clientes/ClientesPage';
import ProveedoresPage from './features/proveedores/ProveedoresPage';
import EstadoCuentaPage from './features/estado-cuenta/EstadoCuentaPage';
import ListasPreciosPage from './features/listas-precios/ListasPreciosPage';
import ListaDetallePage from './features/listas-precios/ListaDetallePage';
import TarasPage from './features/taras/TarasPage';
import PesajePage from './features/pesaje/PesajePage';
import TicketDetallePage from './features/pesaje/TicketDetallePage';
import FacturaHistorialPage from './features/facturas/FacturaHistorialPage';
import FacturaFormPage from './features/facturas/FacturaFormPage';
import FacturaDetallePage from './features/facturas/FacturaDetallePage';
import NotaDetallePage from './features/notas/NotaDetallePage';
import PagoDetallePage from './features/estado-cuenta/PagoDetallePage';

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
  );
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
      <Route path="/auth" element={usuario ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<ProtectedRoute recurso="dashboard"><DashboardPage /></ProtectedRoute>} />
        <Route path="/metricas" element={<ProtectedRoute recurso="dashboard"><MetricasPage /></ProtectedRoute>} />
        <Route path="/productos" element={<ProtectedRoute recurso="productos"><ProductosPage /></ProtectedRoute>} />
        <Route path="/listas-precios" element={<ProtectedRoute recurso="listas_precios"><ListasPreciosPage /></ProtectedRoute>} />
        <Route path="/listas-precios/:id" element={<ProtectedRoute recurso="listas_precios"><ListaDetallePage /></ProtectedRoute>} />
        <Route path="/taras" element={<ProtectedRoute recurso="taras"><TarasPage /></ProtectedRoute>} />
        <Route path="/inventario" element={<ProtectedRoute recurso="productos"><InventarioPage /></ProtectedRoute>} />
        <Route path="/inventario/toma-fisica/:id" element={<ProtectedRoute recurso="toma_fisica"><TomaFisicaDetallePage /></ProtectedRoute>} />
        <Route path="/transformaciones" element={<ProtectedRoute recurso="transformaciones"><TransformacionesPage /></ProtectedRoute>} />
        {/* "Lotes" pasó a ser una pestaña dentro de Inventario — se mantiene el
         *  redirect por si alguien tiene el link viejo guardado. */}
        <Route path="/lotes" element={<Navigate to="/inventario" replace />} />
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
        <Route path="/citas" element={<ProtectedRoute recurso="despachos"><CitasPage /></ProtectedRoute>} />
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
