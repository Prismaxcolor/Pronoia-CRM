import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Wallet, LogOut, Users, FileText, ClipboardList } from 'lucide-react';
import { useAuth } from '../hooks/use-auth';
import type { Recurso } from '@shared/types/index.js';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  recurso: Recurso;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={20} />, recurso: 'dashboard' },
  { label: 'Productos', to: '/productos', icon: <Package size={20} />, recurso: 'productos' },
  { label: 'Facturacion', to: '/facturacion', icon: <FileText size={20} />, recurso: 'facturacion' },
  { label: 'Historial', to: '/historial', icon: <ClipboardList size={20} />, recurso: 'facturacion' },
  { label: 'Cochinito', to: '/cochinito', icon: <Wallet size={20} />, recurso: 'cochinito' },
  { label: 'Usuarios', to: '/usuarios', icon: <Users size={20} />, recurso: 'usuarios' },
];

function Sidebar() {
  const { usuario, logout, tienePermiso } = useAuth();

  const itemsVisibles = NAV_ITEMS.filter(item => tienePermiso(item.recurso, 'ver'));

  return (
    <aside className="w-64 bg-brand-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-brand-800">
        <h1 className="text-xl font-bold tracking-wide">Pronoia</h1>
        <p className="text-brand-300 text-xs mt-1">Sistema de compras</p>
      </div>

      {/* Navegacion */}
      <nav className="flex-1 py-4">
        {itemsVisibles.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors
               ${isActive
                 ? 'bg-brand-700 text-white border-r-3 border-brand-300'
                 : 'text-brand-200 hover:bg-brand-800 hover:text-white'
               }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Perfil y logout */}
      <div className="p-4 border-t border-brand-800">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-sm font-bold">
            {usuario?.nombre?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{usuario?.nombre}</p>
            <p className="text-xs text-brand-300 capitalize">{usuario?.rol}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 text-brand-300 hover:text-white text-sm transition-colors w-full"
        >
          <LogOut size={16} />
          Cerrar sesion
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
