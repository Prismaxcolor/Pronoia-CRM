import { Link, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/use-auth-context';
import { useCola } from '../lib/offline/cola';
import { useVersionRemota } from '../lib/offline/use-version-remota';
import { etiquetaRol, iniciales, motivosDeAviso } from '../lib/perfil-logica';

interface Props {
  onNavegar: () => void;
}

/** Bloque de usuario del menú lateral, en una sola fila: enlace a /perfil (avatar, nombre, rol) y botón de cerrar sesión. */
function BloqueUsuarioMenu({ onNavegar }: Props) {
  const { usuario, logout } = useAuth();
  const { pathname } = useLocation();
  const { pendientes, rechazadas } = useCola();
  const { estado } = useVersionRemota();
  if (!usuario) return null;

  const hayAviso = motivosDeAviso({
    hayVersionNueva: estado !== 'al-dia',
    esSuperadmin: usuario.rol === 'superadmin',
    telegramVinculado: Boolean(usuario.telegramVinculado),
    pendientes: pendientes.length,
    rechazadas: rechazadas.length,
  }).length > 0;
  const activo = pathname === '/perfil';

  return (
    <div className="flex items-center gap-1 border-t border-brand-800 p-2">
      <Link
        to="/perfil"
        onClick={onNavegar}
        aria-current={activo ? 'page' : undefined}
        aria-label={`Mi perfil${hayAviso ? ' (hay algo por atender)' : ''}`}
        className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
          activo ? 'bg-brand-700' : 'hover:bg-brand-800'
        }`}
      >
        <span className="relative shrink-0">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-bold"
          >
            {iniciales(usuario.nombre)}
          </span>
          {hayAviso && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-brand-900"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{usuario.nombre}</span>
          <span className="block truncate text-[11px] text-brand-300">{etiquetaRol(usuario.rol)}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => void logout()}
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-brand-300 transition-colors hover:bg-brand-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export default BloqueUsuarioMenu;
