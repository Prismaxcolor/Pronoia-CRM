import { supabaseAdmin } from '../config/supabase.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import {
  MENSAJE_PAGO_NO_HABILITADO, montosPorPagar, planificarPagos, type CuentaWallet, type PagoPlanificado,
} from '../utils/nomina-pago.js';
import { esFuncionInexistente } from '../utils/transaccion-edicion.js';
import { logger } from '../utils/logger.js';
import type { Nomina, TipoTrabajador } from '../../../shared/types/nomina.js';
import type { PagarNominaInput } from '../schemas/nomina.js';
import { registrarAuditoria } from './auditoria-service.js';
import { categoriasDeUso, type UsoCategoria } from './categorias-uso-service.js';
import { comisionBancariaDisponible } from './movimiento-comision-service.js';
import { obtenerNomina } from './nomina-service.js';

const USO_POR_TIPO: Record<TipoTrabajador, UsoCategoria> = {
  ADMINISTRATIVO: 'nomina_administrativo',
  OPERATIVO: 'nomina_operativo',
};

export const MENSAJE_NOMINA_PAGADA_POR_TRABAJADOR =
  'Esta nómina se está pagando trabajador por trabajador: usa el botón «Pagar» de cada trabajador.';

export const MENSAJE_NOMINA_PAGADA_COMPLETA =
  'Esta nómina ya se pagó completa desde el Wallet: no se puede pagar por trabajador.';

export const MENSAJE_PAGO_SIN_RECARGA = 'El pago se registró; recarga la nómina.';

export const MENSAJE_SIN_AUDITORIA_COMISION =
  'El pago se registró sin comisión bancaria, pero no se pudo dejar constancia en el historial de auditoría. Avisa al administrador.';

export const MENSAJE_SIN_AUDITORIA_FECHA =
  'El pago se registró con una fecha distinta a la de hoy, pero no se pudo dejar constancia en el historial de auditoría. Avisa al administrador.';

export interface CategoriaPago {
  id: string;
  nombre: string;
}

export interface ResultadoPagoNomina {
  nomina: Nomina;
  /** true si la nómina ya estaba pagada: no se creó ningún movimiento nuevo. */
  yaPagada: boolean;
  advertencia?: string;
}

interface RespuestaPagar {
  yaPagada?: boolean;
  /** Fecha que eligió quien paga y fecha real del registro (Caracas): la tasa Binance congelada sale de la real. */
  fechaElegida?: string;
  fechaReal?: string;
  pagos?: Array<{ movimientoId: string; sinComision: boolean }>;
}

/**
 * Categoría del Wallet que lleva el egreso del pago según el tipo de personal (docs/migration_categorias_uso.sql).
 * null = no hay una asignada y vigente: el egreso se crea sin categoría y la pantalla lo avisa. Solo se ofrece una
 * categoría que acepte egresos.
 */
export async function categoriaDePagoNomina(tipo: TipoTrabajador): Promise<{ categoria: CategoriaPago | null } | FalloNomina> {
  const r = await categoriasDeUso(USO_POR_TIPO[tipo]);
  if ('error' in r) return { error: r.error, codigo: 503 };
  const valida = r.categorias.find(c => c.tipo !== 'INGRESO');
  return { categoria: valida ? { id: valida.id, nombre: valida.nombre } : null };
}

export async function leerCuentas(ids: readonly string[]): Promise<{ cuentas: CuentaWallet[] } | FalloNomina> {
  const { data, error } = await supabaseAdmin.from('bancas').select('id, nombre, moneda, archivada').in('id', [...ids]);
  if (error) return falloNomina(error, 'nomina_pago_cuentas', 'No se pudieron leer las cuentas.');
  const filas = (data ?? []) as Array<{ id: string; nombre: string; moneda: string; archivada: boolean | null }>;
  return { cuentas: filas.map(f => ({ id: f.id, nombre: f.nombre, moneda: f.moneda, archivada: Boolean(f.archivada) })) };
}

/** Omitir la comisión de un pago en Bs es una decisión de la persona y queda auditada, como en un egreso manual. */
export async function auditarSinComision(movimientoIds: readonly string[], userId: string): Promise<string | undefined> {
  const resultados = await Promise.all(movimientoIds.map(id => registrarAuditoria({
    entidadTipo: 'movimiento_banca', entidadId: id, accion: 'sin_comision_bancaria', usuarioId: userId,
    cambios: { comision_bancaria: { antes: 'aplicaba (0.3%, mínimo 14 Bs)', despues: 'omitida por la persona' } },
  })));
  if (resultados.every(Boolean)) return undefined;
  logger.warn({ evento: 'nomina_pago_sin_comision_sin_auditoria', userId });
  return MENSAJE_SIN_AUDITORIA_COMISION;
}

/**
 * La fecha elegida solo fecha el egreso; la tasa Binance congelada sale de la hora real del registro. Si difieren, queda
 * constancia en la auditoría de cada egreso del pago.
 */
async function auditarFechaDistinta(creados: RespuestaPagar, movimientoIds: readonly string[], userId: string): Promise<string | undefined> {
  const { fechaElegida, fechaReal } = creados;
  if (!fechaElegida || !fechaReal || fechaElegida === fechaReal || movimientoIds.length === 0) return undefined;
  const resultados = await Promise.all(movimientoIds.map(id => registrarAuditoria({
    entidadTipo: 'movimiento_banca', entidadId: id, accion: 'fecha_pago_distinta', usuarioId: userId,
    cambios: { fecha_pago: { antes: fechaReal, despues: fechaElegida } },
  })));
  if (resultados.every(Boolean)) return undefined;
  logger.warn({ evento: 'nomina_pago_fecha_distinta_sin_auditoria', userId });
  return MENSAJE_SIN_AUDITORIA_FECHA;
}

export function datosSql(
  input: PagarNominaInput & { comprobantes?: readonly string[] }, categoriaId: string | null, pagos: readonly PagoPlanificado[],
) {
  return {
    fecha: input.fecha,
    referencia: input.referencia ?? null,
    categoriaId,
    ...(input.comprobantes ? { comprobantes: input.comprobantes } : {}),
    pagos: pagos.map(p => ({
      moneda: p.moneda, bancaId: p.bancaId, llevaComision: p.llevaComision, ...(p.monto === undefined ? {} : { monto: p.monto }),
    })),
  };
}

export function fallaRpc(
  error: { code?: string; message?: string }, mensajeNoHabilitado: string = MENSAJE_PAGO_NO_HABILITADO, operacion = 'nomina_pagar',
): FalloNomina {
  if (esFuncionInexistente(error)) return { error: mensajeNoHabilitado, codigo: 503 };
  return falloNomina(error, operacion, 'No se pudo pagar la nómina.');
}

/** Valida cuentas y comisión contra la BD y devuelve lo que se manda a la función SQL (que vuelve a validar todo). */
export async function planDePago(nomina: Pick<Nomina, 'lineas'>, input: PagarNominaInput): Promise<{ pagos: PagoPlanificado[] } | FalloNomina> {
  const montos = montosPorPagar(nomina.lineas);
  const requeridas = (['USD', 'BS'] as const).filter(m => montos[m] > 0);
  if (requeridas.length === 0) return { error: 'La nómina no tiene montos por pagar.', codigo: 409 };
  const cuentas = await leerCuentas(input.bancas.map(b => b.bancaId));
  if ('error' in cuentas) return cuentas;
  const comisionDisponible = cuentas.cuentas.some(c => c.moneda === 'VES') ? await comisionBancariaDisponible() : false;
  return planificarPagos(requeridas, input.bancas, cuentas.cuentas, comisionDisponible, montos);
}

export function estadoNoPagable(nomina: Nomina): FalloNomina | null {
  if (nomina.estado === 'ANULADA') return { error: 'No se puede pagar una nómina anulada.', codigo: 409 };
  if (nomina.estado !== 'CERRADA') return { error: 'Solo se puede pagar una nómina cerrada: ciérrala primero.', codigo: 409 };
  return null;
}

/** Tras la RPC: audita los pagos en Bs sin comisión y devuelve la nómina ya con su pago. */
export async function resultadoDe(previa: Nomina, data: unknown, userId: string): Promise<ResultadoPagoNomina> {
  const creados = (data as RespuestaPagar | null) ?? {};
  const sinComision = (creados.pagos ?? []).filter(p => p.sinComision).map(p => p.movimientoId);
  const movimientos = (creados.pagos ?? []).map(p => p.movimientoId);
  const [aviso, avisoFecha] = await Promise.all([
    sinComision.length > 0 ? auditarSinComision(sinComision, userId) : undefined,
    auditarFechaDistinta(creados, movimientos, userId),
  ]);
  const actual = await obtenerNomina(previa.id);
  // El pago ya está hecho: si no se puede releer la nómina no se responde error (invitaría a reintentar).
  const recargada = 'nomina' in actual;
  if (!recargada) logger.warn({ evento: 'nomina_pago_sin_recarga', nominaId: previa.id });
  const advertencias = [aviso, avisoFecha, recargada ? undefined : MENSAJE_PAGO_SIN_RECARGA].filter(Boolean).join(' ');
  return {
    nomina: recargada ? actual.nomina : previa,
    yaPagada: Boolean(creados.yaPagada),
    ...(advertencias ? { advertencia: advertencias } : {}),
  };
}

/**
 * Paga una nómina cerrada desde el Wallet: UNA llamada a nomina_pagar (egresos, categoría, comisión y vínculo en una
 * sola transacción). Reintentar o pagar dos veces es seguro: la BD bloquea la nómina y devuelve yaPagada.
 */
export async function pagarNomina(id: string, input: PagarNominaInput, userId: string): Promise<ResultadoPagoNomina | FalloNomina> {
  const previa = await obtenerNomina(id);
  if ('error' in previa) return previa;
  // Primero el estado: una nómina ANULADA que tuvo pago es 409, no "ya pagada".
  const rechazo = estadoNoPagable(previa.nomina);
  if (rechazo) return rechazo;
  if (previa.nomina.pagos.some(p => p.trabajadorId !== null)) {
    return { error: MENSAJE_NOMINA_PAGADA_POR_TRABAJADOR, codigo: 409 };
  }
  if (previa.nomina.pagos.length > 0) return { nomina: previa.nomina, yaPagada: true };
  const plan = await planDePago(previa.nomina, input);
  if ('error' in plan) return plan;
  const categoria = await categoriaDePagoNomina(previa.nomina.tipo);
  if ('error' in categoria) return categoria;

  const { data, error } = await supabaseAdmin.rpc('nomina_pagar', {
    p_nomina_id: id, p_datos: datosSql(input, categoria.categoria?.id ?? null, plan.pagos), p_usuario: userId,
  });
  if (error) return fallaRpc(error);
  return resultadoDe(previa.nomina, data, userId);
}
