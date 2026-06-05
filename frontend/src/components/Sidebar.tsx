import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Wallet, LogOut, Users, Contact, Tag, Truck, Scale, ShoppingCart, ShoppingBag, Boxes, Recycle } from 'lucide-react';
import { useAuth } from '../hooks/use-auth';
import type { Recurso } from '@shared/types/index.js';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  recurso: Recurso;
}

interface NavSection {
  /** Encabezado de la sección. Si se omite, los items van sin rótulo (ej. Dashboard). */
  header?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={20} />, recurso: 'dashboard' },
    ],
  },
  {
    header: 'Almacén',
    items: [
      { label: 'Productos', to: '/productos', icon: <Package size={20} />, recurso: 'productos' },
      { label: 'Inventario', to: '/inventario', icon: <Boxes size={20} />, recurso: 'productos' },
      { label: 'Transformaciones', to: '/transformaciones', icon: <Recycle size={20} />, recurso: 'productos' },
    ],
  },
  {
    header: 'Compras',
    items: [
      { label: 'Proveedores', to: '/proveedores', icon: <Truck size={20} />, recurso: 'proveedores' },
      { label: 'Pesaje', to: '/pesaje', icon: <Scale size={20} />, recurso: 'pesaje' },
      { label: 'Compras', to: '/compras', icon: <ShoppingCart size={20} />, recurso: 'facturacion' },
    ],
  },
  {
    header: 'Ventas',
    items: [
      { label: 'Clientes', to: '/clientes', icon: <Contact size={20} />, recurso: 'clientes' },
      { label: 'Ventas', to: '/ventas', icon: <ShoppingBag size={20} />, recurso: 'facturacion' },
    ],
  },
  {
    header: 'Tesorería',
    items: [
      { label: 'Cochinito', to: '/cochinito', icon: <Wallet size={20} />, recurso: 'cochinito' },
    ],
  },
  {
    header: 'Configuración',
    items: [
      { label: 'Listas de precios', to: '/listas-precios', icon: <Tag size={20} />, recurso: 'productos' },
      { label: 'Usuarios', to: '/usuarios', icon: <Users size={20} />, recurso: 'usuarios' },
    ],
  },
];

function Sidebar() {
  const { usuario, logout, tienePermiso } = useAuth();

  // Filtra items por permiso y descarta secciones que queden sin items visibles.
  const seccionesVisibles = NAV_SECTIONS
    .map(sec => ({ ...sec, items: sec.items.filter(item => tienePermiso(item.recurso, 'ver')) }))
    .filter(sec => sec.items.length > 0);

  return (
    <aside className="w-64 bg-brand-900 text-white flex flex-col min-h-screen print:hidden">
      {/* Logo */}
      <div className="p-6 border-b border-brand-800">
        <h1 className="text-xl font-bold tracking-wide">Pronoia</h1>
        <p className="text-brand-300 text-xs mt-1">Sistema de compras</p>
      </div>

      {/* Navegacion */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {seccionesVisibles.map((sec, idx) => (
          <div key={sec.header ?? `sec-${idx}`} className={idx > 0 ? 'mt-3' : ''}>
            {sec.header && (
              <p className="px-6 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-400">
                {sec.header}
              </p>
            )}
            {sec.items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
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
          </div>
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
