import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/use-auth-context';
import { useToast } from '../hooks/use-toast-context';
import { useEstadoConexion } from '../lib/offline/conexion';
import { configurarPinOffline, PinAgotadoError, pinOfflineConfigurado, quitarPinOffline } from '../lib/offline/sesion';
import { LARGO_PIN_MAX, validarFormatoPin } from '../lib/offline/pin-logica';

/** Activa, cambia o quita el PIN de desbloqueo sin conexión (va en la pantalla de perfil). Solo se puede
 *  configurar con internet y con el modo sin conexión activo para el usuario. */
function PinOfflinePerfil() {
  const { usuario, offlineActivo, logout } = useAuth();
  const toast = useToast();
  const { online } = useEstadoConexion();
  const [configurado, setConfigurado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [pin, setPin] = useState('');
  const [repetir, setRepetir] = useState('');
  const [pinActual, setPinActual] = useState('');
  // 'quitar' pide el PIN actual antes de borrarlo.
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!offlineActivo) return;
    let vigente = true;
    void pinOfflineConfigurado().then(c => { if (vigente) setConfigurado(c); });
    return () => { vigente = false; };
  }, [offlineActivo, usuario?.id]);

  if (!usuario || !offlineActivo) return null;

  const cerrarFormulario = () => {
    setEditando(false);
    setQuitando(false);
    setPin('');
    setRepetir('');
    setPinActual('');
    setError(null);
  };

  const manejarError = (err: unknown, porDefecto: string) => {
    if (err instanceof PinAgotadoError) {
      cerrarFormulario();
      void logout();
      return;
    }
    setError(err instanceof Error ? err.message : porDefecto);
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const invalido = validarFormatoPin(pin);
    if (invalido) { setError(invalido); return; }
    if (pin !== repetir) { setError('Los dos PIN no coinciden.'); return; }
    try {
      await configurarPinOffline(pin, usuario.id, configurado ? pinActual : undefined);
      setConfigurado(true);
      cerrarFormulario();
      toast.exito('PIN guardado. Se pedirá al abrir la app sin conexión.');
    } catch (err) {
      manejarError(err, 'No se pudo guardar el PIN.');
    }
  };

  const quitar = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await quitarPinOffline(pinActual);
      setConfigurado(false);
      cerrarFormulario();
      toast.exito('PIN quitado.');
    } catch (err) {
      manejarError(err, 'No se pudo quitar el PIN.');
    }
  };

  const CAMPO = 'min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
  const BOTON = 'min-h-11 rounded-lg border border-border-strong px-4 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50';
  const BOTON_PRIMARIO = 'min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-text-on-brand hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

  return (
    <div className="text-sm">
      <p className="font-medium text-text-primary">PIN sin conexión: {configurado ? 'activo' : 'no configurado'}</p>
      <p className="mt-1 text-xs text-text-secondary">Este PIN solo protege el arranque de la app sin conexión. No protege contra quien tenga el equipo con internet ni cifra los datos guardados en él.</p>
      {!editando && !quitando && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!online}
            onClick={() => setEditando(true)}
            title={online ? undefined : 'Necesitas internet para configurar el PIN'}
            className={BOTON}
          >
            {configurado ? 'Cambiar' : 'Activar'}
          </button>
          {configurado && (
            <button type="button" onClick={() => setQuitando(true)} className={BOTON}>
              Quitar
            </button>
          )}
        </div>
      )}
      {quitando && (
        <form onSubmit={e => void quitar(e)} className="mt-3 space-y-2">
          <input
            type="password" inputMode="numeric" autoComplete="off" maxLength={LARGO_PIN_MAX}
            value={pinActual} onChange={e => setPinActual(e.target.value.replace(/\D/g, ''))}
            placeholder="PIN actual" aria-label="PIN actual"
            className={CAMPO}
          />
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={BOTON_PRIMARIO}>Quitar PIN</button>
            <button type="button" onClick={cerrarFormulario} className={BOTON}>Cancelar</button>
          </div>
        </form>
      )}
      {editando && (
        <form onSubmit={guardar} className="mt-3 space-y-2">
          {configurado && (
            <input
              type="password" inputMode="numeric" autoComplete="off" maxLength={LARGO_PIN_MAX}
              value={pinActual} onChange={e => setPinActual(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN actual" aria-label="PIN actual"
              className={CAMPO}
            />
          )}
          <input
            type="password" inputMode="numeric" autoComplete="new-password" maxLength={LARGO_PIN_MAX}
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="PIN (4 a 8 números)" aria-label="PIN nuevo"
            className={CAMPO}
          />
          <input
            type="password" inputMode="numeric" autoComplete="new-password" maxLength={LARGO_PIN_MAX}
            value={repetir} onChange={e => setRepetir(e.target.value.replace(/\D/g, ''))}
            placeholder="Repite el PIN" aria-label="Repetir PIN"
            className={CAMPO}
          />
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={BOTON_PRIMARIO}>Guardar</button>
            <button type="button" onClick={cerrarFormulario} className={BOTON}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default PinOfflinePerfil;
