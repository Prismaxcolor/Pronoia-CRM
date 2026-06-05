import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/use-auth';
import { ToastProvider } from './hooks/use-toast';
import { ConfirmProvider } from './hooks/use-confirm';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import AuthPage from './features/auth/AuthPage';
import DashboardPage from './features/dashboard/DashboardPage';
import ProductosPage from './features/productos/ProductosPage';
import InventarioPage from './features/inventario/InventarioPage';
import TransformacionesPage from './features/transformaciones/TransformacionesPage';
import CochinitPage from './features/cochinito/CochinitPage';
import UsuariosPage from './features/usuarios/UsuariosPage';
import ClientesPage from './features/clientes/ClientesPage';
import ProveedoresPage from './features/proveedores/ProveedoresPage';
import EstadoCuentaPage from './features/estado-cuenta/EstadoCuentaPage';
import ListasPreciosPage from './features/listas-precios/ListasPreciosPage';
import ListaDetallePage from './features/listas-precios/ListaDetallePage';
import FacturacionPage from './features/facturacion/FacturacionPage';
import HistorialFacturasPage from './features/facturacion/HistorialFacturasPage';
import PesajePage from './features/pesaje/PesajePage';
import FacturaHistorialPage from './features/facturas/FacturaHistorialPage';
import FacturaFormPage from './features/facturas/FacturaFormPage';
import FacturaDetallePage from './features/facturas/FacturaDetallePage';

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
      <Route path="/auth" element={usuario ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<ProtectedRoute recurso="dashboard"><DashboardPage /></ProtectedRoute>} />
        <Route path="/productos" element={<ProtectedRoute recurso="productos"><ProductosPage /></ProtectedRoute>} />
        <Route path="/listas-precios" element={<ProtectedRoute recurso="productos"><ListasPreciosPage /></ProtectedRoute>} />
        <Route path="/listas-precios/:id" element={<ProtectedRoute recurso="productos"><ListaDetallePage /></ProtectedRoute>} />
        <Route path="/inventario" element={<ProtectedRoute recurso="productos"><InventarioPage /></ProtectedRoute>} />
        <Route path="/transformaciones" element={<ProtectedRoute recurso="productos"><TransformacionesPage /></ProtectedRoute>} />
        <Route path="/facturacion" element={<ProtectedRoute recurso="facturacion"><FacturacionPage /></ProtectedRoute>} />
        <Route path="/pesaje" element={<ProtectedRoute recurso="pesaje"><PesajePage /></ProtectedRoute>} />
        <Route path="/compras" element={<ProtectedRoute recurso="facturacion"><FacturaHistorialPage tipo="compra" /></ProtectedRoute>} />
        <Route path="/compras/nueva" element={<ProtectedRoute recurso="facturacion"><FacturaFormPage tipo="compra" /></ProtectedRoute>} />
        <Route path="/compras/:id" element={<ProtectedRoute recurso="facturacion"><FacturaDetallePage tipo="compra" /></ProtectedRoute>} />
        <Route path="/ventas" element={<ProtectedRoute recurso="facturacion"><FacturaHistorialPage tipo="venta" /></ProtectedRoute>} />
        <Route path="/ventas/nueva" element={<ProtectedRoute recurso="facturacion"><FacturaFormPage tipo="venta" /></ProtectedRoute>} />
        <Route path="/ventas/:id" element={<ProtectedRoute recurso="facturacion"><FacturaDetallePage tipo="venta" /></ProtectedRoute>} />
        <Route path="/historial" element={<ProtectedRoute recurso="facturacion"><HistorialFacturasPage /></ProtectedRoute>} />
        <Route path="/cochinito" element={<ProtectedRoute recurso="cochinito"><CochinitPage /></ProtectedRoute>} />
        <Route path="/clientes" element={<ProtectedRoute recurso="clientes"><ClientesPage /></ProtectedRoute>} />
        <Route path="/clientes/:id/estado-cuenta" element={<ProtectedRoute recurso="clientes"><EstadoCuentaPage tipo="cliente" /></ProtectedRoute>} />
        <Route path="/proveedores" element={<ProtectedRoute recurso="proveedores"><ProveedoresPage /></ProtectedRoute>} />
        <Route path="/proveedores/:id/estado-cuenta" element={<ProtectedRoute recurso="proveedores"><EstadoCuentaPage tipo="proveedor" /></ProtectedRoute>} />
        <Route path="/usuarios" element={<ProtectedRoute recurso="usuarios"><UsuariosPage /></ProtectedRoute>} />
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
            <AppRoutes />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
