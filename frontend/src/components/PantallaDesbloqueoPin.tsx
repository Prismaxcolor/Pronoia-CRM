import { useEffect, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import type { Usuario } from '@shared/types/index.js';
import { validarPinOffline } from '../lib/offline/sesion';
import { LARGO_PIN_MAX } from '../lib/offline/pin-logica';

interface Props {
  usuario: Usuario;
  onDesbloqueado: () => void;
  onCerrarSesion: () => void;
  /** Se agotaron los intentos acumulados: se cierra la sesión y se exige login en línea. */
  onAgotado: () => void;
}

function segundosRestantes(hasta: number, ahora: number): number {
  return Math.max(0, Math.ceil((hasta - ahora) / 1000));
}

/** Pantalla de desbloqueo local con PIN: solo aparece sin red y si el usuario activó el PIN. */
function PantallaDesbloqueoPin({ usuario, onDesbloqueado, onCerrarSesion, onAgotado }: Props) {
  const [pin, setPin] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [bloqueadoHasta, setBloqueadoHasta] = useState(0);
  const [ahora, setAhora] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  // Falta el registro del PIN en este equipo: NUNCA se desbloquea solo; solo queda cerrar sesión.
  const [pinPerdido, setPinPerdido] = useState(false);

  // Cuenta regresiva mientras dura el bloqueo temporal.
  useEffect(() => {
    if (bloqueadoHasta === 0) return;
    const id = setInterval(() => {
      const t = Date.now();
      setAhora(t);
      if (t >= bloqueadoHasta) setBloqueadoHasta(0);
    }, 1000);
    return () => clearInterval(id);
  }, [bloqueadoHasta]);

  const enBloqueo = bloqueadoHasta > ahora;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (ocupado || enBloqueo || pinPerdido || pin.length === 0) return;
    setOcupado(true);
    try {
      const r = await validarPinOffline(pin);
      if (r === null) {
        setPinPerdido(true);
        setPin('');
        setMensaje('No se encontró el PIN guardado en este equipo, así que no se puede desbloquear. Cierra sesión e inicia con internet.');
        return;
      }
      if (r.ok) {
        onDesbloqueado();
        return;
      }
      setPin('');
      if (r.motivo === 'agotado') {
        onAgotado();
        return;
      }
      if (r.motivo === 'bloqueado') {
        setAhora(Date.now());
        setBloqueadoHasta(r.bloqueadoHasta);
        setMensaje('Demasiados intentos. Espera para volver a intentar.');
      } else {
        setMensaje(`PIN incorrecto. Te quedan ${r.intentosRestantes} intento${r.intentosRestantes === 1 ? '' : 's'}.`);
      }
    } catch {
      setMensaje('No se pudo comprobar el PIN en este equipo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-surface-alt">
      <form onSubmit={enviar} className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center">
            <Lock size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-bold text-text-primary">Desbloquear</h1>
            <p className="text-sm text-text-secondary">{usuario.nombre} · sin conexión</p>
          </div>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={LARGO_PIN_MAX}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          disabled={enBloqueo || ocupado || pinPerdido}
          aria-label="PIN"
          placeholder="PIN"
          className="w-full px-4 py-3 border border-border rounded-lg text-center text-lg tracking-widest bg-surface text-text-primary"
        />
        {enBloqueo && (
          <p role="alert" className="text-sm text-red-600">
            Bloqueado por {segundosRestantes(bloqueadoHasta, ahora)} s.
          </p>
        )}
        {!enBloqueo && mensaje && <p role="alert" className="text-sm text-red-600">{mensaje}</p>}
        <button
          type="submit"
          disabled={enBloqueo || ocupado || pinPerdido || pin.length === 0}
          className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Desbloquear
        </button>
        <button
          type="button"
          onClick={onCerrarSesion}
          className="w-full text-sm text-text-secondary hover:text-text-primary"
        >
          Olvidé mi PIN / Cerrar sesión
        </button>
        <p className="text-xs text-text-muted">Tus pendientes sin enviar se conservan aunque cierres sesión.</p>
        <p className="text-xs text-text-muted">
          Este PIN solo protege el arranque de la app sin conexión. No protege contra quien tenga el equipo con internet,
          ni cifra los datos guardados en él. Tras demasiados intentos fallidos se cierra la sesión.
        </p>
      </form>
    </div>
  );
}

export default PantallaDesbloqueoPin;
