import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(o => o.trim()).filter(Boolean);
}

const ES_PRODUCCION = process.env.NODE_ENV === 'production';
const N8N_BASE_PRODUCCION = 'https://evo-n8n-pronoia.xgwlbt.easypanel.host/webhook';

/** URL por defecto de un webhook de n8n: SOLO en producción (Vercel). En development/test
 *  queda vacía a propósito, para que ningún entorno local/CI envíe mensajes reales a
 *  proveedores o clientes. Para probar en local hay que fijar la variable explícitamente. */
function webhookN8n(valor: string | undefined, rutaProduccion: string): string {
  if (valor) return valor;
  return ES_PRODUCCION ? `${N8N_BASE_PRODUCCION}/${rutaProduccion}` : '';
}

export const ENV = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  CORS_ORIGINS: parseOrigins(process.env.CORS_ORIGINS),
  /** Username del bot de Telegram (sin @) para vincular proveedores/clientes. */
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || 'PronAIScrapbot',
  /** Webhook de n8n que recibe {tipoDocumento, chatId, nombreEntidad, url, nombreArchivo}
   *  y hace la entrega real por Telegram. Si falta, notificarDocumento no hace nada
   *  (no rompe el flujo de negocio que lo dispara). */
  N8N_WEBHOOK_ENVIAR_DOCUMENTO:
    webhookN8n(process.env.N8N_WEBHOOK_ENVIAR_DOCUMENTO, 'enviar-documento-pronoia'),
  /** Webhook del workflow v2 de n8n ("Enviar Contenido a Proveedor/Cliente"): entrega por
   *  Telegram documentos, fotos/álbumes y mensajes de texto (campo `accion`). Variable
   *  nueva a propósito: N8N_WEBHOOK_ENVIAR_DOCUMENTO sigue apuntando al workflow v1 (solo
   *  documentos) y puede estar fijada así en Vercel. */
  N8N_WEBHOOK_ENVIAR_CONTENIDO:
    webhookN8n(process.env.N8N_WEBHOOK_ENVIAR_CONTENIDO, 'enviar-contenido-pronoia'),
  /** Webhook de n8n que manda el link de acceso al portal por Telegram. */
  N8N_WEBHOOK_PORTAL_LOGIN:
    webhookN8n(process.env.N8N_WEBHOOK_PORTAL_LOGIN, 'portal-enviar-link-acceso'),
  /** Secreto compartido OPCIONAL con n8n: si existe, se envía en el header X-Pronoia-Secret
   *  en cada llamada a los webhooks. Sin valor por defecto (el repo es público); se carga
   *  solo como variable de entorno. Sin variable no se envía header (retrocompatible). */
  N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET || '',
  /** Webhook de n8n ("Notificar Grupo Pronoia") que recibe {texto, parseMode, documentoUrl?,
   *  nombreArchivo?, fotos?[]} y lo manda al grupo interno de Telegram. El chat id del grupo
   *  vive en el workflow de n8n, no aquí. */
  N8N_WEBHOOK_GRUPO:
    webhookN8n(process.env.N8N_WEBHOOK_GRUPO, 'notificar-grupo-pronoia'),
  /** Chat id (negativo, ej. -1001234567890) del grupo de Telegram "P.S Cajas Pagos": ahí van los
   *  movimientos de dinero (pagos, cobros, cruces, bancas, notas). OPCIONAL: sin valor no se envía
   *  nada de dinero a Telegram y el sistema sigue igual. La entrega usa N8N_WEBHOOK_ENVIAR_CONTENIDO
   *  con este chatId, así que el bot (admin del grupo) es el del workflow de n8n.
   *  Opcional: la clave también puede estar en public.configuracion_secreta. El servicio de cajas la
   *  lee con obtenerSecreto (config/secretos.ts), no de este campo. */
  TELEGRAM_CAJAS_CHAT_ID: (process.env.TELEGRAM_CAJAS_CHAT_ID || '').trim(),
  /** Interruptor general de las notificaciones al grupo ('false' las apaga). Apagado en tests. */
  GRUPO_NOTIFICACIONES_ACTIVAS: process.env.GRUPO_NOTIFICACIONES !== 'false' && process.env.NODE_ENV !== 'test',
  /** Eventos a silenciar, separados por coma: claves ("ticket.editado") o categorías ("maestros"). */
  GRUPO_EVENTOS_SILENCIADOS: (process.env.GRUPO_EVENTOS_SILENCIADOS || '')
    .split(',').map(s => s.trim()).filter(Boolean),
  /** true = también se avisan los eventos ruidosos (cada pesada de una toma física, etc.). */
  GRUPO_INCLUIR_RUIDOSOS: process.env.GRUPO_INCLUIR_RUIDOSOS === 'true',
  /** Zona horaria (IANA) con la que se muestra la hora en los mensajes del grupo. */
  GRUPO_ZONA_HORARIA: process.env.GRUPO_ZONA_HORARIA || 'America/Caracas',
  /** Base del portal para armar el link de acceso (ej. https://portal.pronoiascrap.com). */
  PORTAL_URL: process.env.PORTAL_URL || 'https://pronoia-crm.vercel.app',
  /** Secreto para firmar sesiones del portal de proveedores/clientes — deliberadamente
   *  distinto del JWT_SECRET del staff (un token robado de un lado nunca sirve en el
   *  otro). Sin variable propia, se deriva de JWT_SECRET (que ya es obligatorio) para
   *  no agregar una variable de entorno nueva obligatoria que rompa despliegues
   *  existentes — se puede sobreescribir con PORTAL_JWT_SECRET si se prefiere. */
  PORTAL_JWT_SECRET: process.env.PORTAL_JWT_SECRET || `portal-session:${process.env.JWT_SECRET || ''}`,
} as const;

if (!ENV.JWT_SECRET || ENV.JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET debe tener al menos 32 caracteres. Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
  );
}

if (ENV.NODE_ENV === 'production' && ENV.CORS_ORIGINS.length === 0) {
  throw new Error(
    'CORS_ORIGINS es obligatorio en producción. Define los orígenes permitidos separados por coma. Ej: CORS_ORIGINS=https://app.pronoia.com,https://admin.pronoia.com'
  );
}
