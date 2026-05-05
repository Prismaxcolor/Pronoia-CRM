import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import type { Recurso } from '@shared/types/index.js';

interface Props {
  children: React.ReactNode;
  recurso?: Recurso;
}

function ProtectedRoute({ children, recurso }: Props) {
  const { usuario, cargando, tienePermiso } = useAuth();

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!usuario) {
    return <Navigate to="/auth" replace />;
  }

  if (recurso && !tienePermiso(recurso, 'ver')) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-text-primary mb-2">Acceso denegado</h2>
          <p className="text-text-secondary">No tienes permisos para ver esta seccion.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default ProtectedRoute;
