import { supabaseAdmin } from '../config/supabase.js';
import type { GuardarValoracionInput } from '../schemas/transformaciones-valoracion.js';
import { obtenerTransformacion } from './transformacion-service.js';

/**
 * Valoración de una transformación (ancla opcional a factura de compra).
 *
 * Las columnas viven en la migración docs/migration_transformacion_valoracion.sql.
 * Mientras esa migración no esté aplicada en BD:
 *  - la LECTURA no debe romper: por eso NO se incluyen en el select base de
 *    transformacion-service.ts; se leen aquí en consultas aparte y, si fallan,
 *    se devuelve null (el GET sigue respondiendo igual que antes);
 *  - la ESCRITURA (RPC atómica) responde 409 con un mensaje claro en vez de un 500.
 */

export interface ValoracionPublica {
  facturaCompraId: string | null;
  costoUnitario: number | null;
  /** precio por id de salida (null = sin precio). */
  preciosSalida: Record<string, number | null>;
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/** null si las columnas no existen todavía (migración pendiente) o si falla la lectura. */
export async function leerValoracion(transformacionId: string): Promise<ValoracionPublica | null> {
  try {
    const { data: cab, error: errCab } = await supabaseAdmin
      .from('transformaciones')
      .select('factura_compra_id, costo_unitario')
      .eq('id', transformacionId)
      .maybeSingle();
    if (errCab || !cab) return null;

    const { data: sal, error: errSal } = await supabaseAdmin
      .from('transformacion_salida_detalle')
      .select('id, precio_unitario')
      .eq('transformacion_id', transformacionId);
    if (errSal) return null;

    const preciosSalida: Record<string, number | null> = {};
    for (const s of (sal ?? []) as Array<{ id: string; precio_unitario: unknown }>) {
      preciosSalida[s.id] = numOrNull(s.precio_unitario);
    }
    return {
      facturaCompraId: (cab as { factura_compra_id: string | null }).factura_compra_id ?? null,
      costoUnitario: numOrNull((cab as { costo_unitario: unknown }).costo_unitario),
      preciosSalida,
    };
  } catch {
    return null;
  }
}

/** Errores que indican que la migración (columnas o función) aún no está aplicada. */
function esMigracionPendiente(err: { code?: string; message?: string }): boolean {
  return ['42703', 'PGRST204', 'PGRST202', '42883'].includes(err.code ?? '') ||
    /column .* does not exist|Could not find the|function .* does not exist/i.test(err.message ?? '');
}

const MENSAJE_MIGRACION_PENDIENTE =
  'La valoración aún no está habilitada en la base de datos (falta aplicar migration_transformacion_valoracion.sql).';

export type GuardarValoracionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

async function validarFactura(facturaCompraId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('facturas_compra')
    .select('id')
    .eq('id', facturaCompraId)
    .maybeSingle();
  return !!data;
}

function traducirError(err: { code?: string; message?: string }): GuardarValoracionResult {
  if (esMigracionPendiente(err)) return { ok: false, status: 409, error: MENSAJE_MIGRACION_PENDIENTE };
  const msg = err.message ?? '';
  if (msg.includes('TRANSFORMACION_NO_ENCONTRADA')) return { ok: false, status: 404, error: 'Transformación no encontrada.' };
  if (msg.includes('SALIDA_AJENA')) return { ok: false, status: 400, error: 'Alguna salida no pertenece a esta transformación.' };
  if (err.code === '23503') return { ok: false, status: 400, error: 'La factura de compra indicada no existe.' };
  return { ok: false, status: 400, error: msg || 'No se pudo guardar la valoración.' };
}

/** Guarda cabecera y precios en UNA transacción vía guardar_valoracion_transformacion().
 *  Campo undefined = sin cambios; null = borrar. */
export async function guardarValoracion(
  transformacionId: string,
  input: GuardarValoracionInput
): Promise<GuardarValoracionResult> {
  if (input.facturaCompraId && !(await validarFactura(input.facturaCompraId))) {
    return { ok: false, status: 400, error: 'La factura de compra indicada no existe.' };
  }

  const { error } = await supabaseAdmin.rpc('guardar_valoracion_transformacion', {
    p_id: transformacionId,
    p_factura_compra_id: input.facturaCompraId ?? null,
    p_costo_unitario: input.costoUnitario ?? null,
    p_salidas: input.salidas.map(s => ({ id: s.id, precioUnitario: s.precioUnitario })),
    p_set_factura: input.facturaCompraId !== undefined,
    p_set_costo: input.costoUnitario !== undefined,
  });
  return error ? traducirError(error) : { ok: true };
}

/** Transformación base + campos de valoración (opcionales: ausentes si la migración no está aplicada). */
export async function obtenerTransformacionConValoracion(id: string) {
  const base = await obtenerTransformacion(id);
  if (!base) return null;
  const val = await leerValoracion(id);
  if (!val) return { ...base, valoracionDisponible: false };
  return {
    ...base,
    valoracionDisponible: true,
    facturaCompraId: val.facturaCompraId,
    costoUnitario: val.costoUnitario,
    salidas: base.salidas.map(s => ({ ...s, precioUnitario: val.preciosSalida[s.id] ?? null })),
  };
}
