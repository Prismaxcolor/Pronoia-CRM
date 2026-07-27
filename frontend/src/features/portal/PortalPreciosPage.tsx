import { useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import { obtenerPreciosPortal, type ListaPreciosPortal } from '../../services/portal-precios-service';
import PortalHeader from '../../components/PortalHeader';
import PortalSkeleton from '../../components/PortalSkeleton';

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
      <div className="min-h-screen bg-surface-alt">
        <PortalHeader title="Lista de precios" backTo="/portal" />
        <PortalSkeleton filas={3} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <PortalHeader title="Lista de precios" backTo="/portal" />

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {listas.length ? (
          listas.map(({ lista, precios }) => (
            <section key={lista.id}>
              <h2 className="text-sm font-semibold text-text-secondary mb-2">
                {lista.nombre}
                {lista.vigenteDesde && (
                  <span className="text-text-muted font-normal"> · vigente desde {lista.vigenteDesde.slice(0, 10)}</span>
                )}
              </h2>
              <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
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
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Tag size={22} className="text-text-muted" />
            <p className="text-sm text-text-muted">No hay listas de precios vigentes por el momento.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default PortalPreciosPage;
