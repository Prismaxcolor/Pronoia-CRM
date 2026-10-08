import { supabaseAdmin } from '../config/supabase.js';
import { autorizarEdicion, type ActorEdicion } from './edicion-autorizada-service.js';
import { nombreDeUsuario, registrarAuditoria } from './auditoria-service.js';
import { obtenerPagoDetalle, type PagoDetalle } from './pago-detalle-service.js';
import type { TipoEntidad } from './estado-cuenta-service.js';
import { calcularCambios, type CambiosAuditoria } from '../utils/auditoria.js';
import type { EditarPagoInput } from '../schemas/transacciones-editar.js';
import {
  codigoDePago,
  errorDeRpcTransaccion,
  esEdicionContable,
  parametrosCamposPago,
  parametrosContablesPago,
  resumirPago,
  type ErrorTransaccion,
} from '../utils/transaccion-edicion.js';
import { logger } from '../utils/logger.js';

/** 'pago' = a proveedor (egreso); 'cobro' = de cliente (ingreso). También es la entidad de la llave y de la auditoría. */
export type TipoPagoCobro = 'pago' | 'cobro';

export interface ResultadoPagoEdicion {
  detalle: PagoDetalle;
  /** Código legible de la operación (PG-/AD-/CB-/AC-/CR-/CRV-). */
  codigo: string | null;
  /** Nombre de quien entregó la llave (null si lo hizo un superadmin o un rol sin llave). */
  autorizadoPor: string | null;
  cambios: CambiosAuditoria;
  advertencia?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_NO_ENCONTRADO = 'Pago o cobro no encontrado.';
const MSG_SIN_REGISTRO_HISTORIAL =
  'El cambio se guardó, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.';

interface GrupoPago {
  entidadTipo: TipoEntidad;
  entidadId: string;
  detalle: PagoDetalle;
}

/** Lee el grupo y comprueba que sea del lado correcto (pago = proveedor, cobro = cliente). */
async function cargarGrupo(tipo: TipoPagoCobro, grupoId: string): Promise<GrupoPago | ErrorTransaccion> {
  if (!UUID_RE.test(grupoId)) return { error: MSG_NO_ENCONTRADO, codigo: 404 };
  const entidadTipo: TipoEntidad = tipo === 'pago' ? 'proveedor' : 'cliente';
  const columna = tipo === 'pago' ? 'proveedor_id' : 'cliente_id';

  const { data: movs, error } = await supabaseAdmin
    .from('movimientos')
    .select('proveedor_id, cliente_id, subtipo')
    .or(`grupo_id.eq.${grupoId},id.eq.${grupoId}`)
    .limit(1);
  if (error) return { error: 'No se pudo leer el pago.', codigo: 500 };

  let entidadId: string | null = null;
  const fila = ((movs ?? []) as Array<Record<string, string | null>>)[0];
  if (fila) {
    // Un movimiento manual (sin subtipo) no es un pago: se gestiona desde Cochinito.
    if (!fila.subtipo) return { error: MSG_NO_ENCONTRADO, codigo: 404 };
    entidadId = fila[columna] ?? null;
  } else {
    const { data: cruce } = await supabaseAdmin.from('cruces').select('proveedor_id, cliente_id').eq('grupo_id', grupoId).maybeSingle();
    entidadId = (cruce as Record<string, string | null> | null)?.[columna] ?? null;
  }
  if (!entidadId) return { error: MSG_NO_ENCONTRADO, codigo: 404 };

  const detalle = await obtenerPagoDetalle(entidadTipo, entidadId, grupoId);
  if ('error' in detalle) return { error: MSG_NO_ENCONTRADO, codigo: 404 };
  return { entidadTipo, entidadId, detalle };
}

interface DatosCierre {
  tipo: TipoPagoCobro;
  grupoId: string;
  grupo: GrupoPago;
  actor: ActorEdicion;
  autorizadoPor: string | null;
  accion: 'editar' | 'anular';
}

/** Relee el detalle, audita (campo por campo) y arma la respuesta. La BD ya se modificó. */
async function cerrarOperacion(d: DatosCierre): Promise<ResultadoPagoEdicion | ErrorTransaccion> {
  const despues = await obtenerPagoDetalle(d.grupo.entidadTipo, d.grupo.entidadId, d.grupoId);
  if ('error' in despues) return { error: 'El cambio se guardó, pero no se pudo leer de vuelta.', codigo: 500 };

  const cambios = calcularCambios(resumirPago(d.grupo.detalle), resumirPago(despues));
  const registrada = await registrarAuditoria({
    entidadTipo: d.tipo,
    entidadId: d.grupoId,
    accion: d.accion,
    usuarioId: d.actor.userId,
    usuarioEmail: d.actor.email,
    autorizadoPor: d.autorizadoPor,
    cambios,
  });
  logger.info({
    evento: d.accion === 'anular' ? `${d.tipo}_anulado` : `${d.tipo}_editado`,
    userId: d.actor.userId,
    grupoId: d.grupoId,
    autorizadoPor: d.autorizadoPor,
  });
  return {
    detalle: despues,
    codigo: codigoDePago(despues),
    autorizadoPor: d.autorizadoPor ? await nombreDeUsuario(d.autorizadoPor) : null,
    cambios,
    ...(registrada ? {} : { advertencia: MSG_SIN_REGISTRO_HISTORIAL }),
  };
}

/**
 * Anula un pago, cobro o cruce completo con llave de edición (o como superadmin): revierte
 * el saldo de las bancas, las facturas y notas aplicadas y los adelantos, en una sola
 * transacción SQL. La fila nunca se borra: queda marcada con motivo, quién y cuándo.
 * Los rechazos de negocio (ya anulado, adelanto ya usado, banca sin fondos...) llegan como 409
 * y devuelven la llave.
 */
export async function anularPagoCobro(
  tipo: TipoPagoCobro,
  grupoId: string,
  motivo: string,
  actor: ActorEdicion
): Promise<ResultadoPagoEdicion | ErrorTransaccion> {
  const grupo = await cargarGrupo(tipo, grupoId);
  if ('error' in grupo) return grupo;
  if (grupo.detalle.anulado) return { error: 'Esta operación ya fue anulada.', codigo: 409 };

  const auth = await autorizarEdicion(actor, tipo, grupoId);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const { error } = await supabaseAdmin.rpc('anular_pago_cobro', {
    p_grupo_id: grupoId,
    p_motivo: motivo,
    p_usuario: actor.userId,
  });
  if (error) {
    await auth.liberar();
    return errorDeRpcTransaccion(error);
  }
  return cerrarOperacion({ tipo, grupoId, grupo, actor, autorizadoPor: auth.autorizadoPor, accion: 'anular' });
}

/**
 * Edita un pago o cobro con llave de edición (o como superadmin). Sin `bancas/montoUsd/items`
 * solo cambia campos libres (concepto, referencia, fecha, comprobantes). Con ellos, la RPC revierte
 * el efecto completo y lo reaplica validando saldos, en una transacción; conserva el grupo, los
 * correlativos, la fecha de registro y el autor. Un cruce sin dinero solo admite los campos libres.
 */
export async function editarPagoCobro(
  tipo: TipoPagoCobro,
  grupoId: string,
  input: EditarPagoInput,
  actor: ActorEdicion
): Promise<ResultadoPagoEdicion | ErrorTransaccion> {
  const grupo = await cargarGrupo(tipo, grupoId);
  if ('error' in grupo) return grupo;
  const antes = grupo.detalle;
  if (antes.anulado) return { error: 'Esta operación está anulada y no se puede editar.', codigo: 409 };

  const contable = esEdicionContable(input);
  if (contable && antes.bancas.length === 0) {
    return { error: 'Un cruce sin movimiento de dinero no admite cambios contables: anúlalo y regístralo de nuevo.', codigo: 409 };
  }

  const auth = await autorizarEdicion(actor, tipo, grupoId);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const { error } = contable
    ? await supabaseAdmin.rpc('editar_pago_cobro_contable', parametrosContablesPago(grupoId, input, antes, actor.userId))
    : await supabaseAdmin.rpc('editar_pago_cobro_campos', parametrosCamposPago(grupoId, input, actor.userId));
  if (error) {
    await auth.liberar();
    return errorDeRpcTransaccion(error);
  }
  return cerrarOperacion({ tipo, grupoId, grupo, actor, autorizadoPor: auth.autorizadoPor, accion: 'editar' });
}
