import { useState } from 'react';
import { Send } from 'lucide-react';
import { useAuth } from '../hooks/use-auth-context';
import { useToast } from '../hooks/use-toast-context';
import { useConfirm } from '../hooks/use-confirm-context';
import { desvincularTelegramMe } from '../services/usuario-service';
import { formatearFechaHora } from '../lib/fecha-negocio';
import TelegramUsuarioModal from './TelegramUsuarioModal';

/** Estado del Telegram del usuario en sesión, con acciones para vincular o desvincular (va en el perfil del menú). */
function TelegramPerfil() {
  const { usuario, recargarUsuario } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const [modalAbierto, setModalAbierto] = useState(false);
  if (!usuario) return null;

  const vinculado = Boolean(usuario.telegramVinculado);

  const desvincular = async () => {
    const ok = await confirmar({
      titulo: 'Desvincular Telegram',
      mensaje: 'Dejarás de recibir avisos privados en tu Telegram. Podrás vincularlo de nuevo cuando quieras.',
      confirmarLabel: 'Desvincular',
      variante: 'warning',
    });
    if (!ok) return;
    const r = await desvincularTelegramMe();
    if ('error' in r) {
      toast.errorMsg(r.error);
      return;
    }
    toast.exito('Telegram desvinculado.');
    await recargarUsuario();
  };

  return (
    <div className="mb-3 rounded-lg bg-brand-800/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 text-brand-100">
        <Send size={14} aria-hidden="true" />
        <span className="font-medium">Telegram</span>
      </div>
      <p className="mt-1 text-brand-300">
        {vinculado
          ? `Vinculado desde ${formatearFechaHora(usuario.telegramLinkedAt)}`
          : 'No vinculado'}
      </p>
      <div className="mt-1.5 flex gap-3">
        <button type="button" onClick={() => setModalAbierto(true)} className="font-medium text-brand-100 underline-offset-2 hover:underline">
          {vinculado ? 'Revincular' : 'Vincular'}
        </button>
        {vinculado && (
          <button type="button" onClick={desvincular} className="font-medium text-amber-300 underline-offset-2 hover:underline">
            Desvincular
          </button>
        )}
      </div>

      {modalAbierto && (
        <TelegramUsuarioModal
          usuarioId={usuario.id}
          nombre={usuario.nombre}
          esPropio
          linkedAtInicial={usuario.telegramLinkedAt ?? null}
          onClose={() => setModalAbierto(false)}
          onVinculado={() => {
            setModalAbierto(false);
            toast.exito('Telegram vinculado.');
            void recargarUsuario();
          }}
        />
      )}
    </div>
  );
}

export default TelegramPerfil;
