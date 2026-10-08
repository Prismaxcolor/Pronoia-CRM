import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado, trocear } from '../utils/paginacion.js';
import { mensajeDeErrorBd } from '../utils/errores-bd.js';
import { logger } from '../utils/logger.js';
import { registrarAuditoria } from './auditoria-service.js';
import { autorizarEdicion, type ActorEdicion } from './edicion-autorizada-service.js';
import { esObjetoInexistente, MENSAJE_INVENTARIO_NO_HABILITADO } from '../utils/migracion-pendiente.js';
import {
  TIPOS_MERMA,
  consolidarDetalleMerma,
  desglosarMerma,
  tipoMermaParaDetalle,
  validarMermaTipificada,
  type DesgloseMerma,
  type DetalleMerma,
} from '../utils/merma-tipificada.js';
import { calcularMerma } from '../utils/merma-transformacion.js';
import type { CambiosAuditoria } from '../utils/auditoria.js';
import type { MermaDetalleInput } from '../schemas/merma-tipificada.js';

interface MermaRow {
  transformacion_id: string;
  tipo: string;
  peso_kg: number | string;
}

function aDetalle(rows: ReadonlyArray<Pick<MermaRow, 'tipo' | 'peso_kg'>>): DetalleMerma[] {
  return rows.flatMap((r): DetalleMerma[] => {
    const tipo = tipoMermaParaDetalle(r.tipo);
    const pesoKg = Number(r.peso_kg);
    return tipo && Number.isFinite(pesoKg) ? [{ tipo, pesoKg }] : [];
  });
}

export const MENSAJE_MERMA_NO_LEIDA = 'No se pudo leer el desglose de merma por tipo. Intenta de nuevo.';

/** Desglose de merma por transformación. Con `ids` solo se leen esas (en trozos con .in());
 *  sin `ids`, toda la tabla. Tabla aún inexistente (migración pendiente) = mapa vacío. Cualquier
 *  otro fallo de lectura se PROPAGA: un mapa vacío haría ver toda la merma como "sin clasificar". */
export async function cargarMermaDetalle(ids?: ReadonlySet<string>): Promise<Map<string, DetalleMerma[]>> {
  const porId = new Map<string, DetalleMerma[]>();
  if (ids && ids.size === 0) return porId;
  try {
    const consultas = ids
      ? trocear([...ids]).map(trozo => leerFilasMerma(trozo))
      : [leerFilasMerma(null)];
    for (const filas of await Promise.all(consultas)) {
      for (const f of filas) porId.set(f.transformacion_id, [...(porId.get(f.transformacion_id) ?? []), ...aDetalle([f])]);
    }
  } catch (err) {
    if (esObjetoInexistente(err as { code?: string; message?: string })) return new Map();
    logger.error({ evento: 'merma_detalle_no_leida', motivo: err instanceof Error ? err.message : String(err) });
    throw new Error(MENSAJE_MERMA_NO_LEIDA);
  }
  return porId;
}

function leerFilasMerma(trozo: readonly string[] | null): Promise<MermaRow[]> {
  return leerPaginado<MermaRow>((desde, hasta) => {
    let q = supabaseAdmin.from('transformacion_merma_detalle').select('transformacion_id, tipo, peso_kg');
    if (trozo) q = q.in('transformacion_id', [...trozo]);
    return q.order('transformacion_id').order('tipo').range(desde, hasta);
  });
}

/** Desglose de una sola transformación. [] si no hay o la tabla no existe. */
export async function leerMermaDetalle(transformacionId: string): Promise<DetalleMerma[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('transformacion_merma_detalle')
      .select('tipo, peso_kg')
      .eq('transformacion_id', transformacionId);
    if (error) return [];
    return aDetalle((data ?? []) as MermaRow[]);
  } catch {
    return [];
  }
}

interface CabeceraMerma {
  estado: string;
  netoEntrada: number;
  netoSalidas: number;
}

async function leerCabeceraMerma(id: string): Promise<CabeceraMerma | null> {
  const { data: cab } = await supabaseAdmin.from('transformaciones').select('estado, peso_neto').eq('id', id).maybeSingle();
  if (!cab) return null;
  const { data: sal } = await supabaseAdmin.from('transformacion_salida_detalle').select('peso_neto').eq('transformacion_id', id);
  const netoSalidas = ((sal ?? []) as Array<{ peso_neto: number | string | null }>).reduce((a, s) => a + Number(s.peso_neto ?? 0), 0);
  return { estado: String(cab.estado), netoEntrada: Number(cab.peso_neto ?? 0), netoSalidas };
}

/** Valida el desglose contra los netos ya conocidos (antes de completar). null si es válido. */
export function validarMermaContraNetos(
  netoEntrada: number,
  netosSalidas: readonly number[],
  detalle: readonly DetalleMerma[]
): string | null {
  return validarMermaTipificada(calcularMerma(netoEntrada, netosSalidas).kgMerma, detalle);
}

export interface ResultadoRegistroMerma {
  mermaKg: number;
  tipificadaKg: number;
  sinClasificarKg: number;
  antes: Partial<Record<string, number>>;
  despues: Partial<Record<string, number>>;
}

export type RegistrarMermaResult =
  | { ok: true; resultado: ResultadoRegistroMerma }
  | { ok: false; error: string; status: 400 | 409 };

function aNumeros(raw: unknown): Partial<Record<string, number>> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Partial<Record<string, number>> = {};
  for (const t of TIPOS_MERMA) {
    const n = Number((raw as Record<string, unknown>)[t]);
    if (Number.isFinite(n) && n > 0) out[t] = n;
  }
  return out;
}

/** Reemplaza (atómicamente, en una sola RPC) el desglose de merma de una transformación completa. */
export async function registrarMermaTransformacion(
  id: string,
  detalle: readonly DetalleMerma[]
): Promise<RegistrarMermaResult> {
  const { data, error } = await supabaseAdmin.rpc('registrar_merma_transformacion', {
    p_transformacion_id: id,
    p_detalle: consolidarDetalleMerma(detalle).map(d => ({ tipo: d.tipo, peso_kg: d.pesoKg })),
  });
  if (error) {
    return esObjetoInexistente(error)
      ? { ok: false, error: MENSAJE_INVENTARIO_NO_HABILITADO, status: 409 }
      : { ok: false, error: mensajeDeErrorBd(error, 'No se pudo guardar la merma.'), status: 400 };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    resultado: {
      mermaKg: Number(r.mermaKg ?? 0),
      tipificadaKg: Number(r.tipificadaKg ?? 0),
      sinClasificarKg: Number(r.sinClasificarKg ?? 0),
      antes: aNumeros(r.antes),
      despues: aNumeros(r.despues),
    },
  };
}

/** Entradas de auditoría `merma_<tipo>` solo para los tipos que cambiaron. */
export function cambiosMerma(
  antes: Partial<Record<string, number>>,
  despues: Partial<Record<string, number>>
): CambiosAuditoria {
  const cambios: Record<string, { antes: number | null; despues: number | null }> = {};
  for (const tipo of TIPOS_MERMA) {
    const a = antes[tipo] ?? null;
    const d = despues[tipo] ?? null;
    if (a !== d) cambios[`merma_${tipo}`] = { antes: a, despues: d };
  }
  return cambios;
}

export type EditarMermaResult =
  | { ok: true; desglose: DesgloseMerma; advertencia?: string }
  | { ok: false; error: string; codigo: number };

/**
 * Edita el desglose de merma de una transformación YA completada. Mismo patrón que
 * editarTransformacion: validar -> autorizar (llave de un solo uso para quien la
 * necesita) -> escribir en una RPC atómica -> auditar. Una edición inválida o sin
 * cambios no gasta la llave; si la escritura falla se libera.
 */
export async function editarMermaTransformacion(
  id: string,
  detalleEntrada: MermaDetalleInput,
  actor: ActorEdicion
): Promise<EditarMermaResult> {
  const cab = await leerCabeceraMerma(id);
  if (!cab) return { ok: false, error: 'Transformación no encontrada.', codigo: 404 };
  if (cab.estado !== 'completa') {
    return { ok: false, error: 'La merma se registra al completar la transformación.', codigo: 400 };
  }

  const detalle = consolidarDetalleMerma(detalleEntrada);
  const mermaKg = calcularMerma(cab.netoEntrada, [cab.netoSalidas]).kgMerma;
  const invalido = validarMermaTipificada(mermaKg, detalle);
  if (invalido) return { ok: false, error: invalido, codigo: 400 };

  const actual = consolidarDetalleMerma(await leerMermaDetalle(id));
  if (JSON.stringify(actual) === JSON.stringify(detalle)) {
    return { ok: false, error: 'No hay cambios para guardar.', codigo: 400 };
  }

  const auth = await autorizarEdicion(actor, 'transformacion', id);
  if (!auth.ok) return { ok: false, error: auth.error, codigo: auth.codigo };

  const registro = await registrarMermaTransformacion(id, detalle);
  if (!registro.ok) {
    await auth.liberar();
    return { ok: false, error: registro.error, codigo: registro.status };
  }

  const registrada = await registrarAuditoria({
    entidadTipo: 'transformacion',
    entidadId: id,
    accion: 'edicion_merma',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    autorizadoPor: auth.autorizadoPor,
    cambios: cambiosMerma(registro.resultado.antes, registro.resultado.despues),
  });
  return {
    ok: true,
    desglose: desglosarMerma(mermaKg, detalle),
    ...(registrada ? {} : { advertencia: 'La merma se guardó, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.' }),
  };
}

export interface ResultadoMermaAlCompletar {
  /** Aviso no bloqueante: la transformación se completó pero la merma no quedó guardada. */
  advertencia?: string;
}

/**
 * Guarda la merma opcional justo después de completar. La transformación ya está
 * completa y confirmada (las RPC de completar no se tocan): si el registro falla
 * NO se deshace nada, se devuelve un aviso para reintentar desde "Editar merma".
 * La validación previa (validarMermaContraNetos) evita que esto ocurra por exceso de kg.
 */
export async function registrarMermaAlCompletar(
  id: string,
  detalle: MermaDetalleInput | undefined,
  usuarioId: string
): Promise<ResultadoMermaAlCompletar> {
  const consolidado = consolidarDetalleMerma(detalle ?? []);
  if (consolidado.length === 0) return {};
  const registro = await registrarMermaTransformacion(id, consolidado);
  if (!registro.ok) {
    return { advertencia: `La transformación se completó, pero la merma por tipo no se guardó: ${registro.error}` };
  }
  await registrarAuditoria({
    entidadTipo: 'transformacion',
    entidadId: id,
    accion: 'merma_al_completar',
    usuarioId,
    cambios: cambiosMerma(registro.resultado.antes, registro.resultado.despues),
  });
  return {};
}
