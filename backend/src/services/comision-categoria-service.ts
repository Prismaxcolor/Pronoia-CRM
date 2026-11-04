import { logger } from '../utils/logger.js';
import { categoriasParaTipo, elegirCategoriaDePago } from '../utils/categoria-pago-cobro.js';
import { NOMBRE_CATEGORIA_COMISION_BANCARIA, buscarCategoriaPorNombre } from '../utils/categoria-comision.js';
import { listarCategorias } from './categoria-service.js';
import { categoriasDeUso } from './categorias-uso-service.js';
import { aplicarCategoriaAMovimientos } from './pago-categoria-service.js';

/**
 * Categoría "COMISIONES BANCARIAS" de los cargos de comisión bancaria (wallet, pagos a proveedor, nómina).
 * Se resuelve por el uso `comision_bancaria` (docs/migration_categoria_comisiones_bancarias.sql) y, si ese uso
 * aún no existe, por el nombre de la categoría. Devuelve null si no hay ninguna: el cargo queda entonces sin
 * categoría, como antes. La BD (trigger de la migración) repite la regla, esto cubre el intervalo previo.
 */
export async function categoriaDeComisionBancaria(): Promise<string | null> {
  const porUso = await categoriasDeUso('comision_bancaria');
  if ('categorias' in porUso) {
    const id = elegirCategoriaDePago(porUso.categorias);
    if (id) return id;
  }
  const todas = await listarCategorias();
  if ('error' in todas) {
    logger.warn({ evento: 'comision_categoria_no_resuelta', mensaje: todas.error });
    return null;
  }
  const porNombre = buscarCategoriaPorNombre(categoriasParaTipo(todas.categorias.filter(c => c.activo), 'egreso'), NOMBRE_CATEGORIA_COMISION_BANCARIA);
  return porNombre?.id ?? null;
}

/**
 * Pone "COMISIONES BANCARIAS" a los cargos de comisión ya creados. El dinero ya se movió: si falla no se
 * deshace nada, se devuelve una advertencia. Sin cargos o sin categoría no hace nada.
 */
export async function aplicarCategoriaAComisiones(comisionIds: readonly string[]): Promise<{ advertencia?: string }> {
  if (comisionIds.length === 0) return {};
  const categoriaId = await categoriaDeComisionBancaria();
  return aplicarCategoriaAMovimientos(comisionIds, categoriaId);
}
