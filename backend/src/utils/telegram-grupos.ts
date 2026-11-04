/** Un grupo/supergrupo/canal visto en los updates de getUpdates de Telegram. */
export interface GrupoDetectado {
  chatId: number;
  titulo: string;
  tipo: string;
  /** Tipo de update donde se vio ("my_chat_member", "message", ...). */
  origen: string;
}

const TIPOS_GRUPO = new Set(['group', 'supergroup', 'channel']);
const CLAVES_UPDATE_CON_CHAT = ['my_chat_member', 'chat_member', 'message', 'edited_message', 'channel_post', 'edited_channel_post'];

function esRegistro(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Extrae los grupos distintos de una respuesta de getUpdates. Solo lee id, título y tipo
 * del chat: no copia mensajes, nombres de personas ni nada más.
 */
export function extraerGrupos(updates: unknown): GrupoDetectado[] {
  if (!Array.isArray(updates)) return [];
  const vistos = new Map<number, GrupoDetectado>();
  for (const update of updates) {
    if (!esRegistro(update)) continue;
    for (const clave of CLAVES_UPDATE_CON_CHAT) {
      const chat = esRegistro(update[clave]) ? update[clave].chat : undefined;
      if (!esRegistro(chat) || typeof chat.id !== 'number' || typeof chat.type !== 'string') continue;
      if (!TIPOS_GRUPO.has(chat.type)) continue;
      // my_chat_member tiene prioridad como origen: es el evento de "me añadieron al grupo".
      const previo = vistos.get(chat.id);
      if (previo && previo.origen === 'my_chat_member') continue;
      vistos.set(chat.id, {
        chatId: chat.id,
        titulo: typeof chat.title === 'string' ? chat.title : '(sin título)',
        tipo: chat.type,
        origen: clave,
      });
    }
  }
  return [...vistos.values()];
}
