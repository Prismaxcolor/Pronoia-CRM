// Lista los grupos de Telegram donde está el bot (id, título, tipo) leyendo getUpdates.
// SOLO LECTURA: no envía mensajes, no cambia webhooks. NO imprime el token.
//
// Requisitos (el procedimiento completo está en el informe de la tarea de notificaciones al grupo):
//  1. Telegram NO permite getUpdates mientras el bot tiene un webhook activo (error 409).
//     El bot @PronAIScrapbot lo tiene porque el workflow "Vincular Telegram" (Telegram Trigger)
//     está activo. Hay que desactivarlo unos minutos, correr este script y reactivarlo.
//  2. El token del bot se pasa por variable de entorno, solo en esta sesión de terminal:
//       PowerShell:  $env:TELEGRAM_BOT_TOKEN = Read-Host "token"   (luego: Remove-Item Env:TELEGRAM_BOT_TOKEN)
//       bash:        read -s TELEGRAM_BOT_TOKEN; export TELEGRAM_BOT_TOKEN
//     Nunca lo escribas en un archivo del repo (es público).
//
// Uso: npx tsx scripts/obtener-chat-id-grupo.ts
//
// Los updates NO se confirman (no se envía offset), así que al reactivar el webhook de n8n
// Telegram vuelve a entregarlos y el bot no pierde nada.

import { extraerGrupos } from '../src/utils/telegram-grupos.js';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error('Falta la variable de entorno TELEGRAM_BOT_TOKEN (ver instrucciones al inicio del script).');
  process.exit(1);
}

/** Quita el token de cualquier texto antes de mostrarlo. */
const sinToken = (texto: string): string => texto.split(token).join('[token]');

const TIMEOUT_MS = 15_000;

async function leerUpdates(): Promise<unknown> {
  const respuesta = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100&allowed_updates=${encodeURIComponent('["my_chat_member","message","channel_post"]')}`, {
    method: 'GET',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await respuesta.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string; error_code?: number } | null;
  if (!json?.ok) {
    if (json?.error_code === 409) {
      throw new Error(
        'Telegram responde 409: el bot tiene un webhook activo. Desactiva el workflow "Vincular Telegram" en n8n, ' +
        'espera ~10 segundos, vuelve a correr este script y reactiva el workflow después.'
      );
    }
    throw new Error(`Telegram respondió error: ${sinToken(json?.description ?? `HTTP ${respuesta.status}`)}`);
  }
  return json.result;
}

try {
  const grupos = extraerGrupos(await leerUpdates());
  if (grupos.length === 0) {
    console.log(
      'No se vio ningún grupo. Añade el bot al grupo (o escribe cualquier mensaje en él) y vuelve a correr el script. ' +
      'Telegram solo conserva los updates 24 horas.'
    );
  } else {
    console.log('Grupos detectados (copia el chatId, incluido el signo "-", en el nodo "Config" del workflow):\n');
    for (const g of grupos) {
      console.log(`  chatId: ${g.chatId}   tipo: ${g.tipo}   título: "${g.titulo}"   (visto en: ${g.origen})`);
    }
  }
} catch (err) {
  console.error(sinToken(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
