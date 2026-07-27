import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(o => o.trim()).filter(Boolean);
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
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',
  /** Webhook de n8n que recibe {tipoDocumento, chatId, nombreEntidad, url, nombreArchivo}
   *  y hace la entrega real por Telegram. Si falta, notificarDocumento no hace nada
   *  (no rompe el flujo de negocio que lo dispara). */
  N8N_WEBHOOK_ENVIAR_DOCUMENTO: process.env.N8N_WEBHOOK_ENVIAR_DOCUMENTO || '',
  /** Webhook de n8n que manda el link de acceso al portal por Telegram. */
  N8N_WEBHOOK_PORTAL_LOGIN: process.env.N8N_WEBHOOK_PORTAL_LOGIN || '',
  /** Base del portal para armar el link de acceso (ej. https://portal.pronoiascrap.com). */
  PORTAL_URL: process.env.PORTAL_URL || 'http://localhost:5173',
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
