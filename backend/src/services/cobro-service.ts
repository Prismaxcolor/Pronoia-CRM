import { supabaseAdmin } from '../config/supabase.js';
import type { RegistrarCobroMultipleInput } from '../schemas/cobros.js';
import { notificarPago } from './telegram-eventos-service.js';
import { logger } from '../utils/logger.js';
import { resolverCategoriaDeCobro } from '../utils/categoria-pago-cobro.js';
import { aplicarCategoriaAMovimientos, opcionesCategoriaCobro } from './pago-categoria-service.js';

/** Espejo de pago-service.ts (registrarPagoMultiple) para cobros a cliente —
 *  ver nota en nota-ajuste-cliente-service.ts sobre por qué es un archivo
 *  aparte en vez de generalizar el de proveedor. */

async function adjuntarComprobante(movimientoId: string, comprobantes: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('movimientos')
    .update({ comprobantes })
    .eq('id', movimientoId);

  if (error) logger.error({ evento: 'cobro_comprobante_no_guardado', mensaje: error.message, movimientoId });
}

interface ResultadoCobroMulti {
  /** Null en un cruce puro (efectivo = 0): no hay movimiento de dinero. */
  movimientoPrincipalId: string | null;
  movimientoIds: string[];
  grupoId: string;
  numeroCobro: number | null;
  numeroAnticipo: number | null;
  /** Correlativo CRV- cuando la operación fue un cruce puro, sin movimiento de dinero. */
  numeroCruce: number | null;
  /** Categoría del Wallet elegida para el cobro; null si no hay categorías configuradas o fue un cruce puro. */
  categoriaId: string | null;
  /** Se informa si el cobro quedó registrado pero no se pudo asignar la categoría. */
  advertencia?: string;
}

/** Categoría del cobro antes de mover dinero: se rechaza una categoría ausente o inválida sin registrar nada. */
async function categoriaDelCobro(input: RegistrarCobroMultipleInput): Promise<{ categoriaId: string | null } | { error: string }> {
  const hayDinero = input.bancas.length > 0;
  if (!hayDinero) return { categoriaId: null };
  const opciones = await opcionesCategoriaCobro();
  if ('error' in opciones) return { error: opciones.error };
  return resolverCategoriaDeCobro(opciones.categorias, input.categoriaId, hayDinero);
}

/** Cobro combinado ("Registrar cobro"): repartido entre una o varias bancas
 *  de destino, liquida varias facturas de venta y/o notas de débito a la
 *  vez. El excedente queda como anticipo, en un movimiento aparte con su
 *  propio correlativo (lo separa la RPC). */
export async function registrarCobroMultiple(
  input: RegistrarCobroMultipleInput,
  registradoPor: string
): Promise<ResultadoCobroMulti | { error: string }> {
  const categoria = await categoriaDelCobro(input);
  if ('error' in categoria) return { error: categoria.error };
  const { data, error } = await supabaseAdmin.rpc('registrar_cobro_cliente_multi_banca', {
    p_cliente_id: input.clienteId,
    p_bancas: input.bancas.map(b => ({ bancaId: b.bancaId, monto: b.monto, montoUsd: b.montoUsd, moneda: b.moneda, referencia: b.referencia ?? null })),
    p_monto_usd: input.montoUsd,
    p_descripcion: input.descripcion,
    p_referencia: input.referencia,
    p_fecha: input.fecha,
    p_registrado_por: registradoPor,
    p_items: input.items.map(i => ({ tipo: i.tipo, id: i.id, montoUsd: i.montoUsd })),
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el cobro.' };
  const creado = data as Omit<ResultadoCobroMulti, 'categoriaId' | 'advertencia'>;

  if (input.comprobantes.length > 0 && creado.movimientoPrincipalId) {
    await adjuntarComprobante(creado.movimientoPrincipalId, input.comprobantes);
  }
  const { advertencia } = await aplicarCategoriaAMovimientos(creado.movimientoIds ?? [], categoria.categoriaId);
  const resultado: ResultadoCobroMulti = { ...creado, categoriaId: categoria.categoriaId, ...(advertencia ? { advertencia } : {}) };
  // Telegram (fire-and-forget): comprobante del cobro/anticipo o del cruce puro (sin dinero).
  notificarPago('cliente', input.clienteId, resultado.grupoId, {
    comprobantes: resultado.movimientoPrincipalId ? input.comprobantes : [],
    esCruce: resultado.movimientoPrincipalId === null,
  });

  return resultado;
}
