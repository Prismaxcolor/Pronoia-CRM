import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EncabezadoPagina } from '../../components/ui';
import { useAuth } from '../../hooks/use-auth-context';
import { listarSolicitudesLlave, type SolicitudLlave } from '../../services/solicitud-llave-service';
import { formatearHoraNegocio } from '../../lib/fecha-negocio';

const INTERVALO_MS = 15_000;

/** Panel del superadmin: solicitudes de llave pendientes, con acceso directo a aprobar o rechazar. */
function SolicitudesLlavePage() {
  const { usuario } = useAuth();
  const esSuperadmin = usuario?.rol === 'superadmin';
  const [lista, setLista] = useState<SolicitudLlave[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!esSuperadmin) return;
    let cancelado = false;
    const cargar = async () => {
      if (document.hidden) return;
      const r = await listarSolicitudesLlave('pendiente');
      if (cancelado) return;
      if (r.ok) { setLista(r.data); setError(null); } else setError(r.error);
    };
    void cargar();
    const id = window.setInterval(() => void cargar(), INTERVALO_MS);
    return () => { cancelado = true; window.clearInterval(id); };
  }, [esSuperadmin]);

  if (!esSuperadmin) {
    return <p role="alert" className="py-16 text-center text-text-secondary">Solo un superadmin puede ver las solicitudes de llave.</p>;
  }

  return (
    <div className="max-w-3xl">
      <EncabezadoPagina titulo="Solicitudes de llave" subtitulo="Personas que piden editar un documento. Aprueba o rechaza cada una." />
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {lista === null && !error && <p role="status" className="text-text-secondary">Cargando…</p>}
      {lista?.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-text-secondary">
          No hay solicitudes pendientes. Cuando alguien pida una llave aparecerá aquí.
        </p>
      )}
      <ul className="space-y-3">
        {(lista ?? []).map(s => (
          <li key={s.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary">{s.solicitanteNombre}</p>
                <p className="text-sm text-text-secondary break-words">{s.descripcion}</p>
                <p className="mt-1 text-sm text-text-primary break-words">“{s.motivo}”</p>
                <p className="mt-1 text-xs text-text-muted">Vence {formatearHoraNegocio(s.expiraEn)}</p>
              </div>
              <Link
                to={`/aprobar-llave/${s.id}`}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                Revisar
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SolicitudesLlavePage;
