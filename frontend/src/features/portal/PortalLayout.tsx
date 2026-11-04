import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { usePortalAuth } from '../../hooks/use-portal-auth-context';
import { EncabezadoPagina } from '../../components/ui';

interface PortalLayoutProps {
  titulo: string;
  subtitulo: string;
  /** La portada del portal no lleva migas. */
  esInicio?: boolean;
  children: ReactNode;
}

/** Marco común de /portal/*: barra de identidad de la marca (quién eres y cómo salir) + encabezado estándar del kit.
 *  Móvil primero: una sola columna; en escritorio se ensancha para que las tablas respiren. */
function PortalLayout({ titulo, subtitulo, esInicio = false, children }: PortalLayoutProps) {
  const { entidad, logout } = usePortalAuth();

  return (
    <div className="min-h-screen bg-surface-alt">
      <div className="bg-brand-900 text-white shadow-md print:hidden">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link to="/portal" className="flex min-w-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200">
            <img src="/logo-pronoia.png" alt="" className="h-8 w-8 shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-brand-200">Pronoia Scrap · Portal</span>
              <span className="block truncate text-sm font-semibold">{entidad?.nombre ?? 'Mi cuenta'}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => logout()}
            aria-label="Cerrar sesión"
            className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm text-brand-100 hover:bg-brand-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          >
            <LogOut size={18} aria-hidden="true" />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <EncabezadoPagina
          titulo={titulo}
          subtitulo={subtitulo}
          migas={esInicio ? undefined : [{ etiqueta: 'Inicio', to: '/portal' }, { etiqueta: titulo }]}
        />
        {children}
      </main>
    </div>
  );
}

export default PortalLayout;
