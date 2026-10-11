/**
 * Traduce errores de Postgres/PostgREST a textos propios. Los mensajes crudos pueden traer
 * nombres de tablas, columnas o valores internos, así que NO se devuelven al cliente, salvo los
 * `raise exception` que las funciones SQL lanzan a propósito para mostrar (SQLSTATE P0001):
 * esos ya son mensajes de negocio en español.
 */
interface ErrorBd {
  code?: string;
  message?: string;
}

export const MENSAJE_ERROR_GENERICO = 'No se pudo completar la operación. Intenta de nuevo.';

const TEXTO_POR_CODIGO: Record<string, string> = {
  '22P02': 'Algún dato tiene un formato inválido (por ejemplo un identificador).',
  '22003': 'Algún número está fuera del rango permitido.',
  '23502': 'Falta un dato obligatorio.',
  '23503': 'Un registro relacionado no existe.',
  '23505': 'Ya existe un registro igual.',
  '23514': 'Algún valor está fuera del rango permitido.',
  '40001': 'Otra operación se cruzó con esta. Intenta de nuevo.',
  '40P01': 'Otra operación se cruzó con esta. Intenta de nuevo.',
  '57014': 'La operación tardó demasiado y se canceló. Intenta de nuevo.',
};

/** Mensajes nativos de Postgres para 42501 (insufficient_privilege): son técnicos y NO se muestran. */
const MENSAJE_NATIVO_PRIVILEGIOS = /permission denied|must be (owner|superuser)|row-level security|insufficient privilege|violates/i;

/**
 * True si es un guardián de negocio de un trigger/función SQL que usa `errcode = '42501'` (p. ej. "los asientos de
 * la mesa de cambio no se borran: se anulan"). Su mensaje está en español y es apto para el usuario; los errores
 * nativos de privilegios de Postgres (en inglés, con nombres de tablas) quedan fuera.
 */
export function esGuardianDeNegocio(error: ErrorBd | null | undefined): boolean {
  return error?.code === '42501' && !!error.message && !MENSAJE_NATIVO_PRIVILEGIOS.test(error.message);
}

/**
 * True si el error es un `raise exception` de negocio de una función SQL (mensaje apto para el usuario):
 * SQLSTATE P0001 o un guardián de negocio con errcode 42501. Los servicios lo responden como 409.
 */
export function esMensajeDeNegocio(error: ErrorBd | null | undefined): boolean {
  return (error?.code === 'P0001' && !!error.message) || esGuardianDeNegocio(error);
}

export function mensajeDeErrorBd(error: ErrorBd | null | undefined, respaldo: string = MENSAJE_ERROR_GENERICO): string {
  if (!error) return respaldo;
  if (esMensajeDeNegocio(error)) return error.message as string;
  return (error.code && TEXTO_POR_CODIGO[error.code]) || respaldo;
}
