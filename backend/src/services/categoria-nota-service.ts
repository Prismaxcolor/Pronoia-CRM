import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { logger } from '../utils/logger.js';
import { MENSAJE_ERROR_GENERICO } from '../utils/errores-bd.js';
import { categoriaParaMostrar, validarCategoriaParaNota, type CategoriaDeNota } from '../utils/categoria-nota.js';
import { listarCategorias, type FalloCategoria } from './categoria-service.js';

export type TablaNota = 'notas_ajuste_proveedor' | 'notas_ajuste_cliente';

export const MENSAJE_NOTAS_CATEGORIA_PENDIENTE =
  'La categoría en notas aún no está habilitada en la base de datos (falta aplicar migration_notas_categoria.sql). Guarda la nota sin categoría o aplica la migración.';

/** Rechazo (con código HTTP) si la categoría no sirve para una nota; null si sirve o no hay categoría. */
export async function validarCategoriaDeNota(categoriaId: string | null | undefined): Promise<FalloCategoria | null> {
  if (!categoriaId) return null;
  const lista = await listarCategorias();
  if ('error' in lista) return lista;
  const rechazo = validarCategoriaParaNota(categoriaId, lista.categorias);
  return rechazo ? { error: rechazo, codigo: 400 } : null;
}

/**
 * Categorías de varias notas, indexadas por id, para mostrarlas. Sin ids no consulta la BD. Si falla la lectura
 * devuelve un mapa vacío (las notas se muestran sin categoría): la categoría es un complemento de la nota.
 */
export async function categoriasParaNotas(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, CategoriaDeNota>> {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const resultado = new Map<string, CategoriaDeNota>();
  if (unicos.length === 0) return resultado;
  const lista = await listarCategorias();
  if ('error' in lista) return resultado;
  for (const id of unicos) {
    const categoria = categoriaParaMostrar(id, lista.categorias);
    if (categoria) resultado.set(id, categoria);
  }
  return resultado;
}

interface FilaNotaCategoria { id: string; anulada: boolean; categoria_id?: string | null }

/**
 * Cambia (o quita, con null) la categoría de una nota de la entidad. No toca montos ni saldos, por eso no pide
 * llave de edición; el permiso de editar de la entidad se valida en la ruta. Una nota anulada no se modifica.
 */
export async function asignarCategoriaNota(
  tabla: TablaNota,
  columnaEntidad: 'proveedor_id' | 'cliente_id',
  entidadId: string,
  notaId: string,
  categoriaId: string | null
): Promise<{ ok: true; anterior: string | null } | FalloCategoria> {
  const { data, error } = await supabaseAdmin
    .from(tabla)
    .select('id, anulada, categoria_id')
    .eq('id', notaId)
    .eq(columnaEntidad, entidadId)
    .maybeSingle();
  if (error) return fallo(error, 'leer_nota');
  if (!data) return { error: 'Nota no encontrada.', codigo: 404 };
  if ((data as FilaNotaCategoria).anulada) return { error: 'La nota está anulada y no se puede modificar.', codigo: 409 };
  const invalida = await validarCategoriaDeNota(categoriaId);
  if (invalida) return invalida;
  // anulada = false en el UPDATE: si una anulación se cuela entre la lectura y la escritura, no se toca la nota.
  const { data: actualizadas, error: errorEscritura } = await supabaseAdmin
    .from(tabla)
    .update({ categoria_id: categoriaId })
    .eq('id', notaId)
    .eq('anulada', false)
    .select('id');
  if (errorEscritura) return fallo(errorEscritura, 'asignar');
  if (!actualizadas || actualizadas.length === 0) return { error: 'La nota está anulada.', codigo: 409 };
  return { ok: true, anterior: (data as FilaNotaCategoria).categoria_id ?? null };
}

function fallo(error: { code?: string; message?: string }, contexto: string): FalloCategoria {
  if (esObjetoInexistente(error)) return { error: MENSAJE_NOTAS_CATEGORIA_PENDIENTE, codigo: 503 };
  logger.error({ evento: 'categoria_nota_error', contexto, codigoBd: error.code, mensaje: error.message });
  return { error: MENSAJE_ERROR_GENERICO, codigo: 500 };
}

interface RespuestaLectura { data: unknown; error: { code?: string; message?: string } | null }

/**
 * Lee con la columna categoria_id y, si la migración aún no está aplicada (columna inexistente), reintenta sin ella:
 * las notas se siguen leyendo, solo que sin categoría.
 */
export async function leerConCategoria(
  consulta: (columnas: string) => PromiseLike<RespuestaLectura>,
  columnasBase: string
): Promise<RespuestaLectura> {
  const respuesta = await consulta(`${columnasBase}, categoria_id`);
  if (!respuesta.error || !esObjetoInexistente(respuesta.error)) return respuesta;
  return consulta(columnasBase);
}
