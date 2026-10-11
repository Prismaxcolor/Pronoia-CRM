import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { esMensajeDeNegocio, MENSAJE_ERROR_GENERICO } from '../utils/errores-bd.js';
import { logger } from '../utils/logger.js';
import {
  tipoHijoCabeEnPadre, validarCategoriaParaMovimiento, validarPadreDeCategoria,
  type CategoriaFila, type TipoCategoria, type TipoMovimientoWallet,
} from '../utils/categoria-wallet.js';
import type { ActualizarCategoriaInput, CrearCategoriaInput } from '../schemas/categorias-wallet.js';

/** Espejo de shared/types/categoria-wallet.ts (se duplica por la misma razón que utils/permisos.ts). */
export interface Categoria extends CategoriaFila {
  creadoEn: string;
}

export type FalloCategoria = { error: string; codigo: number };

export const MENSAJE_CATEGORIAS_PENDIENTE =
  'Las categorías del Wallet aún no están habilitadas en la base de datos (falta aplicar migration_wallet_categorias.sql).';
const MENSAJE_NOMBRE_REPETIDO = 'Ya existe una categoría con ese nombre en ese nivel.';
/** Tope de filas al leer categorías (son pocas; el tope solo acota la consulta). */
const LIMITE_CATEGORIAS = 2000;

interface ErrorBd { code?: string; message?: string }

/** Traduce un error de BD a un fallo con código HTTP, sin filtrar mensajes internos. */
function fallo(error: ErrorBd, contexto: string): FalloCategoria {
  if (esObjetoInexistente(error)) return { error: MENSAJE_CATEGORIAS_PENDIENTE, codigo: 503 };
  if (error.code === '23505') return { error: MENSAJE_NOMBRE_REPETIDO, codigo: 409 };
  if (esMensajeDeNegocio(error)) return { error: error.message as string, codigo: 409 };
  logger.error({ evento: 'categoria_wallet_error', contexto, codigoBd: error.code, mensaje: error.message });
  return { error: MENSAJE_ERROR_GENERICO, codigo: 500 };
}

function mapCategoria(row: Record<string, unknown>): Categoria {
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    tipo: row.tipo as TipoCategoria,
    color: row.color as string,
    padreId: (row.padre_id as string) ?? null,
    activo: Boolean(row.activo),
    creadoEn: row.created_at as string,
  };
}

export async function listarCategorias(): Promise<{ categorias: Categoria[] } | FalloCategoria> {
  const { data, error } = await supabaseAdmin.from('categorias_wallet').select('*').order('nombre').limit(LIMITE_CATEGORIAS);
  if (error) return fallo(error, 'listar');
  return { categorias: ((data as Array<Record<string, unknown>> | null) ?? []).map(mapCategoria) };
}

export async function crearCategoria(input: CrearCategoriaInput, userId: string): Promise<{ categoria: Categoria } | FalloCategoria> {
  const lista = await listarCategorias();
  if ('error' in lista) return lista;
  const rechazo = validarPadreDeCategoria(input.padreId, input.tipo, lista.categorias);
  if (rechazo) return { error: rechazo, codigo: 400 };
  const { data, error } = await supabaseAdmin
    .from('categorias_wallet')
    .insert({ nombre: input.nombre, tipo: input.tipo, color: input.color, padre_id: input.padreId, created_by: userId })
    .select()
    .single();
  if (error || !data) return fallo(error ?? {}, 'crear');
  return { categoria: mapCategoria(data) };
}

/** Mensaje si el cambio de tipo o de estado rompe la relación con el padre o con las subcategorías; null si es válido. */
function conflictoDeCambio(actual: Categoria, input: ActualizarCategoriaInput, todas: readonly Categoria[]): string | null {
  const tipo = input.tipo ?? actual.tipo;
  const padre = actual.padreId ? todas.find(c => c.id === actual.padreId) : undefined;
  if (padre && !tipoHijoCabeEnPadre(padre.tipo, tipo)) {
    return `El tipo de una subcategoría no puede ser más amplio que el de su categoría "${padre.nombre}".`;
  }
  if (!padre && input.tipo && todas.some(h => h.padreId === actual.id && !tipoHijoCabeEnPadre(tipo, h.tipo))) {
    return 'Hay subcategorías con un tipo que no cabe en el nuevo tipo: cámbialas primero.';
  }
  if (input.activo === true && padre && !padre.activo) return 'La categoría padre está archivada: restáurala primero.';
  return null;
}

export async function actualizarCategoria(id: string, input: ActualizarCategoriaInput): Promise<{ categoria: Categoria } | FalloCategoria> {
  const lista = await listarCategorias();
  if ('error' in lista) return lista;
  const actual = lista.categorias.find(c => c.id === id);
  if (!actual) return { error: 'Categoría no encontrada.', codigo: 404 };
  const conflicto = conflictoDeCambio(actual, input, lista.categorias);
  if (conflicto) return { error: conflicto, codigo: 409 };
  const { data, error } = await supabaseAdmin.from('categorias_wallet').update(input).eq('id', id).select().maybeSingle();
  if (error || !data) return fallo(error ?? {}, 'actualizar');
  // Archivar una categoría archiva sus subcategorías: ya no se ofrecen al registrar (los movimientos las conservan).
  if (input.activo === false && actual.padreId === null) {
    const { error: errorHijas } = await supabaseAdmin.from('categorias_wallet').update({ activo: false }).eq('padre_id', id);
    if (errorHijas) return fallo(errorHijas, 'archivar_subcategorias');
  }
  return { categoria: mapCategoria(data) };
}

/**
 * Valida la categoría de un movimiento nuevo (ingreso o egreso). Sin categoría no consulta la BD,
 * así el Wallet sigue funcionando aunque la migración de categorías no esté aplicada.
 */
export async function validarCategoriaDeMovimiento(
  categoriaId: string | null | undefined,
  tipo: TipoMovimientoWallet
): Promise<FalloCategoria | null> {
  if (!categoriaId) return null;
  const lista = await listarCategorias();
  if ('error' in lista) return lista;
  const rechazo = validarCategoriaParaMovimiento(categoriaId, lista.categorias, tipo);
  return rechazo ? { error: rechazo, codigo: 400 } : null;
}

interface FilaMovimientoCategoria { id: string; tipo: TipoMovimientoWallet; anulado: boolean; subtipo: string | null; grupo_id: string | null }

/** Rechazo (409) si el movimiento no admite cambiar su categoría; null si sí. */
function rechazoDeMovimiento(m: FilaMovimientoCategoria): FalloCategoria | null {
  if (m.anulado) return { error: 'Este movimiento está anulado.', codigo: 409 };
  if (m.tipo === 'transferencia') return { error: 'Las transferencias no llevan categoría.', codigo: 409 };
  if (m.subtipo !== null || m.grupo_id !== null) {
    return { error: 'Este movimiento forma parte de un pago o cobro y no lleva categoría.', codigo: 409 };
  }
  return null;
}

/**
 * Asigna (o quita, con null) la categoría de un movimiento manual vigente. No toca montos ni saldos,
 * por eso no exige llave de edición; el permiso de editar Wallet y el acceso a la cuenta se validan en la ruta.
 */
export async function asignarCategoriaMovimiento(
  movimientoId: string,
  categoriaId: string | null
): Promise<{ ok: true } | FalloCategoria> {
  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .select('id, tipo, anulado, subtipo, grupo_id')
    .eq('id', movimientoId)
    .maybeSingle();
  if (error) return fallo(error, 'leer_movimiento');
  if (!data) return { error: 'Movimiento no encontrado.', codigo: 404 };
  const movimiento = data as unknown as FilaMovimientoCategoria;
  const rechazo = rechazoDeMovimiento(movimiento);
  if (rechazo) return rechazo;
  const invalida = await validarCategoriaDeMovimiento(categoriaId, movimiento.tipo);
  if (invalida) return invalida;
  const { error: errorEscritura } = await supabaseAdmin.from('movimientos').update({ categoria_id: categoriaId }).eq('id', movimientoId);
  if (errorEscritura) return fallo(errorEscritura, 'asignar');
  return { ok: true };
}

const MENSAJE_CATEGORIA_NO_GUARDADA =
  'El movimiento se registró, pero no se pudo asignar la categoría. Asígnala desde la tabla de movimientos.';

/**
 * Los caminos que crean el movimiento por una RPC (p. ej. con comisión bancaria) no llevan la categoría:
 * si el movimiento creado no la trae, se la aplica con un update. Devuelve un resultado nuevo (no muta el recibido).
 */
export async function aplicarCategoriaSiFalta<T extends { movimiento: { id: string; categoriaId: string | null }; advertencia?: string }>(
  resultado: T,
  categoriaId: string | null | undefined
): Promise<T> {
  if (!categoriaId || resultado.movimiento.categoriaId === categoriaId) return resultado;
  const { error } = await supabaseAdmin.from('movimientos').update({ categoria_id: categoriaId }).eq('id', resultado.movimiento.id);
  if (!error) return { ...resultado, movimiento: { ...resultado.movimiento, categoriaId } };
  logger.error({ evento: 'movimiento_categoria_no_aplicada', movimientoId: resultado.movimiento.id, mensaje: error.message });
  return { ...resultado, advertencia: resultado.advertencia ?? MENSAJE_CATEGORIA_NO_GUARDADA };
}
