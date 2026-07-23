import { useState } from 'react';
import { Send } from 'lucide-react';
import { solicitarLoginPortal } from '../../services/portal-auth-service';

function PortalLoginPage() {
  const [identificador, setIdentificador] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const result = await solicitarLoginPortal(identificador.trim());
    setEnviando(false);

    if ('error' in result) {
      setError(result.error);
      return;
    }
    setMensaje(result.mensaje);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-alt px-4">
      <div className="w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-border p-6 sm:p-8">
        <h1 className="text-xl font-bold text-text-primary text-center">Pronoia Scrap</h1>
        <p className="text-sm text-text-secondary text-center mt-1 mb-6">
          Portal de proveedores y clientes
        </p>

        {mensaje ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700 text-center">
            {mensaje}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Tu RIF, cédula o teléfono
              </label>
              <input
                type="text"
                required
                value={identificador}
                onChange={e => setIdentificador(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
                placeholder="Ej. J-12345678-9"
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={enviando || !identificador.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              <Send size={16} />
              {enviando ? 'Enviando...' : 'Enviarme el link de acceso'}
            </button>

            <p className="text-xs text-text-muted text-center">
              Te lo mandamos por Telegram. Si todavía no vinculaste tu Telegram, pedile a
              Pronoia que te genere el link de vinculación primero.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default PortalLoginPage;
