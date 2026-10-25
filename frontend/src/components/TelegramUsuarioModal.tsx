import { useCallback, useRef } from 'react';
import TelegramLinkModal from './TelegramLinkModal';
import {
  generarLinkTelegramMe,
  generarLinkTelegramUsuario,
  leerTelegramMe,
  leerTelegramUsuario,
} from '../services/usuario-service';

interface Props {
  /** Id del usuario a enlazar; si es el propio, se usa la ruta 'me'. */
  usuarioId: string;
  nombre: string;
  esPropio: boolean;
  /** Fecha de enlace actual (o null): sirve para detectar un re-enlace, no solo el primero. */
  linkedAtInicial: string | null;
  onClose: () => void;
  onVinculado: () => void;
}

/** TelegramLinkModal conectado al enlace de usuarios del sistema (propio o, siendo superadmin, de otro). */
function TelegramUsuarioModal({ usuarioId, nombre, esPropio, linkedAtInicial, onClose, onVinculado }: Props) {
  const linkedAtRef = useRef(linkedAtInicial);

  const generarLink = useCallback(
    () => (esPropio ? generarLinkTelegramMe() : generarLinkTelegramUsuario(usuarioId)),
    [esPropio, usuarioId],
  );

  const yaVinculado = useCallback(async () => {
    const estado = esPropio ? await leerTelegramMe() : await leerTelegramUsuario(usuarioId);
    return Boolean(estado?.vinculado) && estado?.linkedAt !== linkedAtRef.current;
  }, [esPropio, usuarioId]);

  return (
    <TelegramLinkModal
      nombreEntidad={nombre}
      generarLink={generarLink}
      yaVinculado={yaVinculado}
      onClose={onClose}
      onVinculado={onVinculado}
    />
  );
}

export default TelegramUsuarioModal;
