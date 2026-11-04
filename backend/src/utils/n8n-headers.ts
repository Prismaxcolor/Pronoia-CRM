import { obtenerSecreto } from '../config/secretos.js';

export const HEADER_SECRETO_N8N = 'X-Pronoia-Secret';

/** Cabeceras JSON para llamar a un webhook de n8n. Agrega X-Pronoia-Secret solo si
 *  N8N_WEBHOOK_SECRET existe (variable de entorno o tabla configuracion_secreta);
 *  sin secreto no se envía el header (retrocompatible con n8n sin verificación). */
export async function cabecerasWebhookN8n(): Promise<Record<string, string>> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  const secreto = await obtenerSecreto('N8N_WEBHOOK_SECRET');
  if (secreto) cabeceras[HEADER_SECRETO_N8N] = secreto;
  return cabeceras;
}
