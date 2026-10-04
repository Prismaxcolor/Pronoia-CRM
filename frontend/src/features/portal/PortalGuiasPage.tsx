import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { listarMisGuias, type GuiaPortal, type EstadoGuia } from '../../services/portal-guias-service';
import { Bloque, Insignia, SkeletonTabla, TablaDatos } from '../../components/ui';
import { fechaCorta } from '../../lib/portal-kpis';
import type { ColumnaTabla } from '../../lib/tabla-datos';
import type { Tono } from '../../lib/paleta';
import PortalLayout from './PortalLayout';

const ESTADO: Record<EstadoGuia, { texto: string; tono: Tono }> = {
  solicitada: { texto: 'Solicitada', tono: 'aviso' },
  en_tramite: { texto: 'En trámite', tono: 'info' },
  lista: { texto: 'Lista', tono: 'exito' },
  rechazada: { texto: 'Rechazada', tono: 'peligro' },
};

function PortalGuiasPage() {
  const [guias, setGuias] = useState<GuiaPortal[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    listarMisGuias().then(setGuias).finally(() => setCargando(false));
  }, []);

  const columnas = useMemo<ColumnaTabla<GuiaPortal>[]>(() => [
    { clave: 'guia', titulo: 'Guía', valorOrden: g => g.numeroGuia ?? g.id, celda: g => g.numeroGuia ?? `Guía ${g.id.slice(0, 8)}` },
    { clave: 'fecha', titulo: 'Solicitada', valorOrden: g => g.createdAt, celda: g => fechaCorta(g.createdAt), valorCsv: g => fechaCorta(g.createdAt) },
    {
      clave: 'estado', titulo: 'Estado', ayuda: 'Solicitada: pedida y aún sin atender. En trámite: se está gestionando. Lista: ya puedes descargar el PDF. Rechazada: no fue aprobada.', valorOrden: g => ESTADO[g.estado].texto,
      celda: g => <Insignia tono={ESTADO[g.estado].tono}>{ESTADO[g.estado].texto}</Insignia>, valorCsv: g => ESTADO[g.estado].texto,
    },
    {
      clave: 'pdf', titulo: 'PDF', valorCsv: false,
      celda: g => g.urlPdf ? (
        <a
          href={g.urlPdf} target="_blank" rel="noreferrer" aria-label={`Descargar PDF de la guía ${g.numeroGuia ?? g.id.slice(0, 8)}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm font-medium text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:min-h-0 sm:py-1"
        >
          <Download size={14} aria-hidden="true" /> Descargar
        </a>
      ) : '—',
    },
  ], []);

  return (
    <PortalLayout titulo="Guías CORPOEZ" subtitulo="Permisos de traslado que has solicitado y en qué estado están.">
      {cargando ? (
        <SkeletonTabla filas={3} columnas={3} />
      ) : (
        <Bloque titulo="Mis guías" queEstasViendo="Cada guía (permiso de traslado) que se solicitó a tu nombre, con su estado. Cuando está lista puedes descargar el PDF.">
          <TablaDatos
            titulo="Guías CORPOEZ" columnas={columnas} filas={guias} claveFila={g => g.id}
            ordenInicial={{ columna: 'fecha', sentido: 'desc' }} anchoMinimo="min-w-[28rem]"
            exportar={{ nombreArchivo: 'mis-guias' }}
            vacio={{
              mensaje: 'Todavía no tienes guías solicitadas.',
              descripcion: 'Cuando se solicite una guía a tu nombre la verás aquí, con su estado y el PDF cuando esté lista.',
            }}
          />
        </Bloque>
      )}
    </PortalLayout>
  );
}

export default PortalGuiasPage;
