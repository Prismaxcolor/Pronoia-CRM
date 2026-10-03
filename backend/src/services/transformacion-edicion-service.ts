import { supabaseAdmin } from '../config/supabase.js';
import { autorizarEdicion, type ActorEdicion } from './edicion-autorizada-service.js';
import { registrarAuditoria } from './auditoria-service.js';
import { obtenerTransformacionConValoracion } from './transformacion-valoracion-service.js';
import { aplicarEdicion, cambiosEdicion, type CamposEditables } from '../utils/edicion-transformacion.js';
import type { EditarTransformacionInput } from '../schemas/transformaciones-editar.js';

type Transformacion = NonNullable<Awaited<ReturnType<typeof obtenerTransformacionConValoracion>>>;
export type EditarTransformacionResult =
  | { transformacion: Transformacion }
  | { error: string; codigo: number };

async function leerEditables(id: string): Promise<CamposEditables | null> {
  const { data, error } = await supabaseAdmin
    .from('transformaciones').select('fecha, notas').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return { fecha: String(data.fecha), notas: (data.notas as string | null) ?? null };
}

/**
 * Edita fecha/notas de una transformación (bruto o completa). Mismo patrón que
 * editarTicket: leer estado -> autorizar (llave) -> UPDATE -> auditar; si el
 * UPDATE falla se libera la llave. Los pesos y salidas NO se editan (afectan stock).
 */
export async function editarTransformacion(
  id: string,
  input: EditarTransformacionInput,
  actor: ActorEdicion
): Promise<EditarTransformacionResult> {
  const antes = await leerEditables(id);
  if (!antes) return { error: 'Transformación no encontrada.', codigo: 404 };

  const despues = aplicarEdicion(antes, input);
  const cambios = cambiosEdicion(antes, despues);
  // Antes de autorizar: una edición sin cambios no debe gastar la llave.
  if (Object.keys(cambios).length === 0) return { error: 'No hay cambios para guardar.', codigo: 400 };

  const auth = await autorizarEdicion(actor, 'transformacion', id);
  if (!auth.ok) return { error: auth.error, codigo: auth.codigo };

  const { error } = await supabaseAdmin
    .from('transformaciones').update({ fecha: despues.fecha, notas: despues.notas }).eq('id', id);
  if (error) {
    await auth.liberar();
    return { error: error.message, codigo: 400 };
  }

  await registrarAuditoria({
    entidadTipo: 'transformacion',
    entidadId: id,
    accion: 'edicion',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor: auth.autorizadoPor,
    cambios,
  });

  const transformacion = await obtenerTransformacionConValoracion(id);
  if (!transformacion) return { error: 'La transformación se editó pero no se pudo leer de vuelta.', codigo: 500 };
  return { transformacion };
}
