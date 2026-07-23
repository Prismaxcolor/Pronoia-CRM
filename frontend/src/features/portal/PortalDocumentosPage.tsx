import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Scale, Receipt, Image as ImageIcon } from 'lucide-react';
import {
  obtenerDocumentosPortal,
  abrirFacturaPdf,
  abrirTicketPdf,
  type PortalDocumentos,
} from '../../services/portal-documentos-service';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fecha(iso: string): string {
  return iso.slice(0, 10);
}

function PortalDocumentosPage() {
  const [datos, setDatos] = useState<PortalDocumentos | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerDocumentosPortal().then(setDatos).finally(() => setCargando(false));
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
        <h1 className="text-lg font-bold text-text-primary">Tus documentos</h1>
      </header>

      <main className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
            <FileText size={16} />
            Facturas
          </h2>
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            {datos?.facturas.length ? (
              datos.facturas.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => abrirFacturaPdf(f.id)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-alt transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">{f.codigo ?? `N.º ${f.id.slice(0, 8)}`}</p>
                    <p className="text-xs text-text-muted">{fecha(f.createdAt)} · {f.estado}</p>
                  </div>
                  <p className="text-sm font-semibold text-text-primary">${fmt(f.total)}</p>
                </button>
              ))
            ) : (
              <p className="p-4 text-sm text-text-muted">Todavía no tienes facturas.</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
            <Scale size={16} />
            Tickets de pesaje
          </h2>
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            {datos?.tickets.length ? (
              datos.tickets.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => abrirTicketPdf(t.id)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-alt transition-colors"
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
                  <p className="text-sm font-semibold text-text-primary">{fmt(t.pesoNetoTotal)} kg</p>
                </button>
              ))
            ) : (
              <p className="p-4 text-sm text-text-muted">Todavía no tienes tickets de pesaje.</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
            <Receipt size={16} />
            Comprobantes de pago
          </h2>
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            {datos?.comprobantes.length ? (
              datos.comprobantes.map(c => (
                <a
                  key={c.id}
                  href={c.comprobanteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-4 hover:bg-surface-alt transition-colors"
                >
                  <p className="text-xs text-text-muted">{fecha(c.fecha)}</p>
                  <p className="text-sm font-semibold text-text-primary">${fmt(c.montoUsd)}</p>
                </a>
              ))
            ) : (
              <p className="p-4 text-sm text-text-muted">Todavía no tienes comprobantes de pago.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default PortalDocumentosPage;
