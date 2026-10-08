import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../hooks/use-auth-context';
import { useToast } from '../hooks/use-toast-context';
import { useEstadoConexion } from '../lib/offline/conexion';
import { configurarPinOffline, PinAgotadoError, pinOfflineConfigurado, quitarPinOffline } from '../lib/offline/sesion';
import { LARGO_PIN_MAX, validarFormatoPin } from '../lib/offline/pin-logica';

/** Activa, cambia o quita el PIN de desbloqueo sin conexión (va en el perfil del menú). Solo se puede
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

  return (
    <div className="mb-3 rounded-lg bg-brand-800/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 text-brand-100">
        <KeyRound size={14} aria-hidden="true" />
        <span className="font-medium">PIN sin conexión: {configurado ? 'activo' : 'no configurado'}</span>
      </div>
      <p className="mt-1 text-brand-200">Este PIN solo protege el arranque de la app sin conexión. No protege contra quien tenga el equipo con internet ni cifra los datos guardados en él.</p>
      {!editando && !quitando && (
        <div className="mt-1.5 flex gap-3">
          <button
            type="button"
            disabled={!online}
            onClick={() => setEditando(true)}
            title={online ? undefined : 'Necesitas internet para configurar el PIN'}
            className="text-brand-200 hover:text-white underline disabled:opacity-50 disabled:no-underline"
          >
            {configurado ? 'Cambiar' : 'Activar'}
          </button>
          {configurado && (
            <button type="button" onClick={() => setQuitando(true)} className="text-brand-200 hover:text-white underline">
              Quitar
            </button>
          )}
        </div>
      )}
      {quitando && (
        <form onSubmit={e => void quitar(e)} className="mt-2 space-y-1.5">
          <input
            type="password" inputMode="numeric" autoComplete="off" maxLength={LARGO_PIN_MAX}
            value={pinActual} onChange={e => setPinActual(e.target.value.replace(/\D/g, ''))}
            placeholder="PIN actual" aria-label="PIN actual"
            className="w-full rounded px-2 py-1 text-text-primary bg-surface"
          />
          {error && <p role="alert" className="text-red-200">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" className="text-white font-medium underline">Quitar PIN</button>
            <button type="button" onClick={cerrarFormulario} className="text-brand-200 hover:text-white underline">Cancelar</button>
          </div>
        </form>
      )}
      {editando && (
        <form onSubmit={guardar} className="mt-2 space-y-1.5">
          {configurado && (
            <input
              type="password" inputMode="numeric" autoComplete="off" maxLength={LARGO_PIN_MAX}
              value={pinActual} onChange={e => setPinActual(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN actual" aria-label="PIN actual"
              className="w-full rounded px-2 py-1 text-text-primary bg-surface"
            />
          )}
          <input
            type="password" inputMode="numeric" autoComplete="new-password" maxLength={LARGO_PIN_MAX}
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="PIN (4 a 8 números)" aria-label="PIN nuevo"
            className="w-full rounded px-2 py-1 text-text-primary bg-surface"
          />
          <input
            type="password" inputMode="numeric" autoComplete="new-password" maxLength={LARGO_PIN_MAX}
            value={repetir} onChange={e => setRepetir(e.target.value.replace(/\D/g, ''))}
            placeholder="Repite el PIN" aria-label="Repetir PIN"
            className="w-full rounded px-2 py-1 text-text-primary bg-surface"
          />
          {error && <p role="alert" className="text-red-200">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" className="text-white font-medium underline">Guardar</button>
            <button type="button" onClick={cerrarFormulario} className="text-brand-200 hover:text-white underline">Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default PinOfflinePerfil;
