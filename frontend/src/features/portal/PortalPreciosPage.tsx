import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { obtenerPreciosPortal, type ListaPreciosPortal } from '../../services/portal-precios-service';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PortalPreciosPage() {
  const [listas, setListas] = useState<ListaPreciosPortal[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerPreciosPortal().then(setListas).finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <header className="bg-surface border-b border-border px-4 py-4 flex items-center gap-3">
        <Link to="/portal" className="text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-bold text-text-primary">Lista de precios</h1>
      </header>

      <main className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        {listas.length ? (
          listas.map(({ lista, precios }) => (
            <section key={lista.id}>
              <h2 className="text-sm font-semibold text-text-secondary mb-2">
                {lista.nombre}
                {lista.vigenteDesde && (
                  <span className="text-text-muted font-normal"> · vigente desde {lista.vigenteDesde.slice(0, 10)}</span>
                )}
              </h2>
              <div className="bg-surface rounded-xl border border-border divide-y divide-border">
                {precios.length ? (
                  precios.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-4">
                      <p className="text-sm font-medium text-text-primary">{p.nombreProducto ?? 'Material'}</p>
                      <p className="text-sm font-semibold text-text-primary">${fmt(p.precio)} / kg</p>
                    </div>
                  ))
                ) : (
                  <p className="p-4 text-sm text-text-muted">Sin precios cargados.</p>
                )}
              </div>
            </section>
          ))
        ) : (
          <p className="text-sm text-text-muted">No hay listas de precios vigentes por el momento.</p>
        )}
      </main>
    </div>
  );
}

export default PortalPreciosPage;
