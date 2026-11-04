import { useState } from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { browserSupportsWebAuthn } from '../../services/passkey-service';
import { clasificarErrorPasskey, MENSAJE_PASSKEY_LOGIN_FALLIDO } from '../../lib/passkey-logica';
import { mensajeAmigable } from '../../lib/mensaje-error';

interface Props {
  remember: boolean;
  /** Muestra (o limpia con null) un mensaje de error en el formulario de login. */
  onError: (mensaje: string | null) => void;
  disabled?: boolean;
}

/** Botón "Entrar con passkey" del login. No se muestra si el navegador no admite WebAuthn. */
function BotonPasskeyLogin({ remember, onError, disabled }: Props) {
  const { loginConPasskey } = useAuth();
  const toast = useToast();
  const [cargando, setCargando] = useState(false);

  if (!browserSupportsWebAuthn()) return null;

  const entrar = async () => {
    setCargando(true);
    onError(null);
    try {
      await loginConPasskey(remember);
      toast.exito('Bienvenido.');
    } catch (err) {
      const porDefecto = mensajeAmigable(err, { porDefecto: MENSAJE_PASSKEY_LOGIN_FALLIDO, mensajesLocales: true });
      const clasificado = clasificarErrorPasskey(err, porDefecto);
      // Cancelar el diálogo del dispositivo no es un error: no se muestra nada.
      if (clasificado.mensaje) onError(clasificado.mensaje);
    } finally {
      setCargando(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void entrar()}
      disabled={disabled || cargando}
      className="mt-3 flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-brand-600 py-3 text-sm font-semibold text-brand-700
                 transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {cargando
        ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Esperando tu dispositivo...</>
        : <><Fingerprint size={16} aria-hidden="true" /> Entrar con passkey</>}
    </button>
  );
}

export default BotonPasskeyLogin;
