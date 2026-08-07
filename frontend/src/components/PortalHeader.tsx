import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  backTo?: string;
  right?: ReactNode;
}

/** Header de marca para todo /portal/* — distingue visualmente el portal externo
 *  (proveedores/clientes) del panel interno del staff, que usa su propio Sidebar. */
function PortalHeader({ title, subtitle, backTo, right }: Props) {
  return (
    <header className="bg-brand-900 text-white px-4 pt-5 pb-6 shadow-md">
      <div className="max-w-2xl mx-auto flex items-center gap-3">
        {backTo && (
          <Link
            to={backTo}
            className="p-1 -ml-1 rounded-lg text-brand-200 hover:text-white hover:bg-brand-800 transition-colors shrink-0"
          >
            <ArrowLeft size={20} />
          </Link>
        )}
        <img src="/logo-pronoia.png" alt="Pronoia" className="w-8 h-8 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-sm text-brand-200 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

export default PortalHeader;
