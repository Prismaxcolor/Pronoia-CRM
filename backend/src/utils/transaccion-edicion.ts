import type { Instantanea } from './auditoria.js';
import { esMensajeDeNegocio, MENSAJE_ERROR_GENERICO } from './errores-bd.js';
import type { PagoDetalle } from '../services/pago-detalle-service.js';
import type { Movimiento } from '../services/banca-service.js';
import type { EditarPagoInput, EditarMovimientoInput } from '../schemas/transacciones-editar.js';

/**
 * Piezas puras de la edición y anulación de pagos, cobros y movimientos de banca:
 * qué se audita, cómo se arman los parámetros de las RPC y cómo se traducen sus errores.
 * Sin acceso a red ni a BD.
 */

export const MENSAJE_MIGRACION_PENDIENTE =
  'Falta aplicar la migración de edición y anulación de transacciones (docs/migration_editar_anular_transacciones.sql).';

export const ESTADO_VIGENTE = 'vigente';
export const ESTADO_ANULADO = 'anulado';

const redondear2 = (n: number): number => Math.round(n * 100) / 100;

/** True si el error de PostgREST indica que la función SQL no existe (migración sin aplicar). */
export function esFuncionInexistente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function/i.test(error.message ?? '');
}

export interface ErrorTransaccion {
  error: string;
  codigo: number;
}

/**
 * Traduce el error de una RPC de edición/anulación. Un `raise exception` de negocio
 * (SQLSTATE P0001: "ya fue anulada", "saldo insuficiente"...) se muestra tal cual con 409;
 * una función inexistente avisa que falta la migración; el resto es un 500 genérico.
 */
export function errorDeRpcTransaccion(error: { code?: string; message?: string }): ErrorTransaccion {
  if (esFuncionInexistente(error)) return { error: MENSAJE_MIGRACION_PENDIENTE, codigo: 409 };
  if (esMensajeDeNegocio(error)) return { error: error.message as string, codigo: 409 };
  return { error: MENSAJE_ERROR_GENERICO, codigo: 500 };
}

// ---------------------------------------------------------------------------
// Pagos y cobros
// ---------------------------------------------------------------------------

/** true si el cuerpo toca la parte contable (bancas, montos, monedas, items aplicados). */
export function esEdicionContable(input: Pick<EditarPagoInput, 'bancas' | 'montoUsd' | 'items'>): boolean {
  return input.bancas !== undefined || input.montoUsd !== undefined || input.items !== undefined;
}

const textoBanca = (b: PagoDetalle['bancas'][number]): string =>
  `${b.bancaNombre ?? 'Banca'}: ${redondear2(b.monto)} ${b.moneda}`;

/** Lo que se audita de un pago/cobro: monto, moneda, banca, concepto, referencia, fecha, comprobantes e items. */
export function resumirPago(d: PagoDetalle): Instantanea {
  const referencias = [...new Set(d.bancas.map(b => b.referencia).filter((r): r is string => !!r))];
  return {
    estado: d.anulado ? ESTADO_ANULADO : ESTADO_VIGENTE,
    motivo_anulacion: d.anuladoMotivo,
    monto_usd: redondear2(d.totalUsd),
    moneda: [...new Set(d.bancas.map(b => b.moneda))].sort().join(', ') || null,
    banca: d.bancas.map(textoBanca).join(' | ') || null,
    concepto: d.descripcion,
    referencia: referencias.join(', ') || null,
    fecha: d.fecha,
    comprobantes: d.comprobantes.length,
    aplicado_a: d.items.map(i => `${i.codigo ?? i.tipo} ${redondear2(i.montoUsd)}`).join(', ') || null,
  };
}

/**
 * Bancas del cuerpo listas para la RPC. Si el usuario no escribió una referencia general,
 * cada banca conserva la que tenía el pago original (si no, la RPC la dejaría vacía).
 */
export function bancasParaRpc(
  nuevas: NonNullable<EditarPagoInput['bancas']>,
  originales: ReadonlyArray<PagoDetalle['bancas'][number]>,
  referenciaGeneral: string | undefined
): Array<{ bancaId: string; monto: number; montoUsd: number; moneda: string; referencia: string | null }> {
  return nuevas.map(b => {
    const previa = originales.find(o => o.bancaId === b.bancaId)?.referencia ?? null;
    return {
      bancaId: b.bancaId,
      monto: b.monto,
      montoUsd: b.montoUsd,
      moneda: b.moneda,
      referencia: b.referencia ?? (referenciaGeneral === undefined ? previa : null),
    };
  });
}

/** Parámetros de editar_pago_cobro_campos: valores finales; null = sin cambio. */
export function parametrosCamposPago(grupoId: string, input: EditarPagoInput, usuarioId: string) {
  return {
    p_grupo_id: grupoId,
    p_descripcion: input.descripcion ?? null,
    p_referencia: input.referencia ?? null,
    p_fecha: input.fecha ?? null,
    p_comprobantes: input.comprobantes ?? null,
    p_usuario: usuarioId,
  };
}

/** Parámetros de editar_pago_cobro_contable: valores FINALES (lo no enviado conserva el valor actual). */
export function parametrosContablesPago(
  grupoId: string,
  input: EditarPagoInput,
  antes: PagoDetalle,
  usuarioId: string
) {
  return {
    p_grupo_id: grupoId,
    p_bancas: bancasParaRpc(input.bancas ?? [], antes.bancas, input.referencia),
    p_monto_usd: input.montoUsd ?? antes.totalUsd,
    p_items: (input.items ?? []).map(i => ({ tipo: i.tipo, id: i.id, montoUsd: i.montoUsd })),
    p_descripcion: input.descripcion ?? antes.descripcion ?? '',
    p_referencia: input.referencia ?? null,
    p_fecha: input.fecha ?? antes.fecha,
    p_comprobantes: input.comprobantes ?? null,
    p_usuario: usuarioId,
  };
}

/** Código legible de la operación para el aviso (PG-/AD-/CB-/AC-/CR-/CRV-). */
export function codigoDePago(d: PagoDetalle): string | null {
  return d.codigoPago ?? d.codigoCruce ?? d.codigoAdelanto;
}

// ---------------------------------------------------------------------------
// Movimientos de banca
// ---------------------------------------------------------------------------

/** Lo que se audita de un movimiento de banca. `nombres` traduce id de banca -> nombre. */
export function resumirMovimiento(m: Movimiento, nombres: ReadonlyMap<string, string>): Instantanea {
  const banca = (id: string | null): string | null => (id ? (nombres.get(id) ?? id) : null);
  return {
    estado: m.anulado ? ESTADO_ANULADO : ESTADO_VIGENTE,
    motivo_anulacion: m.anuladoMotivo,
    tipo: m.tipo,
    monto: redondear2(m.monto),
    moneda: m.moneda,
    banca: banca(m.bancaOrigenId),
    banca_destino: banca(m.bancaDestinoId),
    monto_destino: m.montoDestino != null ? redondear2(m.montoDestino) : null,
    concepto: m.descripcion,
    referencia: m.referencia || null,
    fecha: m.fecha,
    comprobantes: m.comprobantes.length,
    proveedor_id: m.proveedorId,
    cliente_id: m.clienteId,
  };
}

/** true si el cuerpo toca la parte contable de un movimiento (banca, monto, moneda, entidad). */
export function esEdicionContableMovimiento(input: EditarMovimientoInput): boolean {
  return (
    input.bancaId !== undefined ||
    input.bancaDestinoId !== undefined ||
    input.monto !== undefined ||
    input.moneda !== undefined ||
    input.montoDestino !== undefined ||
    input.proveedorId !== undefined ||
    input.clienteId !== undefined
  );
}

/** Parámetros de editar_movimiento_banca_campos. */
export function parametrosCamposMovimiento(id: string, input: EditarMovimientoInput, usuarioId: string) {
  return {
    p_id: id,
    p_descripcion: input.descripcion ?? null,
    p_referencia: input.referencia ?? null,
    p_fecha: input.fecha ?? null,
    p_comprobantes: input.comprobantes ?? null,
    p_usuario: usuarioId,
  };
}

/** Parámetros de editar_movimiento_banca_contable: valores FINALES (lo no enviado conserva el actual). */
export function parametrosContablesMovimiento(id: string, input: EditarMovimientoInput, antes: Movimiento, usuarioId: string) {
  const elegir = <T>(nuevo: T | undefined, actual: T): T => (nuevo === undefined ? actual : nuevo);
  return {
    p_id: id,
    p_banca_id: elegir(input.bancaId, antes.bancaOrigenId),
    p_banca_destino_id: elegir(input.bancaDestinoId, antes.bancaDestinoId),
    p_monto: elegir(input.monto, antes.monto),
    p_moneda: elegir(input.moneda, antes.moneda),
    p_monto_destino: elegir(input.montoDestino, antes.montoDestino),
    p_proveedor_id: elegir(input.proveedorId, antes.proveedorId),
    p_cliente_id: elegir(input.clienteId, antes.clienteId),
    p_descripcion: input.descripcion ?? null,
    p_referencia: input.referencia ?? null,
    p_fecha: input.fecha ?? null,
    p_comprobantes: input.comprobantes ?? null,
    p_usuario: usuarioId,
  };
}
