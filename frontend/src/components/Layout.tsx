import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
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

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex h-screen bg-surface-alt print:block print:h-auto print:bg-white">
      <Sidebar />
      <main ref={mainRef} className="flex-1 p-8 overflow-y-auto print:p-0 print:overflow-visible">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
