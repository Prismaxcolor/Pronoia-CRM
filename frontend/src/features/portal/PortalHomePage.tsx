import { Link } from 'react-router-dom';
import { LogOut, FileText, Wallet, Tag, CalendarClock, FileCheck2, ChevronRight } from 'lucide-react';
import { usePortalAuth } from '../../hooks/use-portal-auth';

interface Opcion {
  to: string;
  label: string;
  icon: typeof FileText;
  disponible: boolean;
}

const OPCIONES: Opcion[] = [
  { to: '/portal/documentos', label: 'Mis documentos', icon: FileText, disponible: true },
  { to: '/portal/estado-cuenta', label: 'Estado de cuenta', icon: Wallet, disponible: true },
  { to: '/portal/precios', label: 'Lista de precios', icon: Tag, disponible: true },
  { to: '/portal/agendar', label: 'Agendar despacho', icon: CalendarClock, disponible: true },
  { to: '/portal/guias', label: 'Guías', icon: FileCheck2, disponible: true },
];

function PortalHomePage() {
  const { entidad, logout } = usePortalAuth();

  return (
    <div className="min-h-screen bg-surface-alt">
      <header className="bg-surface border-b border-border px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Pronoia Scrap</h1>
          <p className="text-xs text-text-secondary">Hola, {entidad?.nombre}</p>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="p-2 rounded-lg text-text-muted hover:bg-surface-alt hover:text-red-600 transition-colors"
          title="Cerrar sesión"
        >
          <LogOut size={18} />
        </button>
      </header>

      <main className="p-4 sm:p-6 max-w-2xl mx-auto">
        <div className="bg-surface rounded-xl border border-border divide-y divide-border overflow-hidden">
          {OPCIONES.map(({ to, label, icon: Icon, disponible }) =>
            disponible ? (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 p-4 hover:bg-surface-alt transition-colors"
              >
                <Icon size={18} className="text-brand-600 shrink-0" />
                <span className="flex-1 text-sm font-medium text-text-primary">{label}</span>
                <ChevronRight size={16} className="text-text-muted" />
              </Link>
            ) : (
              <div key={to} className="flex items-center gap-3 p-4 opacity-50">
                <Icon size={18} className="text-text-muted shrink-0" />
                <span className="flex-1 text-sm font-medium text-text-secondary">{label}</span>
                <span className="text-xs text-text-muted">Próximamente</span>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}

export default PortalHomePage;
