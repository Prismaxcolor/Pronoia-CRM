import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { elegirCategoriaDePago, categoriasParaTipo } from '../utils/categoria-pago-cobro.js';
import type { Categoria } from './categoria-service.js';
import { categoriasDeUso } from './categorias-uso-service.js';

const MENSAJE_CATEGORIA_NO_GUARDADA =
  'La operación se registró, pero no se pudo asignar la categoría a sus movimientos. Avisa al administrador.';

/**
 * Categoría fija de los pagos a proveedor (uso `pago_proveedor`). Null si la tabla de usos no existe, no
 * hay categoría asignada o falló la lectura: el pago se registra sin categoría, como antes.
 */
export async function categoriaFijaDePago(): Promise<string | null> {
  const r = await categoriasDeUso('pago_proveedor');
  return 'categorias' in r ? elegirCategoriaDePago(r.categorias) : null;
}

/** Categorías entre las que se elige al cobrar a un cliente (uso `cobro_cliente`), solo las que admiten ingresos. */
export async function opcionesCategoriaCobro(): Promise<{ categorias: Categoria[] } | { error: string }> {
  const r = await categoriasDeUso('cobro_cliente');
  if ('error' in r) return { error: r.error };
  return { categorias: categoriasParaTipo(r.categorias, 'ingreso') };
}

/**
 * Pone la categoría a los movimientos de dinero de un pago o cobro ya registrado (incluido el adelanto o
 * anticipo por excedente). El dinero ya se movió: si falla no se deshace, se devuelve una advertencia.
 * Sin categoría o sin movimientos no hace nada.
 */
export async function aplicarCategoriaAMovimientos(
  movimientoIds: readonly string[],
  categoriaId: string | null
): Promise<{ advertencia?: string }> {
  if (!categoriaId || movimientoIds.length === 0) return {};
  const { error } = await supabaseAdmin.from('movimientos').update({ categoria_id: categoriaId }).in('id', [...movimientoIds]);
  if (!error) return {};
  logger.error({ evento: 'pago_cobro_categoria_no_aplicada', movimientoIds, categoriaId, mensaje: error.message });
  return { advertencia: MENSAJE_CATEGORIA_NO_GUARDADA };
}
