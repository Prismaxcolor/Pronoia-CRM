import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

function Layout() {
  // El contenedor externo estaba en min-h-screen (crece con el contenido en
  // vez de quedar acotado a la pantalla), así que ni <main> ni el <aside> del
  // menú llegaban a tener scroll propio: scrolleaba la ventana completa, y
  // resetearla también arrastraba el menú a su posición inicial. Con h-screen
  // acá y en Sidebar, cada uno queda con su overflow-y-auto real e
  // independiente — resetear <main> al cambiar de ruta ya no toca el menú.
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const [menuAbierto, setMenuAbierto] = useState(false);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  // El drawer del menú no debe seguir abierto al cambiar de pantalla.
  useEffect(() => {
    setMenuAbierto(false);
  }, [pathname]);

  return (
    <div className="flex h-screen bg-surface-alt print:block print:h-auto print:bg-white">
      <Sidebar abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Barra superior solo en mobile — el sidebar normal ya cumple esta función en desktop. */}
        <header className="md:hidden flex items-center gap-3 px-4 h-14 bg-surface border-b border-border shrink-0 print:hidden">
          <button
            type="button"
            onClick={() => setMenuAbierto(true)}
            className="p-2 -ml-2 text-text-secondary hover:text-text-primary"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>
          <img src="/logo-pronoia.png" alt="Pronoia" className="w-6 h-6" />
          <span className="font-semibold text-text-primary">Pronoia</span>
        </header>
        <main ref={mainRef} className="flex-1 p-4 md:p-8 overflow-y-auto print:p-0 print:overflow-visible">
          <div key={pathname} className="animate-[content-in_0.25s_ease-out]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
