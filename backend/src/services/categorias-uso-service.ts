import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { logger } from '../utils/logger.js';
import { listarCategorias, type Categoria } from './categoria-service.js';

/** Operaciones que clasifican solas sus movimientos (ver docs/migration_categorias_uso.sql). */
export type UsoCategoria = 'pago_proveedor' | 'cobro_cliente' | 'nomina_administrativo' | 'nomina_operativo';

/**
 * Categorías vigentes asignadas a una operación. Devuelve lista vacía (sin error) si la tabla aún no
 * existe, si la operación no tiene categoría o si la asignada está archivada: el movimiento se
 * registra entonces sin categoría, como antes. Un fallo real de la BD sí se propaga como `error`.
 */
export async function categoriasDeUso(uso: UsoCategoria): Promise<{ categorias: Categoria[] } | { error: string }> {
  const { data, error } = await supabaseAdmin.from('categorias_uso').select('categoria_id').eq('uso', uso);
  if (error) {
    if (esObjetoInexistente(error)) return { categorias: [] };
    logger.error({ evento: 'categorias_uso_error', uso, codigoBd: error.code, mensaje: error.message });
    return { error: 'No se pudieron leer las categorías de esta operación.' };
  }
  const ids = new Set(((data as Array<{ categoria_id: string }> | null) ?? []).map(f => f.categoria_id));
  if (ids.size === 0) return { categorias: [] };
  const todas = await listarCategorias();
  if ('error' in todas) return { error: todas.error };
  const porId = new Map(todas.categorias.map(c => [c.id, c]));
  const vigentes = todas.categorias.filter(c => {
    if (!ids.has(c.id) || !c.activo) return false;
    const padre = c.padreId ? porId.get(c.padreId) : undefined;
    return !padre || padre.activo;
  });
  return { categorias: vigentes };
}
