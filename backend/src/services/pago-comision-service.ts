import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esFuncionInexistente } from '../utils/transaccion-edicion.js';
import { esColumnaInexistente } from '../utils/migracion-pendiente.js';
import { registrarAuditoria } from './auditoria-service.js';
import { comisionBancariaDisponible, MENSAJE_COMISION_PENDIENTE } from './movimiento-comision-service.js';
import { aplicarCategoriaAComisiones } from './comision-categoria-service.js';
import { reglasAutomaticasDe } from './comision-automatica-service.js';
import { MENSAJE_COMISION_NO_CARGADA } from '../utils/mensajes-pago-pasos.js';

/**
 * Comisión bancaria (0.3%, mínimo 14 Bs) de los PAGOS A PROVEEDOR desde una cuenta en Bs. Reutiliza la regla y la
 * disponibilidad del Wallet (movimiento-comision-service.ts, utils/comision-bancaria.ts): el cargo es un egreso en la
 * misma cuenta ligado al movimiento del pago (comision_de_id). Lo crea la RPC `agregar_comision_bancaria_a_pago`
 * (docs/migration_pago_comision_bancaria.sql) justo después de registrar el pago; si falla, el pago queda
 * registrado y se avisa con una advertencia para cargar la comisión a mano en Wallet.
 */

export const MENSAJE_PAGO_ELEGIR_COMISION =
  'Indica si el pago desde una cuenta en bolívares (Bs) lleva comisión bancaria del 0.3%.';
export const MENSAJE_PAGO_COMISION_SOLO_BS = 'La comisión bancaria solo aplica cuando la cuenta de origen está en bolívares (Bs).';
export const MENSAJE_PAGO_COMISION_PENDIENTE = `${MENSAJE_COMISION_PENDIENTE} Para pagos también falta aplicar migration_pago_comision_bancaria.sql.`;
const MENSAJE_SIN_LECTURA = 'El pago se registró, pero no se pudo leer para cargar la comisión bancaria. Regístrala como egreso en Wallet.';

/** Lo que el servicio necesita saber de cada cuenta de origen del pago. */
export interface LineaComisionPago {
  bancaId: string;
  moneda: 'USD' | 'VES';
  /** undefined = la persona no eligió. En una cuenta con comisión automática siempre es true (no se elige). */
  llevaComision?: boolean;
  /** La cuenta lleva comisión automática (p. ej. Citibank, docs/migration_comision_automatica_banca.sql): se carga sola, en cualquier moneda. */
  automatica?: boolean;
}

/** ¿Esta línea carga comisión? Una cuenta en Bs con Sí, o una cuenta con comisión automática (en cualquier moneda). */
export const lineaCargaComision = (l: LineaComisionPago): boolean => l.llevaComision === true && (l.moneda === 'VES' || l.automatica === true);

/** Marca las líneas cuya cuenta tiene comisión automática: llevan comisión siempre, sin elegir Sí/No. Valores nuevos; no muta la entrada. */
export async function conComisionAutomatica(lineas: readonly LineaComisionPago[]): Promise<LineaComisionPago[]> {
  const reglas = await reglasAutomaticasDe(lineas.map(l => l.bancaId));
  return lineas.map(l => (reglas.has(l.bancaId) ? { ...l, llevaComision: true, automatica: true } : { ...l }));
}

export interface ComisionPagoCreada {
  bancaId: string;
  movimientoId: string;
  monto: number;
}

export interface ResultadoComisionesPago {
  comisiones: ComisionPagoCreada[];
  advertencia?: string;
  /** Cuentas (en Bs, con Sí) cuyo cargo no se pudo crear: el llamador las anota para reintentarlas. */
  bancasFallidas?: string[];
}

export type ResultadoCargaComision = { ok: true; comision?: ComisionPagoCreada } | { ok: false; error: string };

const FRAGMENTO_YA_TIENE_COMISION = 'ya tiene comisión';

interface FilaMovimiento {
  id: string;
  banca_origen_id: string | null;
  subtipo: string | null;
}

/**
 * ¿Está lista la comisión para pagos? Exige la migración del Wallet (columna) y la RPC de pagos. La RPC se prueba con
 * un id nulo: si no existe responde "función inexistente"; si existe, rechaza por negocio (que cuenta como disponible).
 */
export async function pagoComisionDisponible(): Promise<boolean> {
  if (!(await comisionBancariaDisponible())) return false;
  const { error } = await supabaseAdmin.rpc('agregar_comision_bancaria_a_pago', { p_movimiento_id: null, p_usuario: null });
  return !esFuncionInexistente(error);
}

const MENSAJE_PAGO_MONEDA_CUENTA = 'La moneda indicada no coincide con la de la cuenta. Recarga la pantalla e intenta de nuevo.';

/** La moneda declarada por el cliente no se acepta a ciegas: debe ser la de la cuenta en la BD (de ella depende la comisión). */
async function monedaDeclaradaDifiereDeLaCuenta(lineas: readonly LineaComisionPago[]): Promise<string | null> {
  const ids = [...new Set(lineas.map(l => l.bancaId))];
  if (ids.length === 0) return null;
  const { data, error } = await supabaseAdmin.from('bancas').select('id, moneda').in('id', ids);
  if (error) {
    logger.error({ evento: 'pago_comision_moneda_lectura_fallida', mensaje: error.message });
    return MENSAJE_PAGO_MONEDA_CUENTA;
  }
  const reales = new Map((data ?? []).map(b => [String(b.id), String(b.moneda)]));
  return lineas.some(l => reales.get(l.bancaId) !== l.moneda) ? MENSAJE_PAGO_MONEDA_CUENTA : null;
}

/**
 * Valida la elección de comisión ANTES de mover dinero. Devuelve el mensaje de rechazo o null si todo cuadra.
 * Si la comisión no está habilitada en la BD, una cuenta en Bs se paga como siempre; pedirla explícitamente falla.
 */
export async function validarEleccionComisionPago(lineas: readonly LineaComisionPago[]): Promise<string | null> {
  const monedaIncorrecta = await monedaDeclaradaDifiereDeLaCuenta(lineas);
  if (monedaIncorrecta) return monedaIncorrecta;
  if (lineas.some(l => l.llevaComision === true && l.moneda !== 'VES' && !l.automatica)) return MENSAJE_PAGO_COMISION_SOLO_BS;
  const enBs = lineas.filter(l => l.moneda === 'VES' && !l.automatica);
  const hayAutomatica = lineas.some(l => l.automatica);
  if (enBs.length === 0 && !hayAutomatica) return null;
  const disponible = await pagoComisionDisponible();
  if ((enBs.some(l => l.llevaComision === true) || hayAutomatica) && !disponible) return MENSAJE_PAGO_COMISION_PENDIENTE;
  if (disponible && enBs.some(l => l.llevaComision === undefined)) return MENSAJE_PAGO_ELEGIR_COMISION;
  return null;
}

/** De las filas de una cuenta toma la del pago (o, si solo hay adelanto, la del adelanto): el cargo cuelga de una sola. */
function filaPrincipalDeBanca(filas: readonly FilaMovimiento[], bancaId: string): FilaMovimiento | null {
  const propias = filas.filter(f => f.banca_origen_id === bancaId);
  return propias.find(f => f.subtipo === 'pago') ?? propias[0] ?? null;
}

async function leerFilas(movimientoIds: readonly string[]): Promise<FilaMovimiento[] | null> {
  const { data, error } = await supabaseAdmin.from('movimientos').select('id, banca_origen_id, subtipo').in('id', [...movimientoIds]);
  if (error) {
    logger.error({ evento: 'pago_comision_lectura_fallida', mensaje: error.message });
    return null;
  }
  return (data as FilaMovimiento[] | null) ?? [];
}

async function cargarComision(movimientoId: string, usuarioId: string): Promise<{ id: string; monto: number } | { error: string }> {
  const { data, error } = await supabaseAdmin.rpc('agregar_comision_bancaria_a_pago', { p_movimiento_id: movimientoId, p_usuario: usuarioId });
  if (error) {
    logger.error({ evento: 'pago_comision_rpc_fallida', movimientoId, code: error.code, mensaje: error.message });
    return { error: error.message };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return { id: String(r.comisionId ?? ''), monto: Number(r.comision ?? 0) };
}

/** Carga el cargo de UNA cuenta sobre las filas ya leídas. Un reintento sobre un pago que ya tiene su comisión cuenta como resuelto. */
async function cargarComisionDeBancaConFilas(
  filas: readonly FilaMovimiento[], bancaId: string, usuarioId: string
): Promise<ResultadoCargaComision> {
  const principal = filaPrincipalDeBanca(filas, bancaId);
  if (!principal) return { ok: false, error: 'No se encontró el movimiento de la cuenta.' };
  const creada = await cargarComision(principal.id, usuarioId);
  if ('error' in creada) {
    return creada.error.includes(FRAGMENTO_YA_TIENE_COMISION) ? { ok: true } : { ok: false, error: creada.error };
  }
  return { ok: true, comision: { bancaId, movimientoId: creada.id, monto: creada.monto } };
}

/** Reintento del cargo de una cuenta (lee los movimientos del pago). Lo usa el servicio de pasos pendientes. */
export async function reintentarComisionDeBanca(
  movimientoIds: readonly string[], bancaId: string, usuarioId: string
): Promise<ResultadoCargaComision> {
  const filas = await leerFilas(movimientoIds);
  if (!filas) return { ok: false, error: MENSAJE_SIN_LECTURA };
  const resultado = await cargarComisionDeBancaConFilas(filas, bancaId, usuarioId);
  if (resultado.ok && resultado.comision) await aplicarCategoriaAComisiones([resultado.comision.movimientoId].filter(Boolean));
  return resultado;
}

/** Omitir la comisión de un pago desde Bs es una decisión de la persona y queda auditada (sin importes ni textos libres). */
export async function auditarOmisiones(lineas: readonly LineaComisionPago[], grupoId: string | null, usuarioId: string): Promise<void> {
  if (!grupoId || !lineas.some(l => l.moneda === 'VES' && l.llevaComision === false)) return;
  const auditada = await registrarAuditoria({
    entidadTipo: 'pago',
    entidadId: grupoId,
    accion: 'sin_comision_bancaria',
    usuarioId,
    cambios: { comision_bancaria: { antes: 'aplicaba (0.3%, mínimo 14 Bs)', despues: 'omitida por la persona' } },
  });
  if (!auditada) logger.warn({ evento: 'pago_sin_comision_sin_auditoria', grupoId, usuarioId });
}

export interface EntradaComisionesPago {
  /** Movimientos de dinero que devolvió el registro del pago (pago y adelanto de cada cuenta). */
  movimientoIds: readonly string[];
  grupoId: string | null;
  lineas: readonly LineaComisionPago[];
  usuarioId: string;
}

/**
 * Carga la comisión a cada cuenta en Bs donde la persona dijo Sí, le pone la categoría COMISIONES BANCARIAS y audita
 * las omisiones. Nunca falla el pago: lo que no se pueda hacer vuelve como `advertencia`.
 */
export async function aplicarComisionesDePago(entrada: EntradaComisionesPago): Promise<ResultadoComisionesPago> {
  await auditarOmisiones(entrada.lineas, entrada.grupoId, entrada.usuarioId);
  const conComision = entrada.lineas.filter(lineaCargaComision);
  if (conComision.length === 0) return { comisiones: [] };

  const filas = await leerFilas(entrada.movimientoIds);
  if (!filas) return { comisiones: [], advertencia: MENSAJE_SIN_LECTURA, bancasFallidas: conComision.map(l => l.bancaId) };

  const comisiones: ComisionPagoCreada[] = [];
  const bancasFallidas: string[] = [];
  for (const linea of conComision) {
    const r = await cargarComisionDeBancaConFilas(filas, linea.bancaId, entrada.usuarioId);
    if (!r.ok) bancasFallidas.push(linea.bancaId);
    else if (r.comision) comisiones.push(r.comision);
  }

  const categoria = await aplicarCategoriaAComisiones(comisiones.map(c => c.movimientoId).filter(Boolean));
  const advertencia = bancasFallidas.length > 0 ? MENSAJE_COMISION_NO_CARGADA : categoria.advertencia;
  return { comisiones, ...(advertencia ? { advertencia } : {}), ...(bancasFallidas.length > 0 ? { bancasFallidas } : {}) };
}

/**
 * ¿Algún movimiento del grupo tiene un cargo de comisión ligado (movimientos.comision_de_id)? Un movimiento sin
 * grupo es su propio grupo (coalesce(grupo_id, id)). Sin la migración (columna inexistente) cuenta como que no.
 * `grupoId` debe ser un UUID ya validado (se interpola en el filtro).
 */
export async function grupoLlevaComision(grupoId: string): Promise<boolean> {
  const miembros = await supabaseAdmin.from('movimientos').select('id').or(`grupo_id.eq.${grupoId},id.eq.${grupoId}`);
  if (miembros.error) return falloLecturaComision(grupoId, miembros.error);
  const ids = ((miembros.data as Array<{ id: string }> | null) ?? []).map(m => m.id);
  if (ids.length === 0) return false;
  const cargos = await supabaseAdmin.from('movimientos').select('id').in('comision_de_id', ids);
  if (cargos.error) return falloLecturaComision(grupoId, cargos.error);
  return ((cargos.data as unknown[] | null) ?? []).length > 0;
}

function falloLecturaComision(grupoId: string, error: { code?: string; message: string }): false {
  if (!esColumnaInexistente(error, 'comision_de_id')) {
    logger.error({ evento: 'pago_comision_grupo_lectura_fallida', grupoId, mensaje: error.message });
  }
  return false;
}
