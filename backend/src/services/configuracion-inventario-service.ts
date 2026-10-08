import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { registrarAuditoria } from './auditoria-service.js';
import { ID_AUDITORIA_CONFIG_INVENTARIO } from '../utils/auditoria.js';
import { mensajeDeErrorBd } from '../utils/errores-bd.js';
import { esObjetoInexistente, MENSAJE_INVENTARIO_NO_HABILITADO } from '../utils/migracion-pendiente.js';
import {
  DEFINICIONES_CONFIG_INVENTARIO,
  NOMBRES_CONFIG_INVENTARIO,
  configuracionPorDefecto,
  validarConfiguracionInventario,
  type ActualizarConfiguracionInventarioInput,
  type ConfiguracionInventario,
  type NombreConfigInventario,
} from '../schemas/configuracion-inventario.js';

interface ConfigRow {
  clave: string;
  valor: number | string;
}

const nombrePorClave = new Map<string, NombreConfigInventario>(
  NOMBRES_CONFIG_INVENTARIO.map(n => [DEFINICIONES_CONFIG_INVENTARIO[n].clave, n])
);

/** Combina las filas de la tabla con los valores por defecto (filas ausentes o inválidas = defecto). */
export function combinarConfiguracion(filas: readonly ConfigRow[]): ConfiguracionInventario {
  const valores = configuracionPorDefecto();
  for (const f of filas) {
    const nombre = nombrePorClave.get(f.clave);
    const valor = Number(f.valor);
    if (nombre && Number.isFinite(valor)) valores[nombre] = valor;
  }
  return valores;
}

/** Configuración vigente. Tolerante: si la tabla aún no existe o falla la lectura, usa los valores por defecto. */
export async function leerConfiguracionInventario(): Promise<ConfiguracionInventario> {
  try {
    const { data, error } = await supabaseAdmin.from('configuracion_inventario').select('clave, valor');
    if (error) {
      if (!esObjetoInexistente(error)) logger.warn({ evento: 'configuracion_inventario_no_leida', motivo: error.message });
      return configuracionPorDefecto();
    }
    return combinarConfiguracion((data ?? []) as ConfigRow[]);
  } catch (err) {
    logger.warn({ evento: 'configuracion_inventario_no_leida', motivo: err instanceof Error ? err.message : String(err) });
    return configuracionPorDefecto();
  }
}

export type ActualizarConfiguracionResult =
  | {
      ok: true;
      configuracion: ConfiguracionInventario;
      cambios: Partial<Record<NombreConfigInventario, { antes: number; despues: number }>>;
      /** Se guardó, pero el cambio no quedó en el historial de auditoría. */
      advertencia?: string;
    }
  | { ok: false; error: string; status: 400 | 409 | 500 };

/** Solo los parámetros enviados cuyo valor realmente cambia. */
export function calcularCambiosConfiguracion(
  actual: ConfiguracionInventario,
  entrada: ActualizarConfiguracionInventarioInput
): Partial<Record<NombreConfigInventario, { antes: number; despues: number }>> {
  const cambios: Partial<Record<NombreConfigInventario, { antes: number; despues: number }>> = {};
  for (const nombre of NOMBRES_CONFIG_INVENTARIO) {
    const nuevo = entrada[nombre];
    if (nuevo !== undefined && nuevo !== actual[nombre]) cambios[nombre] = { antes: actual[nombre], despues: nuevo };
  }
  return cambios;
}

/** Quién cambia la configuración (para sellar actualizado_por y registrar la auditoría). */
export interface ActorConfiguracion {
  userId: string;
  email?: string;
}

export const ADVERTENCIA_AUDITORIA_CONFIG =
  'La configuración se guardó, pero no se pudo registrar en el historial de cambios. Avisa al administrador.';

/** Cambios en el formato de auditoría: una entrada por parámetro, con el nombre de su clave en la tabla. */
export function cambiosParaAuditoria(
  cambios: Partial<Record<NombreConfigInventario, { antes: number; despues: number }>>
): Record<string, { antes: number; despues: number }> {
  const out: Record<string, { antes: number; despues: number }> = {};
  for (const nombre of NOMBRES_CONFIG_INVENTARIO) {
    const c = cambios[nombre];
    if (c) out[DEFINICIONES_CONFIG_INVENTARIO[nombre].clave] = c;
  }
  return out;
}

export async function actualizarConfiguracionInventario(
  entrada: ActualizarConfiguracionInventarioInput,
  actor: ActorConfiguracion
): Promise<ActualizarConfiguracionResult> {
  const actual = await leerConfiguracionInventario();
  const cambios = calcularCambiosConfiguracion(actual, entrada);
  const nombres = Object.keys(cambios) as NombreConfigInventario[];
  if (nombres.length === 0) return { ok: true, configuracion: actual, cambios };

  const combinada = { ...actual, ...Object.fromEntries(nombres.map(n => [n, cambios[n]!.despues])) } as ConfiguracionInventario;
  const invalido = validarConfiguracionInventario(combinada);
  if (invalido) return { ok: false, error: invalido, status: 400 };

  const ahora = new Date().toISOString();
  const filas = nombres.map(n => {
    const d = DEFINICIONES_CONFIG_INVENTARIO[n];
    return {
      clave: d.clave, valor: combinada[n], tipo: d.tipo, minimo: d.minimo, maximo: d.maximo,
      descripcion: d.descripcion, actualizado_en: ahora, actualizado_por: actor.userId,
    };
  });
  const { error } = await supabaseAdmin.from('configuracion_inventario').upsert(filas, { onConflict: 'clave' });
  if (error) {
    if (esObjetoInexistente(error)) return { ok: false, error: MENSAJE_INVENTARIO_NO_HABILITADO, status: 409 };
    logger.error({ evento: 'configuracion_inventario_no_guardada', userId: actor.userId, motivo: error.message });
    return { ok: false, error: mensajeDeErrorBd(error, 'No se pudo guardar la configuración.'), status: 500 };
  }
  logger.info({ evento: 'configuracion_inventario_actualizada', userId: actor.userId, cambios });
  const auditada = await registrarAuditoria({
    entidadTipo: 'configuracion_inventario',
    entidadId: ID_AUDITORIA_CONFIG_INVENTARIO,
    accion: 'actualizar',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    cambios: cambiosParaAuditoria(cambios),
  });
  return { ok: true, configuracion: combinada, cambios, ...(auditada ? {} : { advertencia: ADVERTENCIA_AUDITORIA_CONFIG }) };
}
