import { autorizarEdicion, type ActorEdicion } from './edicion-autorizada-service.js';
import { nombreDeUsuario, registrarAuditoria } from './auditoria-service.js';
import { calcularCambios, type CambiosAuditoria } from '../utils/auditoria.js';
import { ESTADO_ANULADO, ESTADO_VIGENTE, type ErrorTransaccion } from '../utils/transaccion-edicion.js';
import { logger } from '../utils/logger.js';

export type TipoNotaConLlave = 'nota_ajuste_proveedor' | 'nota_ajuste_cliente';

export interface ResultadoAnulacionNota {
  id: string;
  /** Nombre de quien entregó la llave (null si lo hizo un superadmin o un rol sin llave). */
  autorizadoPor: string | null;
  cambios: CambiosAuditoria;
  advertencia?: string;
}

const MSG_SIN_REGISTRO_HISTORIAL =
  'La nota se anuló, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.';

/**
 * Anular una nota de ajuste exige llave de edición (o ser superadmin), igual que editar un ticket:
 * se autoriza ANTES de ejecutar, la llave se devuelve si la anulación falla (nota ya aplicada a un
 * pago, ya anulada...) y el resultado queda en auditoria_ediciones.
 */
export async function anularNotaAutorizada(args: {
  tipo: TipoNotaConLlave;
  notaId: string;
  motivo: string;
  actor: ActorEdicion;
  /** La anulación en sí (RPC anular_nota_ajuste_*), sin autorización. */
  anular: () => Promise<{ id: string } | { error: string }>;
}): Promise<ResultadoAnulacionNota | ErrorTransaccion> {
  const { tipo, notaId, motivo, actor } = args;
  const auth = await autorizarEdicion(actor, tipo, notaId);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const resultado = await args.anular();
  if ('error' in resultado) {
    await auth.liberar();
    return { error: resultado.error, codigo: resultado.error.includes('no encontrada') ? 404 : 400 };
  }

  const cambios = calcularCambios(
    { estado: ESTADO_VIGENTE, motivo_anulacion: null },
    { estado: ESTADO_ANULADO, motivo_anulacion: motivo }
  );
  const registrada = await registrarAuditoria({
    entidadTipo: tipo,
    entidadId: notaId,
    accion: 'anular',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor: auth.autorizadoPor,
    cambios,
  });
  logger.info({ evento: `${tipo}_anulada_con_llave`, userId: actor.userId, notaId, autorizadoPor: auth.autorizadoPor });
  return {
    id: resultado.id,
    autorizadoPor: auth.autorizadoPor ? await nombreDeUsuario(auth.autorizadoPor) : null,
    cambios,
    ...(registrada ? {} : { advertencia: MSG_SIN_REGISTRO_HISTORIAL }),
  };
}
