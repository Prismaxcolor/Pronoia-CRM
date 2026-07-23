import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verificarLoginPortal } from '../../services/portal-auth-service';
import { usePortalAuth } from '../../hooks/use-portal-auth';

function PortalVerificarPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refrescar } = usePortalAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setError('Falta el link completo. Pide uno nuevo desde el portal.');
      return;
    }

    verificarLoginPortal(token).then(async result => {
      if ('error' in result) {
        setError(result.error);
        return;
      }
      await refrescar();
      navigate('/portal', { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-alt px-4">
      <div className="w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-border p-6 sm:p-8 text-center">
        {error ? (
          <>
            <p className="text-red-500 text-sm">{error}</p>
            <a href="/portal/login" className="inline-block mt-4 text-sm text-brand-600 font-medium">
              Volver al portal
            </a>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto" />
            <p className="text-sm text-text-secondary mt-4">Verificando acceso...</p>
          </>
        )}
      </div>
    </div>
  );
}

export default PortalVerificarPage;
