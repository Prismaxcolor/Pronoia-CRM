import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { elegirCategoriaDePago, categoriasParaTipo, conSubcategoriasDeCobro, resolverCategoriaDePago, type ResolucionCategoriaCobro } from '../utils/categoria-pago-cobro.js';
import { listarCategorias, type Categoria } from './categoria-service.js';
import { categoriasDeUso } from './categorias-uso-service.js';
import { MENSAJE_CATEGORIA_NO_GUARDADA } from '../utils/mensajes-pago-pasos.js';


/**
 * Categoría fija de los pagos a proveedor (uso `pago_proveedor`). Null si la tabla de usos no existe, no
 * hay categoría asignada o falló la lectura: el pago se registra sin categoría, como antes.
 */
export async function categoriaFijaDePago(): Promise<string | null> {
  const r = await categoriasDeUso('pago_proveedor');
  return 'categorias' in r ? elegirCategoriaDePago(r.categorias) : null;
}

/**
 * Categorías entre las que se elige al pagar a un proveedor (uso `pago_proveedor`), solo las que admiten egresos,
 * más las subcategorías vigentes de las categorías generales asignadas.
 */
export async function opcionesCategoriaPago(): Promise<{ categorias: Categoria[] } | { error: string }> {
  const r = await categoriasDeUso('pago_proveedor');
  if ('error' in r) return { error: r.error };
  const asignadas = categoriasParaTipo(r.categorias, 'egreso');
  if (asignadas.length === 0) return { categorias: [] };
  const todas = await listarCategorias();
  if ('error' in todas) return { error: todas.error };
  return { categorias: conSubcategoriasDeCobro(asignadas, todas.categorias, 'egreso') };
}

/** Categoría de un pago: la elegida (validada contra las opciones de egreso) o, sin elección, la fija por configuración. */
export async function categoriaDelPago(elegidaId: string | null | undefined): Promise<ResolucionCategoriaCobro> {
  const fija = await categoriaFijaDePago();
  if (!elegidaId) return { categoriaId: fija };
  const opciones = await opcionesCategoriaPago();
  if ('error' in opciones) return { error: opciones.error };
  return resolverCategoriaDePago(opciones.categorias, elegidaId, fija);
}

/**
 * Categorías entre las que se elige al cobrar a un cliente (uso `cobro_cliente`), solo las que admiten ingresos,
 * más las subcategorías vigentes de las categorías generales asignadas.
 */
export async function opcionesCategoriaCobro(): Promise<{ categorias: Categoria[] } | { error: string }> {
  const r = await categoriasDeUso('cobro_cliente');
  if ('error' in r) return { error: r.error };
  const asignadas = categoriasParaTipo(r.categorias, 'ingreso');
  if (asignadas.length === 0) return { categorias: [] };
  const todas = await listarCategorias();
  if ('error' in todas) return { error: todas.error };
  return { categorias: conSubcategoriasDeCobro(asignadas, todas.categorias) };
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
