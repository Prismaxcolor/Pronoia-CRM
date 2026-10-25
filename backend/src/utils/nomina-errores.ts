/**
 * Traducción de errores de BD del módulo de nómina. Son datos personales sensibles: el mensaje crudo de Postgres
 * (p. ej. una violación de unicidad cita la cédula) NUNCA se registra ni se devuelve; solo el código.
 */
import { esObjetoInexistente } from './migracion-pendiente.js';
import { esMensajeDeNegocio, mensajeDeErrorBd } from './errores-bd.js';
import { logger } from './logger.js';

export interface FalloNomina {
  error: string;
  codigo: number;
  /** Datos extra que se devuelven junto al error (p. ej. los renglones con total negativo). */
  extra?: Record<string, unknown>;
}

interface ErrorBd {
  code?: string;
  message?: string;
}

export const MENSAJE_NOMINA_NO_HABILITADA =
  'La nómina aún no está habilitada en la base de datos (falta aplicar migration_nomina.sql).';

/** 503 si falta la migración, 404/409 para errores de negocio de las funciones SQL, 500 (genérico) en el resto. */
export function falloNomina(error: ErrorBd | null | undefined, operacion: string, porDefecto: string, duplicado?: string): FalloNomina {
  if (esObjetoInexistente(error)) return { error: MENSAJE_NOMINA_NO_HABILITADA, codigo: 503 };
  if (error?.code === '23505') return { error: duplicado ?? 'Ya existe un registro igual.', codigo: 409 };
  if (error?.code === 'P0002') return { error: 'No se encontró el registro.', codigo: 404 };
  if (esMensajeDeNegocio(error)) return { error: mensajeDeErrorBd(error), codigo: 409 };
  logger.error({ evento: 'nomina_error_bd', operacion, codigoBd: error?.code ?? null });
  return { error: porDefecto, codigo: 500 };
}
