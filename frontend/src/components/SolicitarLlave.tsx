import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, XCircle, X } from 'lucide-react';
import type { EntidadConLlave } from '../services/auditoria-service';
import {
  crearSolicitudLlave,
  obtenerSolicitudLlave,
  type SolicitudLlave,
} from '../services/solicitud-llave-service';
import { formatearHoraNegocio } from '../lib/fecha-negocio';

const INTERVALO_MS = 4_000;
const MOTIVO_MIN = 3;
const MOTIVO_MAX = 300;

interface Props {
  entidadTipo: EntidadConLlave;
  entidadId: string;
  /** Se llama con el código en claro cuando el administrador aprueba. Vuélcalo al campo de llave del formulario. */
  onLlave: (codigo: string) => void;
  className?: string;
}

const claveSesion = (tipo: string, id: string) => `pronoia:solicitud-llave:${tipo}:${id}`;

function leerSesion(clave: string): string | null {
  try { return sessionStorage.getItem(clave); } catch { return null; }
}
function guardarSesion(clave: string, valor: string | null) {
  try {
    if (valor) sessionStorage.setItem(clave, valor); else sessionStorage.removeItem(clave);
  } catch { /* sin sessionStorage: solo se pierde la reanudación tras recargar */ }
}

const ESTADOS_FINALES = new Set(['rechazada', 'usada', 'expirada']);

/**
 * Botón "Solicitar llave": el usuario cuenta el motivo, al superadmin le llega un aviso (Telegram) y
 * lo aprueba con un clic; aquí se ve el estado en vivo y, al aprobarse, el código llega solo a onLlave.
 * Uso: <SolicitarLlave entidadTipo="ticket_pesaje" entidadId={id} onLlave={setLlave} />
 * Mostrarlo solo a quien necesita llave (no superadmin). Si se recarga la página con una solicitud en
 * curso, se reanuda sola.
 */
function SolicitarLlave({ entidadTipo, entidadId, onLlave, className = '' }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solicitud, setSolicitud] = useState<SolicitudLlave | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [solicitudId, setSolicitudId] = useState<string | null>(() => leerSesion(claveSesion(entidadTipo, entidadId)));
  const onLlaveRef = useRef(onLlave);
  const clave = claveSesion(entidadTipo, entidadId);

  useEffect(() => {
    onLlaveRef.current = onLlave;
  }, [onLlave]);

  const aplicar = useCallback((s: SolicitudLlave) => {
    setSolicitud(s);
    if (s.codigo) {
      setCodigo(s.codigo);
      onLlaveRef.current(s.codigo);
    }
    if (ESTADOS_FINALES.has(s.estado) || (s.estado === 'aprobada' && s.codigo)) {
      guardarSesion(clave, null);
      setSolicitudId(null);
    }
  }, [clave]);

  // Polling mientras haya una solicitud viva (pendiente, o aprobada cuyo código aún no se entregó).
  useEffect(() => {
    if (!solicitudId) return;
    let cancelado = false;
    const consultar = async () => {
      const r = await obtenerSolicitudLlave(solicitudId);
      if (cancelado) return;
      if (!r.ok) {
        // La solicitud ya no existe para este usuario: se descarta la reanudación.
        if (/no existe/i.test(r.error)) { guardarSesion(clave, null); setSolicitudId(null); }
        return;
      }
      aplicar(r.data);
    };
    void consultar();
    const id = window.setInterval(() => void consultar(), INTERVALO_MS);
    return () => { cancelado = true; window.clearInterval(id); };
  }, [solicitudId, clave, aplicar]);

  const enviar = async () => {
    const texto = motivo.trim();
    if (texto.length < MOTIVO_MIN) { setError(`Cuéntanos el motivo (mínimo ${MOTIVO_MIN} caracteres).`); return; }
    setEnviando(true);
    setError(null);
    const r = await crearSolicitudLlave(entidadTipo, entidadId, texto);
    setEnviando(false);
    if (!r.ok) { setError(r.error); return; }
    guardarSesion(clave, r.data.solicitud.id);
    setSolicitud(r.data.solicitud);
    setSolicitudId(r.data.solicitud.id);
  };

  const cerrar = () => setAbierto(false);
  const nueva = () => { setSolicitud(null); setCodigo(null); setError(null); setMotivo(''); };
  const enCurso = solicitud?.estado === 'pendiente' || (!!solicitudId && !solicitud);

  return (
    <div className={`print:hidden ${className}`}>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 min-h-11 px-4 py-2 border border-brand-600 text-brand-700 rounded-lg text-sm font-medium hover:bg-brand-50 transition-colors"
      >
        <KeyRound size={16} aria-hidden="true" />
        {enCurso ? 'Solicitud en curso…' : 'Solicitar llave'}
      </button>
      {codigo && !abierto && (
        <p className="mt-1 text-xs text-green-700" role="status">Llave aprobada y aplicada al formulario.</p>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={cerrar}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-solicitar-llave"
            className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[90dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 id="titulo-solicitar-llave" className="text-lg font-semibold text-text-primary">Solicitar llave de edición</h2>
              <button type="button" onClick={cerrar} className="p-2 -m-2 text-text-muted hover:text-text-primary" aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <Contenido
              solicitud={solicitud}
              enCurso={enCurso}
              motivo={motivo}
              setMotivo={setMotivo}
              enviando={enviando}
              error={error}
              onEnviar={enviar}
              onNueva={nueva}
              onCerrar={cerrar}
              codigo={codigo}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface ContenidoProps {
  solicitud: SolicitudLlave | null;
  enCurso: boolean;
  motivo: string;
  setMotivo: (v: string) => void;
  enviando: boolean;
  error: string | null;
  onEnviar: () => void;
  onNueva: () => void;
  onCerrar: () => void;
  codigo: string | null;
}

const BOTON_PRIMARIO = 'w-full min-h-11 py-2.5 rounded-lg text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 transition-colors';

function Contenido({ solicitud, enCurso, motivo, setMotivo, enviando, error, onEnviar, onNueva, onCerrar, codigo }: ContenidoProps) {
  if (enCurso) {
    return (
      <div role="status" aria-live="polite" className="text-center py-4">
        <Loader2 className="mx-auto animate-spin text-brand-600" size={32} aria-hidden="true" />
        <p className="mt-3 font-medium text-text-primary">Esperando la aprobación del administrador…</p>
        <p className="mt-1 text-sm text-text-secondary">
          Ya le avisamos. Puedes dejar esta ventana abierta: la llave se pone sola en el formulario.
        </p>
        {solicitud && <p className="mt-2 text-xs text-text-muted">{solicitud.descripcion} · vence {formatearHoraNegocio(solicitud.expiraEn)}</p>}
        <button type="button" onClick={onCerrar} className="mt-4 min-h-11 text-sm text-text-secondary underline">Cerrar y seguir esperando</button>
      </div>
    );
  }

  if (solicitud?.estado === 'aprobada' || solicitud?.estado === 'usada') {
    return (
      <div role="status" className="text-center py-3">
        <CheckCircle2 className="mx-auto text-green-600" size={36} aria-hidden="true" />
        <p className="mt-2 font-medium text-text-primary">
          {solicitud.estado === 'usada' ? 'Esta llave ya fue usada.' : `Aprobada por ${solicitud.aprobadorNombre ?? 'el administrador'}.`}
        </p>
        {codigo && (
          <>
            <p className="mt-2 text-sm text-text-secondary">Ya está en el campo de llave. Por si la necesitas:</p>
            <p className="mt-1 text-xl font-mono font-bold tracking-wider select-all text-text-primary">{codigo}</p>
          </>
        )}
        <button type="button" onClick={onCerrar} className={`${BOTON_PRIMARIO} mt-4`}>Listo</button>
      </div>
    );
  }

  if (solicitud?.estado === 'rechazada' || solicitud?.estado === 'expirada') {
    const rechazada = solicitud.estado === 'rechazada';
    return (
      <div role="status" className="text-center py-3">
        <XCircle className={`mx-auto ${rechazada ? 'text-red-600' : 'text-amber-600'}`} size={36} aria-hidden="true" />
        <p className="mt-2 font-medium text-text-primary">
          {rechazada ? `${solicitud.aprobadorNombre ?? 'El administrador'} no aprobó la solicitud.` : 'La solicitud venció sin respuesta.'}
        </p>
        {rechazada && solicitud.motivoRechazo && <p className="mt-1 text-sm text-text-secondary">Motivo: {solicitud.motivoRechazo}</p>}
        <button type="button" onClick={onNueva} className={`${BOTON_PRIMARIO} mt-4`}>Pedir otra</button>
        <button type="button" onClick={onCerrar} className="mt-2 min-h-11 text-sm text-text-secondary underline">Cerrar</button>
      </div>
    );
  }

  return (
    <form onSubmit={e => { e.preventDefault(); onEnviar(); }}>
      <label htmlFor="motivo-solicitud-llave" className="block text-sm font-medium text-text-secondary mb-1">
        ¿Por qué necesitas editar este documento?
      </label>
      <textarea
        id="motivo-solicitud-llave"
        value={motivo}
        onChange={e => setMotivo(e.target.value)}
        maxLength={MOTIVO_MAX}
        rows={3}
        autoFocus
        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
        placeholder="Ej.: se digitó mal el peso de la segunda pesada"
      />
      <p className="mt-1 text-xs text-text-muted text-right">{motivo.length}/{MOTIVO_MAX}</p>
      {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={enviando} className={`${BOTON_PRIMARIO} mt-3`}>
        {enviando ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </form>
  );
}

export default SolicitarLlave;
