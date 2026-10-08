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

/** True si el error es un `raise exception` de negocio de una función SQL (mensaje apto para el usuario). */
export function esMensajeDeNegocio(error: ErrorBd | null | undefined): boolean {
  return error?.code === 'P0001' && !!error.message;
}

export function mensajeDeErrorBd(error: ErrorBd | null | undefined, respaldo: string = MENSAJE_ERROR_GENERICO): string {
  if (!error) return respaldo;
  if (esMensajeDeNegocio(error)) return error.message as string;
  return (error.code && TEXTO_POR_CODIGO[error.code]) || respaldo;
}
