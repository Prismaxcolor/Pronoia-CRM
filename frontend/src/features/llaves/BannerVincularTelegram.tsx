import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { useAuth } from '../../hooks/use-auth-context';

/**
 * Aviso discreto, solo para superadmin sin Telegram vinculado: las solicitudes de llave le llegan
 * por chat privado y desde ahí las aprueba. El enlace lleva a la tarjeta de Telegram del perfil.
 */
function BannerVincularTelegram() {
  const { usuario } = useAuth();

  if (!usuario || usuario.rol !== 'superadmin' || usuario.telegramVinculado) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden"
    >
      <Send size={16} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1">
        Vincula tu Telegram para recibir las solicitudes de llave y aprobarlas desde el chat.
      </span>
      <Link
        to="/perfil#telegram"
        className="inline-flex min-h-9 items-center rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        Vincular ahora
      </Link>
    </div>
  );
}

export default BannerVincularTelegram;
