import { Link } from 'react-router-dom';
import { LogOut, FileText, Wallet, Tag, CalendarClock, FileCheck2, ChevronRight } from 'lucide-react';
import { usePortalAuth } from '../../hooks/use-portal-auth';

interface Opcion {
  to: string;
  label: string;
  descripcion: string;
  icon: typeof FileText;
  disponible: boolean;
}

const OPCIONES: Opcion[] = [
  { to: '/portal/documentos', label: 'Mis documentos', descripcion: 'Facturas, tickets de pesaje y comprobantes', icon: FileText, disponible: true },
  { to: '/portal/estado-cuenta', label: 'Estado de cuenta', descripcion: 'Tu saldo y el historial de movimientos', icon: Wallet, disponible: true },
  { to: '/portal/precios', label: 'Lista de precios', descripcion: 'Precios vigentes por material', icon: Tag, disponible: true },
  { to: '/portal/agendar', label: 'Agendar despacho', descripcion: 'Elige el día y la hora de tu próxima entrega', icon: CalendarClock, disponible: true },
  { to: '/portal/guias', label: 'Guías', descripcion: 'Permisos de traslado y su estado', icon: FileCheck2, disponible: true },
];

function PortalHomePage() {
  const { entidad, logout } = usePortalAuth();

  return (
    <div className="min-h-screen bg-surface-alt">
      <header className="bg-brand-900 text-white px-4 pt-6 pb-10 shadow-md">
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-brand-200 text-sm font-medium">Pronoia Scrap</p>
            <h1 className="text-2xl font-bold tracking-tight mt-1 truncate">Hola, {entidad?.nombre}</h1>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="p-2 rounded-lg text-brand-200 hover:text-white hover:bg-brand-800 transition-colors shrink-0"
            title="Cerrar sesión"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 -mt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted px-1 mb-3">
          ¿Qué necesitas hoy?
        </p>

        <div className="space-y-3">
          {OPCIONES.map(({ to, label, descripcion, icon: Icon, disponible }) =>
            disponible ? (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-4 p-4 bg-surface rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center text-brand-700 shrink-0">
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{label}</p>
                  <p className="text-xs text-text-muted mt-0.5 truncate">{descripcion}</p>
                </div>
                <ChevronRight size={18} className="text-text-muted shrink-0" />
              </Link>
            ) : (
              <div key={to} className="flex items-center gap-4 p-4 bg-surface rounded-2xl opacity-50">
                <div className="w-11 h-11 rounded-xl bg-surface-alt flex items-center justify-center text-text-muted shrink-0">
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-secondary">{label}</p>
                  <p className="text-xs text-text-muted mt-0.5">Próximamente</p>
                </div>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}

export default PortalHomePage;
