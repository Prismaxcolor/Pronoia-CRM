/** Registro de un pago o cobro con sus pasos posteriores (categoría, comprobantes, comisión bancaria).
 *
 *  Camino principal: el envoltorio SQL `*_completo` (docs/migration_idempotencia_pagos_cobros.sql) mueve el dinero y
 *  aplica los pasos en UNA transacción, y con `clientRequestId` además guarda el resultado para que un reintento no
 *  repita nada. Si la migración aún no está aplicada se usa el flujo anterior: RPC de dinero y, después, los pasos
 *  desde el backend (pagos-pasos-service.ts). En ambos, lo que falle se anota y se reintenta una vez. */
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esFuncionInexistente } from '../utils/transaccion-edicion.js';
import { aplicarCategoriaAComisiones } from './comision-categoria-service.js';
import { auditarOmisiones, type ComisionPagoCreada, type LineaComisionPago } from './pago-comision-service.js';
import {
  aplicarPasosEnBackend, repararPasosAnotados, type EstadoPasos, type PasoAnotado,
} from './pagos-pasos-service.js';

export type NombreEnvoltorio =
  | 'registrar_pago_proveedor_completo'
  | 'registrar_pago_proveedor_multi_banca_completo'
  | 'registrar_cobro_cliente_multi_banca_completo';

/** Movimientos que creó la RPC de dinero, para aplicarles los pasos. */
export interface IdsRegistro {
  movimientoIds: string[];
  principalId: string | null;
  grupoId: string | null;
}

export interface RegistroComun {
  envoltorio: NombreEnvoltorio;
  /** RPC original, usada si el envoltorio no existe todavía. */
  original: string;
  /** Argumentos del RPC original; el envoltorio recibe los mismos más la clave y los pasos. */
  args: Record<string, unknown>;
  /** Argumentos que solo conoce el envoltorio (p. ej. qué cuentas llevan comisión). */
  extraEnvoltorio: Record<string, unknown>;
  clientRequestId?: string;
  categoriaId: string | null;
  comprobantes: string[];
  lineas: LineaComisionPago[];
  usuarioId: string;
  mensajeError: string;
  /** Convierte la respuesta de la RPC (envoltorio u original) en el resultado del registro y los ids de sus movimientos. */
  normalizar: (data: unknown, viaEnvoltorio: boolean) => Promise<{ creado: Record<string, unknown>; ids: IdsRegistro }>;
}

export type ResultadoRegistro = { creado: Record<string, unknown>; ids: IdsRegistro; estado: EstadoPasos } | { error: string };

interface PasosSql {
  comisiones: ComisionPagoCreada[];
  pasosPendientes: PasoAnotado[];
}

/** Separa de la respuesta del envoltorio lo que añade `aplicar_pasos_pago` (comisiones y pasos anotados). */
function separarPasosSql(data: Record<string, unknown>): { limpio: Record<string, unknown>; pasos: PasosSql } {
  const { comisiones, pasosPendientes, ...limpio } = data;
  return {
    limpio,
    pasos: {
      comisiones: Array.isArray(comisiones) ? (comisiones as ComisionPagoCreada[]) : [],
      pasosPendientes: Array.isArray(pasosPendientes) ? (pasosPendientes as PasoAnotado[]) : [],
    },
  };
}

async function completarTrasEnvoltorio(o: RegistroComun, data: unknown): Promise<ResultadoRegistro> {
  const { limpio, pasos } = separarPasosSql((data ?? {}) as Record<string, unknown>);
  const { creado, ids } = await o.normalizar(limpio, true);
  await auditarOmisiones(o.lineas, ids.grupoId, o.usuarioId);
  const reparados = await repararPasosAnotados(pasos.pasosPendientes);
  const categoria = await aplicarCategoriaAComisiones(pasos.comisiones.map(c => c.movimientoId).filter(Boolean));
  const avisos = categoria.advertencia ? [categoria.advertencia] : [];
  return { creado, ids, estado: { comisiones: [...pasos.comisiones, ...reparados.comisiones], pendientes: reparados.pendientes, avisos } };
}

async function registrarConFlujoAnterior(o: RegistroComun): Promise<ResultadoRegistro> {
  const { data, error } = await supabaseAdmin.rpc(o.original, o.args);
  if (error || !data) return { error: error?.message ?? o.mensajeError };
  const { creado, ids } = await o.normalizar(data, false);
  const estado = await aplicarPasosEnBackend({
    ...ids, categoriaId: o.categoriaId, comprobantes: o.comprobantes, lineas: o.lineas, usuarioId: o.usuarioId,
  });
  return { creado, ids, estado };
}

/** Mueve el dinero y aplica los pasos posteriores; ver la cabecera del archivo. */
export async function registrarConPasos(o: RegistroComun): Promise<ResultadoRegistro> {
  const { data, error } = await supabaseAdmin.rpc(o.envoltorio, {
    p_client_request_id: o.clientRequestId ?? null,
    ...o.args,
    p_categoria_id: o.categoriaId,
    p_comprobantes: o.comprobantes,
    ...o.extraEnvoltorio,
  });
  if (error && esFuncionInexistente(error)) {
    logger.warn({ evento: 'pago_envoltorio_no_disponible', envoltorio: o.envoltorio, mensaje: 'Falta docs/migration_idempotencia_pagos_cobros.sql: se usa el flujo anterior' });
    return registrarConFlujoAnterior(o);
  }
  if (error || !data) return { error: error?.message ?? o.mensajeError };
  return completarTrasEnvoltorio(o, data);
}
