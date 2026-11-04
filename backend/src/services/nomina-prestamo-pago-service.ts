import { supabaseAdmin } from '../config/supabase.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import { MENSAJE_PAGO_PRESTAMO_NO_HABILITADO } from '../utils/nomina-pago.js';
import { planificarDesembolso, type DesembolsoPlanificado } from '../utils/nomina-desembolso.js';
import { esFuncionInexistente } from '../utils/transaccion-edicion.js';
import { logger } from '../utils/logger.js';
import type { Prestamo } from '../../../shared/types/nomina.js';
import type { CrearPrestamoInput, DesembolsoInput } from '../schemas/nomina.js';
import { comisionBancariaDisponible } from './movimiento-comision-service.js';
import { auditarSinComision, leerCuentas } from './nomina-pago-service.js';
import { crearPrestamo, obtenerPrestamo } from './nomina-prestamo-service.js';

export interface ResultadoDesembolso {
  prestamo: Prestamo;
  /** true si el préstamo ya estaba pagado: no se creó ningún movimiento nuevo. */
  yaPagado: boolean;
  advertencia?: string;
}

export interface ResultadoPrestamoNuevo {
  prestamo: Prestamo;
  /** Aviso si el préstamo se registró pero su pago no pudo registrarse (se reintenta con el botón «Pagar»). */
  advertencia?: string;
}

interface RespuestaPrestamoPagar {
  yaPagado?: boolean;
  movimientoId?: string;
  sinComision?: boolean;
}

/** Valida cuenta, tasa y comisión contra la BD; la función SQL vuelve a validar todo. */
async function planDeDesembolso(montoUsd: number, d: DesembolsoInput): Promise<DesembolsoPlanificado | FalloNomina> {
  const cuentas = await leerCuentas([d.bancaId]);
  if ('error' in cuentas) return cuentas;
  const cuenta = cuentas.cuentas[0];
  const comisionDisponible = cuenta?.moneda === 'VES' ? await comisionBancariaDisponible() : false;
  return planificarDesembolso({ cuenta, montoUsd, tasaBs: d.tasaBs, llevaComision: d.llevaComision, comisionDisponible });
}

function datosSql(d: DesembolsoInput, plan: DesembolsoPlanificado) {
  return {
    bancaId: d.bancaId,
    fecha: d.fecha,
    referencia: d.referencia ?? null,
    // El préstamo no es un gasto de nómina: el egreso queda sin categoría (se puede clasificar después desde el Wallet).
    categoriaId: null,
    tasaBs: plan.tasaBs,
    llevaComision: plan.llevaComision,
    comprobantes: d.comprobantes,
  };
}

/**
 * Registra el pago (desembolso) de un préstamo o adelanto desde el Wallet: UNA llamada a nomina_prestamo_pagar (egreso,
 * comisión, comprobantes y vínculo en una sola transacción). Reintentar o pagar dos veces es seguro: la BD bloquea el
 * préstamo y devuelve yaPagado.
 */
export async function desembolsarPrestamo(
  prestamoId: string, input: DesembolsoInput, userId: string,
): Promise<ResultadoDesembolso | FalloNomina> {
  const previa = await obtenerPrestamo(prestamoId);
  if ('error' in previa) return previa;
  const { prestamo } = previa;
  if (prestamo.estado === 'ANULADO') return { error: 'No se puede registrar el pago de un préstamo anulado.', codigo: 409 };
  if (prestamo.desembolso) return { prestamo, yaPagado: true };

  const plan = await planDeDesembolso(prestamo.montoUsd, input);
  if ('error' in plan) return plan;

  const { data, error } = await supabaseAdmin.rpc('nomina_prestamo_pagar', {
    p_prestamo_id: prestamoId, p_datos: datosSql(input, plan), p_usuario: userId,
  });
  if (error) {
    if (esFuncionInexistente(error)) return { error: MENSAJE_PAGO_PRESTAMO_NO_HABILITADO, codigo: 503 };
    return falloNomina(error, 'nomina_prestamo_pagar', 'No se pudo registrar el pago del préstamo.');
  }
  const creado = (data as RespuestaPrestamoPagar | null) ?? {};
  const aviso = creado.sinComision && creado.movimientoId ? await auditarSinComision([creado.movimientoId], userId) : undefined;
  const actual = await obtenerPrestamo(prestamoId);
  // El pago ya está hecho: si no se puede releer el préstamo no se responde error (invitaría a reintentar).
  if ('error' in actual) {
    logger.warn({ evento: 'nomina_prestamo_pago_sin_recarga', prestamoId });
    return { prestamo, yaPagado: Boolean(creado.yaPagado), advertencia: 'El pago se registró; recarga los préstamos.' };
  }
  return { prestamo: actual.prestamo, yaPagado: Boolean(creado.yaPagado), ...(aviso ? { advertencia: aviso } : {}) };
}

/**
 * Registra un préstamo o adelanto y, si viene `desembolso`, también su pago desde el Wallet. Primero se valida la cuenta
 * (no se crea nada si no sirve). Si el pago fallara después de crear el préstamo, el préstamo queda registrado y se avisa:
 * el pago se reintenta con el botón «Pagar» del préstamo.
 */
export async function registrarPrestamo(
  input: CrearPrestamoInput, userId: string,
): Promise<ResultadoPrestamoNuevo | FalloNomina> {
  const { desembolso, ...datos } = input;
  if (!desembolso) return crearPrestamo(datos, userId);
  const plan = await planDeDesembolso(datos.montoUsd, desembolso);
  if ('error' in plan) return plan;
  const creado = await crearPrestamo(datos, userId);
  if ('error' in creado) return creado;
  const pago = await desembolsarPrestamo(creado.prestamo.id, desembolso, userId);
  if ('error' in pago) {
    return { prestamo: creado.prestamo, advertencia: `El préstamo se registró, pero su pago no: ${pago.error} Regístralo con el botón «Registrar pago» del préstamo.` };
  }
  return { prestamo: pago.prestamo, ...(pago.advertencia ? { advertencia: pago.advertencia } : {}) };
}
