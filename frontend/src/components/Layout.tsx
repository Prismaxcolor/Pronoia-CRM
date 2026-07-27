import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

function Layout() {
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
