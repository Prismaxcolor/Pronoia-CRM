import type { RegistrarCobroMultipleInput } from '../schemas/cobros.js';
import { notificarPago } from './telegram-eventos-service.js';
import { resolverCategoriaDeCobro } from '../utils/categoria-pago-cobro.js';
import { opcionesCategoriaCobro } from './pago-categoria-service.js';
import { registrarConPasos } from './pago-registro-comun.js';
import { advertenciaDePasos } from './pagos-pasos-service.js';
import { validarMontosDeLineas } from './montos-pago-service.js';

/** Espejo de pago-service.ts (registrarPagoMultiple) para cobros a cliente —
 *  ver nota en nota-ajuste-cliente-service.ts sobre por qué es un archivo
 *  aparte en vez de generalizar el de proveedor. */

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
  /** Se informa si el cobro quedó registrado pero un paso posterior (categoría, comprobante) sigue pendiente de reintento. */
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
  const montos = await validarMontosDeLineas(input.bancas.map(b => ({ monto: b.monto, montoUsd: b.montoUsd, moneda: b.moneda, tasa: b.tasa })));
  if (montos) return { error: montos };
  const categoria = await categoriaDelCobro(input);
  if ('error' in categoria) return { error: categoria.error };
  const r = await registrarConPasos({
    envoltorio: 'registrar_cobro_cliente_multi_banca_completo',
    original: 'registrar_cobro_cliente_multi_banca',
    args: {
      p_cliente_id: input.clienteId,
      p_bancas: input.bancas.map(b => ({ bancaId: b.bancaId, monto: b.monto, montoUsd: b.montoUsd, moneda: b.moneda, referencia: b.referencia ?? null })),
      p_monto_usd: input.montoUsd,
      p_descripcion: input.descripcion,
      p_referencia: input.referencia,
      p_fecha: input.fecha,
      p_registrado_por: registradoPor,
      p_items: input.items.map(i => ({ tipo: i.tipo, id: i.id, montoUsd: i.montoUsd })),
    },
    extraEnvoltorio: {},
    clientRequestId: input.clientRequestId,
    categoriaId: categoria.categoriaId, comprobantes: input.comprobantes, lineas: [], usuarioId: registradoPor,
    mensajeError: 'No se pudo registrar el cobro.',
    normalizar: async data => {
      const creado = data as Omit<ResultadoCobroMulti, 'categoriaId' | 'advertencia'>;
      return {
        creado: { ...creado },
        ids: { movimientoIds: creado.movimientoIds ?? [], principalId: creado.movimientoPrincipalId, grupoId: creado.grupoId },
      };
    },
  });
  if ('error' in r) return r;

  const advertencia = advertenciaDePasos(r.estado);
  const resultado: ResultadoCobroMulti = {
    ...(r.creado as Omit<ResultadoCobroMulti, 'categoriaId' | 'advertencia'>),
    categoriaId: categoria.categoriaId,
    ...(advertencia ? { advertencia } : {}),
  };
  // Telegram (fire-and-forget): comprobante del cobro/anticipo o del cruce puro (sin dinero).
  notificarPago('cliente', input.clienteId, resultado.grupoId, {
    comprobantes: resultado.movimientoPrincipalId ? input.comprobantes : [],
    esCruce: resultado.movimientoPrincipalId === null,
  });

  return resultado;
}
