import { supabaseAdmin } from '../config/supabase.js';
import { autorizarEdicion, type ActorEdicion } from './edicion-autorizada-service.js';
import { registrarAuditoria } from './auditoria-service.js';
import { obtenerTraslado, type TrasladoPublico } from './traslado-service.js';
import { esErrorFuncionInexistente } from './ticket-principal.js';
import { parsearCambiosStock } from './transformacion-edicion-service.js';
import { cambiosStock, type CambioStock } from '../utils/edicion-pesos-transformacion.js';
import type { EditarTrasladoInput } from '../schemas/traslados-editar.js';
import {
  aplicarPesosTraslado,
  cambiosTraslado,
  proyectarSnapshotTraslado,
  snapshotTrasladoDe,
  validarPesosTraslado,
  type EstadoTraslado,
} from '../utils/edicion-pesos-traslado.js';

export type EditarTrasladoResult =
  | { traslado: TrasladoPublico | null; advertencia?: string }
  | { error: string; codigo: number };

export const MENSAJE_PESOS_TRASLADO_NO_HABILITADOS =
  'La edición de pesos de traslados aún no está habilitada en la base de datos (falta aplicar migration_editar_traslado_pesos.sql).';

function estadoDe(t: TrasladoPublico): EstadoTraslado {
  return {
    estado: t.estado,
    lineas: t.materiales.map(m => ({ id: m.id, pesoBruto: m.pesoBruto, tara: m.tara, pesoRecibido: m.pesoRecibido })),
  };
}

function pesosIguales(a: EstadoTraslado, b: EstadoTraslado): boolean {
  return a.lineas.every((l, i) => {
    const o = b.lineas[i];
    return l.pesoBruto === o.pesoBruto && l.tara === o.tara && l.pesoRecibido === o.pesoRecibido;
  });
}

/**
 * Edita observaciones y pesos (bruto/tara enviados y, si ya fue recepcionado,
 * peso recibido) de un traslado. Mismo patrón que editarTransformacion: validar
 * -> autorizar (llave, un solo uso) -> escribir -> auditar; si la escritura
 * falla se libera la llave. Si cambia algún peso todo va a editar_traslado_pesos
 * (una transacción: reescala la composición de lotes, valida tomas físicas
 * abiertas y que ningún stock de origen o destino quede negativo).
 */
export async function editarTraslado(
  id: string,
  input: EditarTrasladoInput,
  actor: ActorEdicion
): Promise<EditarTrasladoResult> {
  const antes = await obtenerTraslado(id);
  if (!antes) return { error: 'Traslado no encontrado.', codigo: 404 };

  const estadoAntes = estadoDe(antes);
  const aplicado = aplicarPesosTraslado(estadoAntes, input);
  if (!aplicado.ok) return { error: aplicado.error, codigo: 400 };
  const cambianPesos = !pesosIguales(estadoAntes, aplicado.estado);
  if (cambianPesos) {
    const invalido = validarPesosTraslado(aplicado.estado);
    if (invalido) return { error: invalido, codigo: 400 };
  }

  const snapAntes = snapshotTrasladoDe(antes);
  const snapPrevio = { ...snapAntes, observaciones: input.observaciones !== undefined ? input.observaciones : snapAntes.observaciones };
  const hayCambios = cambianPesos || Object.keys(cambiosTraslado(snapAntes, snapPrevio)).length > 0;
  if (!hayCambios) return { error: 'No hay cambios para guardar.', codigo: 400 };

  const auth = await autorizarEdicion(actor, 'traslado', id);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  let cambiosDeStock: CambioStock[] = [];
  if (cambianPesos) {
    const { data, error } = await supabaseAdmin.rpc('editar_traslado_pesos', {
      p_traslado_id: id,
      p_lineas: input.lineas?.map(l => ({
        id: l.id,
        peso_bruto: l.pesoBruto ?? null,
        tara: l.tara ?? null,
        peso_recibido: l.pesoRecibido ?? null,
      })) ?? null,
      p_observaciones: input.observaciones ?? null,
      p_set_observaciones: input.observaciones !== undefined,
    });
    if (error) {
      await auth.liberar();
      return esErrorFuncionInexistente(error)
        ? { error: MENSAJE_PESOS_TRASLADO_NO_HABILITADOS, codigo: 409 }
        : { error: error.message, codigo: 400 };
    }
    cambiosDeStock = parsearCambiosStock((data as { stock?: unknown } | null)?.stock);
  } else {
    const observaciones = snapPrevio.observaciones?.trim() ? snapPrevio.observaciones.trim() : null;
    const { error } = await supabaseAdmin.from('tickets_traslado').update({ observaciones }).eq('id', id);
    if (error) {
      await auth.liberar();
      return { error: error.message, codigo: 400 };
    }
  }

  // Cambio ya confirmado en BD: auditar de inmediato con lo proyectado, sin depender de releer.
  const registrada = await registrarAuditoria({
    entidadTipo: 'traslado',
    entidadId: id,
    accion: 'edicion',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor: auth.autorizadoPor,
    cambios: {
      ...cambiosTraslado(snapAntes, proyectarSnapshotTraslado(snapAntes, aplicado.estado, input.observaciones)),
      ...cambiosStock(cambiosDeStock),
    },
  });

  // Una relectura fallida NO es un error: se devuelve éxito con aviso.
  const traslado = await obtenerTraslado(id).catch(() => null);
  const advertencias = [
    ...(registrada ? [] : ['El traslado se guardó, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.']),
    ...(traslado ? [] : ['El traslado se guardó, pero no se pudo recargar. Actualiza la página para ver los datos nuevos.']),
  ];
  return { traslado, ...(advertencias.length > 0 ? { advertencia: advertencias.join(' ') } : {}) };
}
