import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

function Layout() {
  // <main> usa flex-1 dentro de un contenedor min-h-screen (no h-screen), así
  // que crece junto con el contenido en vez de quedar acotado — su
  // overflow-y-auto casi nunca llega a activarse. El scroll real ocurre en
  // la ventana. React Router no lo resetea solo al cambiar de ruta: sin
  // esto, entrar a una pantalla nueva desde un punto scrolleado del menú la
  // deja abierta a mitad de página en vez de arriba.
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-surface-alt print:block print:bg-white">
      <Sidebar />
      <main className="flex-1 p-8 overflow-y-auto print:p-0 print:overflow-visible">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
