import { useState } from 'react';
import { useAuth } from '../hooks/use-auth-context';
import { useToast } from '../hooks/use-toast-context';
import { useConfirm } from '../hooks/use-confirm-context';
import { desvincularTelegramMe } from '../services/usuario-service';
import { formatearFechaHora } from '../lib/fecha-negocio';
import TelegramUsuarioModal from './TelegramUsuarioModal';

/** Estado del Telegram del usuario en sesión, con acciones para vincular o desvincular (va en la pantalla de perfil). */
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
    <div className="text-sm">
      <p className="font-medium text-text-primary">
        {vinculado
          ? `Vinculado desde ${formatearFechaHora(usuario.telegramLinkedAt)}`
          : 'No vinculado'}
      </p>
      {usuario.rol === 'superadmin' && (
        <p className="mt-1 text-xs text-text-secondary">
          Así recibes las solicitudes de llave de edición y las apruebas desde el chat.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setModalAbierto(true)}
          className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-text-on-brand hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {vinculado ? 'Revincular' : 'Vincular'}
        </button>
        {vinculado && (
          <button
            type="button"
            onClick={desvincular}
            className="min-h-11 rounded-lg border border-border-strong px-4 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
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
