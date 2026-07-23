import { useEffect, useState } from 'react';
import { FileCheck2, Download, Inbox } from 'lucide-react';
import { listarMisGuias, type GuiaPortal, type EstadoGuia } from '../../services/portal-guias-service';
import PortalHeader from '../../components/PortalHeader';
import PortalSkeleton from '../../components/PortalSkeleton';

const ESTADO_LABEL: Record<EstadoGuia, { texto: string; clase: string }> = {
  solicitada: { texto: 'Solicitada', clase: 'bg-amber-100 text-amber-700' },
  en_tramite: { texto: 'En trámite', clase: 'bg-blue-100 text-blue-700' },
  lista: { texto: 'Lista', clase: 'bg-green-100 text-green-700' },
  rechazada: { texto: 'Rechazada', clase: 'bg-red-100 text-red-700' },
};

function fecha(iso: string): string {
  return iso.slice(0, 10);
}

function PortalGuiasPage() {
  const [guias, setGuias] = useState<GuiaPortal[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    listarMisGuias().then(setGuias).finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="min-h-screen bg-surface-alt">
        <PortalHeader title="Guías CORPOEZ" backTo="/portal" />
        <PortalSkeleton filas={2} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <PortalHeader title="Guías CORPOEZ" backTo="/portal" />

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
          {guias.length ? (
            guias.map(g => (
              <div key={g.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <FileCheck2 size={18} className="text-brand-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">{g.numeroGuia ?? `Guía ${g.id.slice(0, 8)}`}</p>
                    <p className="text-xs text-text-muted">{fecha(g.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_LABEL[g.estado].clase}`}>
                    {ESTADO_LABEL[g.estado].texto}
                  </span>
                  {g.urlPdf && (
                    <a
                      href={g.urlPdf}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-brand-600 transition-colors"
                      title="Descargar PDF"
                    >
                      <Download size={16} />
                    </a>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <Inbox size={22} className="text-text-muted" />
              <p className="text-sm text-text-muted">Todavía no tienes guías solicitadas.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default PortalGuiasPage;
