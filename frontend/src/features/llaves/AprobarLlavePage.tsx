import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, ShieldAlert, XCircle } from 'lucide-react';
import { useAuth } from '../../hooks/use-auth-context';
import {
  aprobarSolicitudLlave,
  obtenerSolicitudLlave,
  rechazarSolicitudLlave,
  type SolicitudLlave,
} from '../../services/solicitud-llave-service';
import { formatearFechaHora } from '../../lib/fecha-negocio';

const MOTIVO_MAX = 300;

const BOTON = 'flex-1 min-h-12 px-4 py-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60';

/** Destino del botón de Telegram: el superadmin ve quién pide qué y por qué, y aprueba o rechaza. */
function AprobarLlavePage() {
  const { id } = useParams<{ id: string }>();
  const { usuario } = useAuth();
  const esSuperadmin = usuario?.rol === 'superadmin';
  const [solicitud, setSolicitud] = useState<SolicitudLlave | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState('');

  useEffect(() => {
    if (!id || !esSuperadmin) return;
    let cancelado = false;
    obtenerSolicitudLlave(id).then(r => {
      if (cancelado) return;
      if (r.ok) setSolicitud(r.data); else setError(r.error);
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, [id, esSuperadmin]);

  if (!esSuperadmin) {
    return (
      <Aviso icono={<ShieldAlert size={36} className="text-amber-600" aria-hidden="true" />} titulo="Solo un superadmin puede aprobar llaves">
        Inicia sesión con una cuenta de superadmin para ver esta solicitud.
      </Aviso>
    );
  }
  if (cargando) {
    return <div role="status" className="py-16 text-center text-text-secondary">Cargando solicitud…</div>;
  }
  if (!solicitud) {
    return (
      <Aviso icono={<XCircle size={36} className="text-red-600" aria-hidden="true" />} titulo="No se encontró la solicitud">
        {error ?? 'Puede que ya no exista.'}
      </Aviso>
    );
  }

  const resolver = async (accion: 'aprobar' | 'rechazar') => {
    if (!id) return;
    setTrabajando(true);
    setError(null);
    const r = accion === 'aprobar'
      ? await aprobarSolicitudLlave(id)
      : await rechazarSolicitudLlave(id, motivoRechazo.trim() || undefined);
    setTrabajando(false);
    if (r.ok) { setSolicitud(r.data); setRechazando(false); return; }
    setError(r.error);
    // Si ya la resolvió otra persona o venció, se refresca para mostrar el estado real.
    const actual = await obtenerSolicitudLlave(id);
    if (actual.ok) setSolicitud(actual.data);
  };

  const pendiente = solicitud.estado === 'pendiente';

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700" aria-hidden="true">
            <KeyRound size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Solicitud de llave</h1>
            <p className="text-sm text-text-secondary">de {solicitud.solicitanteNombre}</p>
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <Dato titulo="Quiere editar" valor={solicitud.descripcion} />
          <Dato titulo="Motivo" valor={solicitud.motivo} />
          <Dato titulo="Pedida" valor={formatearFechaHora(solicitud.createdAt)} />
        </dl>

        {pendiente ? (
          <div className="mt-5">
            {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
            {rechazando ? (
              <div>
                <label htmlFor="motivo-rechazo" className="block text-sm font-medium text-text-secondary mb-1">Motivo del rechazo (opcional)</label>
                <textarea
                  id="motivo-rechazo"
                  value={motivoRechazo}
                  onChange={e => setMotivoRechazo(e.target.value)}
                  maxLength={MOTIVO_MAX}
                  rows={2}
                  autoFocus
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <div className="mt-3 flex gap-3">
                  <button type="button" onClick={() => setRechazando(false)} disabled={trabajando} className={`${BOTON} border border-border text-text-secondary hover:bg-surface-alt`}>Volver</button>
                  <button type="button" onClick={() => void resolver('rechazar')} disabled={trabajando} className={`${BOTON} bg-red-600 text-white hover:bg-red-700`}>
                    {trabajando ? 'Rechazando…' : 'Confirmar rechazo'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <button type="button" onClick={() => setRechazando(true)} disabled={trabajando} className={`${BOTON} border border-red-300 text-red-700 hover:bg-red-50`}>Rechazar</button>
                <button type="button" onClick={() => void resolver('aprobar')} disabled={trabajando} className={`${BOTON} bg-brand-600 text-white hover:bg-brand-700`}>
                  {trabajando ? 'Aprobando…' : 'Aprobar'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <Resultado solicitud={solicitud} />
        )}
      </div>
      <p className="mt-4 text-center text-sm">
        <Link to="/solicitudes-llave" className="text-brand-700 underline">Ver todas las solicitudes pendientes</Link>
      </p>
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">{titulo}</dt>
      <dd className="mt-0.5 text-text-primary break-words">{valor}</dd>
    </div>
  );
}

function Resultado({ solicitud }: { solicitud: SolicitudLlave }) {
  const textos: Record<string, string> = {
    aprobada: `Aprobada${solicitud.aprobadorNombre ? ` por ${solicitud.aprobadorNombre}` : ''}. La llave ya le llegó a ${solicitud.solicitanteNombre}.`,
    usada: 'Aprobada y la llave ya fue usada.',
    rechazada: `Rechazada${solicitud.aprobadorNombre ? ` por ${solicitud.aprobadorNombre}` : ''}${solicitud.motivoRechazo ? `: ${solicitud.motivoRechazo}` : '.'}`,
    expirada: 'La solicitud venció sin respuesta. Si sigue siendo necesaria, que la pida de nuevo.',
  };
  const bien = solicitud.estado === 'aprobada' || solicitud.estado === 'usada';
  return (
    <div role="status" className="mt-5 flex items-start gap-2 rounded-lg bg-surface-alt p-3 text-sm text-text-primary">
      {bien
        ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" aria-hidden="true" />
        : <XCircle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />}
      <p>{textos[solicitud.estado]}</p>
    </div>
  );
}

function Aviso({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="max-w-md mx-auto py-16 text-center">
      <div className="flex justify-center">{icono}</div>
      <h1 className="mt-3 text-lg font-semibold text-text-primary">{titulo}</h1>
      <p className="mt-1 text-sm text-text-secondary">{children}</p>
    </div>
  );
}

export default AprobarLlavePage;
