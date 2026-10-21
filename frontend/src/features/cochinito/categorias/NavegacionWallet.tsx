import { NavLink } from 'react-router-dom';

const SECCIONES = [
  { to: '/cochinito', etiqueta: 'Movimientos', end: true },
  { to: '/cochinito/categorias', etiqueta: 'Categorías', end: false },
  { to: '/cochinito/reportes', etiqueta: 'Reportes', end: false },
] as const;

/** Secciones del Wallet (Movimientos, Categorías, Reportes). Va arriba de cada pantalla del Wallet. */
function NavegacionWallet() {
  return (
    <nav aria-label="Secciones del Wallet" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {SECCIONES.map(s => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.end}
          className={({ isActive }) =>
            `-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
        >
          {s.etiqueta}
        </NavLink>
      ))}
    </nav>
  );
}

export default NavegacionWallet;
