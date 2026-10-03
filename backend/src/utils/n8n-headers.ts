import { ENV } from '../config/env.js';

export const HEADER_SECRETO_N8N = 'X-Pronoia-Secret';

/** Cabeceras JSON para llamar a un webhook de n8n. Agrega X-Pronoia-Secret solo si
 *  N8N_WEBHOOK_SECRET está definido (retrocompatible con n8n sin verificación). */
export function cabecerasWebhookN8n(): Record<string, string> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ENV.N8N_WEBHOOK_SECRET) cabeceras[HEADER_SECRETO_N8N] = ENV.N8N_WEBHOOK_SECRET;
  return cabeceras;
}
