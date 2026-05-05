import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/use-auth';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import AuthPage from './features/auth/AuthPage';
import DashboardPage from './features/dashboard/DashboardPage';
import ProductosPage from './features/productos/ProductosPage';
import CochinitPage from './features/cochinito/CochinitPage';
import UsuariosPage from './features/usuarios/UsuariosPage';
import FacturacionPage from './features/facturacion/FacturacionPage';
import HistorialFacturasPage from './features/facturacion/HistorialFacturasPage';

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
        <Route path="/facturacion" element={<ProtectedRoute recurso="facturacion"><FacturacionPage /></ProtectedRoute>} />
        <Route path="/historial" element={<ProtectedRoute recurso="facturacion"><HistorialFacturasPage /></ProtectedRoute>} />
        <Route path="/cochinito" element={<ProtectedRoute recurso="cochinito"><CochinitPage /></ProtectedRoute>} />
        <Route path="/usuarios" element={<ProtectedRoute recurso="usuarios"><UsuariosPage /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
