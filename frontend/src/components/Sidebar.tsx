import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, Wallet, LogOut, Users, Contact, Tag, Truck, Scale, ShoppingCart, ShoppingBag, Boxes, Recycle, Layers, Weight, CalendarClock, BarChart3, X } from 'lucide-react';
import { useAuth } from '../hooks/use-auth-context';
import { leerUltimasRutas, guardarUltimaRuta } from '../services/nav-memory';
import type { Recurso } from '@shared/types/index.js';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  recurso: Recurso;
  /** Si es true, el link vuelve a la última ruta de detalle visitada dentro de
   *  esta sección (ej. "/pesaje/<id>") en vez de siempre a la lista. */
  recordable?: boolean;
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
      { label: 'Métricas', to: '/metricas', icon: <BarChart3 size={20} />, recurso: 'dashboard' },
    ],
  },
  {
    header: 'Almacén',
    items: [
      { label: 'Productos', to: '/productos', icon: <Package size={20} />, recurso: 'productos' },
      { label: 'Inventario', to: '/inventario', icon: <Boxes size={20} />, recurso: 'productos' },
      { label: 'Lotes', to: '/lotes', icon: <Layers size={20} />, recurso: 'productos' },
      { label: 'Transformaciones', to: '/transformaciones', icon: <Recycle size={20} />, recurso: 'transformaciones' },
    ],
  },
  {
    header: 'Pesaje',
    items: [
      { label: 'Pesaje', to: '/pesaje', icon: <Scale size={20} />, recurso: 'pesaje', recordable: true },
      { label: 'Taras', to: '/taras', icon: <Weight size={20} />, recurso: 'taras' },
      { label: 'Despachos', to: '/citas', icon: <CalendarClock size={20} />, recurso: 'despachos' },
    ],
  },
  {
    header: 'Compras',
    items: [
      { label: 'Proveedores', to: '/proveedores', icon: <Truck size={20} />, recurso: 'proveedores', recordable: true },
      { label: 'Compras', to: '/compras', icon: <ShoppingCart size={20} />, recurso: 'facturacion', recordable: true },
    ],
  },
  {
    header: 'Ventas',
    items: [
      { label: 'Clientes', to: '/clientes', icon: <Contact size={20} />, recurso: 'clientes', recordable: true },
      { label: 'Ventas', to: '/ventas', icon: <ShoppingBag size={20} />, recurso: 'facturacion', recordable: true },
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
      { label: 'Listas de precios', to: '/listas-precios', icon: <Tag size={20} />, recurso: 'listas_precios', recordable: true },
      { label: 'Usuarios', to: '/usuarios', icon: <Users size={20} />, recurso: 'usuarios' },
    ],
  },
];

/** Rutas que NO deben quedar "recordadas" como la última visitada de su
 *  sección aunque estén bajo un prefijo recordable — son páginas de acción
 *  transitorias (formularios ligados a un estado que puede volverse inválido),
 *  no fichas de detalle a las que tenga sentido volver. Ej. "/pesaje/conteo/:id"
 *  deja de servir en cuanto se culmina esa toma física — si quedara recordada,
 *  el link "Pesaje" del sidebar apuntaría ahí para siempre en esa pestaña. */
const RUTAS_NO_RECORDABLES = [/^\/pesaje\/conteo\//];

function esRutaRecordable(pathname: string): boolean {
  return !RUTAS_NO_RECORDABLES.some(re => re.test(pathname));
}

/** Un item "recordable" es "dueño" de pathname si es el prefijo de sección más
 *  específico que matchea — evita que, ej., "/compras" reclame "/compras/nueva"
 *  como propio de otra sección por error de orden. No hay solapes reales hoy
 *  (cada sección recordable tiene su propio prefijo), pero se resuelve por
 *  longitud de prefijo para que siga siendo correcto si se agregan más. */
function seccionActual(pathname: string): NavItem | undefined {
  if (!esRutaRecordable(pathname)) return undefined;
  const candidatos = NAV_SECTIONS.flatMap(s => s.items).filter(
    item => item.recordable && (pathname === item.to || pathname.startsWith(`${item.to}/`))
  );
  return candidatos.sort((a, b) => b.to.length - a.to.length)[0];
}

interface Props {
  /** Solo controla la visibilidad en mobile (drawer) — en desktop (md+) el
   *  sidebar siempre está visible sin importar este valor. */
  abierto: boolean;
  onCerrar: () => void;
}

function Sidebar({ abierto, onCerrar }: Props) {
  const { usuario, logout, tienePermiso } = useAuth();
  const location = useLocation();
  const [ultimasRutas, setUltimasRutas] = useState(() => {
    // Sanea sesiones que ya quedaron con una ruta no-recordable memorizada
    // (ej. de antes de este fix) — si no, el link de esa sección seguiría
    // atascado en esa ruta hasta cerrar la pestaña.
    const rutas = leerUltimasRutas();
    let cambio = false;
    for (const [base, ruta] of Object.entries(rutas)) {
      if (!esRutaRecordable(ruta)) {
        rutas[base] = base;
        guardarUltimaRuta(base, base);
        cambio = true;
      }
    }
    return cambio ? { ...rutas } : rutas;
  });

  // Cada vez que se navega dentro de una sección "recordable", guarda la ruta
  // completa (con el id de detalle si lo hay) como "última visitada" de esa
  // sección, para que el link del sidebar vuelva ahí la próxima vez.
  useEffect(() => {
    const item = seccionActual(location.pathname);
    if (!item) return;
    guardarUltimaRuta(item.to, location.pathname);
    setUltimasRutas(prev => (prev[item.to] === location.pathname ? prev : { ...prev, [item.to]: location.pathname }));
  }, [location.pathname]);

  // Filtra items por permiso y descarta secciones que queden sin items visibles.
  const seccionesVisibles = NAV_SECTIONS
    .map(sec => ({ ...sec, items: sec.items.filter(item => tienePermiso(item.recurso, 'ver')) }))
    .filter(sec => sec.items.length > 0);

  return (
    <>
      {/* Fondo oscuro detrás del drawer en mobile — clic afuera lo cierra. */}
      {abierto && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={onCerrar}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-brand-900 text-white flex flex-col h-screen print:hidden
          transform transition-transform duration-200 ease-in-out
          ${abierto ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
      {/* Logo */}
      <div className="p-6 border-b border-brand-800 flex items-center gap-3">
        <img src="/logo-pronoia.png" alt="Pronoia" className="w-9 h-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-wide">Pronoia</h1>
          <p className="text-brand-300 text-xs mt-1">Sistema de compras</p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="md:hidden text-brand-300 hover:text-white p-1 shrink-0"
          aria-label="Cerrar menú"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navegacion */}
      <nav className="flex-1 py-4 overflow-y-auto scrollbar-none">
        {seccionesVisibles.map((sec, idx) => (
          <div key={sec.header ?? `sec-${idx}`} className={idx > 0 ? 'mt-3' : ''}>
            {sec.header && (
              <p className="px-6 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-400">
                {sec.header}
              </p>
            )}
            {sec.items.map(item => {
              const destino = item.recordable ? (ultimasRutas[item.to] ?? item.to) : item.to;
              const activo = item.to === '/'
                ? location.pathname === '/'
                : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={destino}
                  onClick={onCerrar}
                  aria-current={activo ? 'page' : undefined}
                  className={
                    `flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors
                     ${activo
                       ? 'bg-brand-700 text-white border-r-3 border-brand-300'
                       : 'text-brand-200 hover:bg-brand-800 hover:text-white'
                     }`
                  }
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
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
    </>
  );
}

export default Sidebar;
