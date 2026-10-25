import type { Banca } from '@shared/types/index.js';

/** Id de chat de Telegram: numérico (los grupos son negativos, p. ej. -1001234567890). */
const PATRON_CHAT_ID = /^-?\d{5,20}$/;

export const esChatIdTelegramValido = (valor: string): boolean => PATRON_CHAT_ID.test(valor.trim());

/** Texto del formulario a valor guardado: recortado, vacío => null (usa el grupo general de cajas). */
export function normalizarChatIdTelegram(valor: string): string | null {
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

export interface GrupoTelegramConocido {
  chatId: string;
  /** Nombres de las bancas que ya envían a este grupo. */
  bancas: string[];
}

/** Grupos que ya usa alguna banca, para reutilizarlos sin volver a escribir el id. Sin mutar la entrada. */
export function gruposTelegramConocidos(bancas: readonly Banca[]): GrupoTelegramConocido[] {
  const porChat = new Map<string, string[]>();
  for (const b of bancas) {
    if (!b.telegramChatId) continue;
    porChat.set(b.telegramChatId, [...(porChat.get(b.telegramChatId) ?? []), b.nombre]);
  }
  return [...porChat].map(([chatId, nombres]) => ({ chatId, bancas: nombres }));
}
