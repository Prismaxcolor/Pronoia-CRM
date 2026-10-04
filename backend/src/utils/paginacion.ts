/** PostgREST corta cada respuesta en 1000 filas. */
export const TAMANO_PAGINA = 1000;

/** Error de lectura que conserva el código de Postgres/PostgREST (p. ej. 42P01 = tabla inexistente). */
export class ErrorLecturaBd extends Error {
  readonly code?: string;
  constructor(error: { message: string; code?: string }) {
    super(error.message);
    this.name = 'ErrorLecturaBd';
    this.code = error.code;
  }
}

/**
 * Lee todas las filas de una consulta paginando por rangos de TAMANO_PAGINA.
 * La consulta debe traer un orden estable (p. ej. .order('id')) para que las
 * páginas no se solapen ni salten filas.
 */
export async function leerPaginado<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await consulta(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw new ErrorLecturaBd(error);
    const pagina = (data as T[] | null) ?? [];
    filas.push(...pagina);
    if (pagina.length < TAMANO_PAGINA) return filas;
  }
}

/** Ids por consulta `.in()`: evita URLs de PostgREST demasiado largas. */
export const IDS_POR_CONSULTA = 200;

/** Parte una lista en trozos de `tamano` elementos (sin mutar la original). */
export function trocear<T>(items: readonly T[], tamano: number = IDS_POR_CONSULTA): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) trozos.push(items.slice(i, i + tamano));
  return trozos;
}
