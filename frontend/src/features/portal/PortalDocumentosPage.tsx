import { useEffect, useState } from 'react';
import { FileText, Scale, Receipt, Image as ImageIcon, Inbox } from 'lucide-react';
import {
  obtenerDocumentosPortal,
  abrirFacturaPdf,
  abrirTicketPdf,
  type PortalDocumentos,
} from '../../services/portal-documentos-service';
import PortalHeader from '../../components/PortalHeader';
import PortalSkeleton from '../../components/PortalSkeleton';
import { useToast } from '../../hooks/use-toast-context';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fecha(iso: string): string {
  return iso.slice(0, 10);
}

function EstadoVacio({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-8 text-center">
      <Inbox size={22} className="text-text-muted" />
      <p className="text-sm text-text-muted">{texto}</p>
    </div>
  );
}

function PortalDocumentosPage() {
  const toast = useToast();
  const [datos, setDatos] = useState<PortalDocumentos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  useEffect(() => {
    obtenerDocumentosPortal().then(setDatos).finally(() => setCargando(false));
  }, []);

  const handleAbrir = async (id: string, abrir: (id: string) => Promise<{ error: string } | void>) => {
    setAbriendo(id);
    const resultado = await abrir(id);
    setAbriendo(null);
    if (resultado && 'error' in resultado) toast.errorMsg(resultado.error);
  };

  if (cargando) {
    return (
      <div className="min-h-screen bg-surface-alt">
        <PortalHeader title="Tus documentos" backTo="/portal" />
        <PortalSkeleton filas={4} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <PortalHeader title="Tus documentos" backTo="/portal" />

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
            <FileText size={16} />
            Facturas
          </h2>
          <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
            {datos?.facturas.length ? (
              datos.facturas.map(f => (
                <button
                  key={f.id}
                  type="button"
                  disabled={abriendo === f.id}
                  onClick={() => handleAbrir(f.id, abrirFacturaPdf)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-alt transition-colors disabled:opacity-60"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">{f.codigo ?? `N.º ${f.id.slice(0, 8)}`}</p>
                    <p className="text-xs text-text-muted">{fecha(f.createdAt)} · {f.estado}</p>
                  </div>
                  {abriendo === f.id ? (
                    <div className="w-4 h-4 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
                  ) : (
                    <p className="text-sm font-semibold text-text-primary">${fmt(f.total)}</p>
                  )}
                </button>
              ))
            ) : (
              <EstadoVacio texto="Todavía no tienes facturas." />
            )}
          </div>
        </section>

        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
            <Scale size={16} />
            Tickets de pesaje
          </h2>
          <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
            {datos?.tickets.length ? (
              datos.tickets.map(t => (
                <button
                  key={t.id}
                  type="button"
                  disabled={abriendo === t.id}
                  onClick={() => handleAbrir(t.id, abrirTicketPdf)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-alt transition-colors disabled:opacity-60"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t.codigo}</p>
                    <p className="text-xs text-text-muted flex items-center gap-1">
                      {fecha(t.createdAt)} · {t.estado}
                      {t.fotos.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <ImageIcon size={11} /> {t.fotos.length}
                        </span>
                      )}
                    </p>
                  </div>
                  {abriendo === t.id ? (
                    <div className="w-4 h-4 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
                  ) : (
                    <p className="text-sm font-semibold text-text-primary">{fmt(t.pesoNetoTotal)} kg</p>
                  )}
                </button>
              ))
            ) : (
              <EstadoVacio texto="Todavía no tienes tickets de pesaje." />
            )}
          </div>
        </section>

        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
            <Receipt size={16} />
            Comprobantes de pago
          </h2>
          <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
            {datos?.comprobantes.length ? (
              datos.comprobantes.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-xs text-text-muted">{fecha(c.fecha)}</p>
                    <p className="text-sm font-semibold text-text-primary">${fmt(c.montoUsd)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {c.comprobantes.map((url, idx) => (
                      <a
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="w-10 h-10 rounded-lg overflow-hidden border border-border hover:border-brand-400 transition-colors"
                      >
                        <img src={url} alt={`Comprobante ${idx + 1}`} className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <EstadoVacio texto="Todavía no tienes comprobantes de pago." />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default PortalDocumentosPage;
