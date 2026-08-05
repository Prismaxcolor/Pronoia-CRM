import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

function Layout() {
  // El scroll vive en <main>, no en window — React Router no lo resetea solo
  // al cambiar de ruta. Sin esto, entrar a una pantalla nueva desde un punto
  // scrolleado del menú la deja abierta a mitad de página en vez de arriba.
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-surface-alt print:block print:bg-white">
      <Sidebar />
      <main ref={mainRef} className="flex-1 p-8 overflow-y-auto print:p-0 print:overflow-visible">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
