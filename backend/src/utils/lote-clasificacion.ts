/**
 * Clase y precio estimado de venta de un lote: lógica pura (sin BD).
 *
 * clase: 'exportacion' (Lote 1-4), 'trabajo' (BGPP, BGYP, PCPP, PCYP, LOTE MPP: se
 * distribuyen luego entre Lote 1/2/3) u 'otro'. El precio estimado (USD/kg) es una
 * cifra APROXIMADA de venta que carga una persona: los lotes mezclan materiales y
 * no se pueden costear; nunca se inventa un precio.
 */
import type { CambiosAuditoria, ValorAuditado } from './auditoria.js';

export const CLASES_LOTE = ['exportacion', 'trabajo', 'otro'] as const;
export type ClaseLote = (typeof CLASES_LOTE)[number];

export interface ClasificacionLote {
  clase: ClaseLote;
  precioEstimadoKg: number | null;
}

export interface CambiosClasificacion {
  clase?: ClaseLote;
  /** null borra el precio. */
  precioEstimadoKg?: number | null;
}

export function esClaseLote(valor: unknown): valor is ClaseLote {
  return typeof valor === 'string' && (CLASES_LOTE as readonly string[]).includes(valor);
}

/** Normaliza lo que viene de la BD (columna ausente o valor raro = 'otro' / sin precio). */
export function leerClasificacion(row: { clase?: unknown; precio_estimado_kg?: unknown }): ClasificacionLote {
  const precio = row.precio_estimado_kg == null ? null : Number(row.precio_estimado_kg);
  return {
    clase: esClaseLote(row.clase) ? row.clase : 'otro',
    precioEstimadoKg: precio != null && Number.isFinite(precio) ? precio : null,
  };
}

export interface UpdateClasificacion {
  /** Columnas a escribir (vacío = nada cambia). */
  update: Record<string, unknown>;
  cambios: CambiosAuditoria;
}

/** Calcula solo lo que realmente cambia. Si cambia el precio (incluso a null) se sella quién y cuándo. */
export function construirUpdateClasificacion(
  previo: ClasificacionLote,
  cambios: CambiosClasificacion,
  usuarioId: string | null,
  ahora: Date
): UpdateClasificacion {
  const update: Record<string, unknown> = {};
  const auditoria: Record<string, { antes: ValorAuditado; despues: ValorAuditado }> = {};

  if (cambios.clase !== undefined && cambios.clase !== previo.clase) {
    update.clase = cambios.clase;
    auditoria.clase = { antes: previo.clase, despues: cambios.clase };
  }
  if (cambios.precioEstimadoKg !== undefined && cambios.precioEstimadoKg !== previo.precioEstimadoKg) {
    update.precio_estimado_kg = cambios.precioEstimadoKg;
    update.precio_estimado_actualizado_en = ahora.toISOString();
    update.precio_estimado_actualizado_por = usuarioId;
    auditoria.precio_estimado_kg = { antes: previo.precioEstimadoKg, despues: cambios.precioEstimadoKg };
  }
  return { update, cambios: auditoria };
}
