import { Suspense, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { EncabezadoPagina } from '../../components/ui';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';
import WalletPrefsProvider from './WalletPrefsProvider';
import { useWalletPrefs } from './wallet-prefs';

interface Seccion {
  to: string;
  etiqueta: string;
  end?: boolean;
}

/** Secciones de la Wallet (todas viven bajo /wallet; Categorías y Reportes reutilizan las pantallas de siempre, embebidas). */
const SECCIONES: readonly Seccion[] = [
  { to: '/wallet', etiqueta: 'Inicio', end: true },
  { to: '/wallet/cuentas', etiqueta: 'Cuentas' },
  { to: '/wallet/registros', etiqueta: 'Registros' },
  { to: '/wallet/estadisticas', etiqueta: 'Estadísticas' },
  { to: '/wallet/categorias', etiqueta: 'Categorías' },
  { to: '/wallet/reportes', etiqueta: 'Reportes' },
  { to: '/wallet/tasas', etiqueta: 'Tasas' },
];

function BotonOcultarCantidades() {
  const { ocultarCantidades, alternarOcultarCantidades } = useWalletPrefs();
  return (
    <button
      type="button"
      onClick={alternarOcultarCantidades}
      aria-pressed={ocultarCantidades}
      title="Oculta todos los montos de la pantalla (útil si hay alguien mirando)"
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${ocultarCantidades ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'}`}
    >
      {ocultarCantidades ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
      {ocultarCantidades ? 'Mostrar cantidades' : 'Ocultar cantidades'}
    </button>
  );
}

/** Navegación por pestañas; en móvil la pestaña activa se acerca a la vista. */
function NavegacionSecciones() {
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  return (
    <nav ref={navRef} aria-label="Secciones del Wallet" className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border scrollbar-none">
      {SECCIONES.map(s => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.end}
          className={({ isActive }) =>
            `-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
        >
          {s.etiqueta}
        </NavLink>
      ))}
    </nav>
  );
}

function Marco() {
  return (
    <div className="max-w-7xl">
      <EncabezadoPagina
        lecturas={LECTURAS.cochinito}
        titulo="Wallet"
        subtitulo="Versión nueva de la tesorería de Pronoia: tus cuentas, sus movimientos y cómo van los números."
        acciones={<BotonOcultarCantidades />}
      />
      <NavegacionSecciones />
      <Suspense fallback={<p role="status" className="py-10 text-center text-text-secondary">Cargando…</p>}>
        <Outlet />
      </Suspense>
    </div>
  );
}

/** Marco de la Wallet nueva: vive dentro del layout de Pronoia (mismo menú, encabezado y colores). */
function WalletShell() {
  return (
    <WalletPrefsProvider>
      <Marco />
    </WalletPrefsProvider>
  );
}

export default WalletShell;
