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
