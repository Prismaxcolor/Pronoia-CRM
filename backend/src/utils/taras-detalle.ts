import { z } from 'zod';
import { redondearKg } from './peso-kg.js';

/** Tolerancia (kg) entre la suma del desglose de taras y la tara total del material. */
export const TOLERANCIA_TARAS_KG = 0.005;
const MAX_TARAS_POR_MATERIAL = 20;

/** Una tara individual del desglose de un material (saca ×2, cesta, un kg manual...).
 *  Espejo de TaraDetalle en shared/types/ticket-pesaje.ts. */
export const taraDetalleSchema = z.object({
  tipo: z.enum(['tabla', 'manual']),
  taraId: z.string().uuid('Tara inválida.').optional().nullable(),
  nombre: z.string().trim().min(1, 'La tara necesita un nombre.').max(120),
  cantidad: z.number().positive('La cantidad de tara debe ser mayor a 0.').optional().nullable(),
  kg: z.number().nonnegative('Los kg de una tara no pueden ser negativos.'),
});

/** Desglose opcional: omitido, null o vacío = sin desglose (solo la tara total). */
export const tarasDetalleSchema = z
  .array(taraDetalleSchema)
  .max(MAX_TARAS_POR_MATERIAL, `Máximo ${MAX_TARAS_POR_MATERIAL} taras por material.`)
  .optional()
  .nullable()
  .transform(v => (v && v.length > 0 ? v : null));

export type TaraDetalleInput = z.infer<typeof taraDetalleSchema>;

export interface TaraDetallePublico {
  tipo: 'tabla' | 'manual';
  taraId?: string;
  nombre: string;
  cantidad?: number;
  kg: number;
}

/** Suma de kg del desglose (redondeada a gramos). */
export function sumaTarasDetalle(detalle: ReadonlyArray<{ kg: number }>): number {
  return redondearKg(detalle.reduce((acc, t) => acc + t.kg, 0));
}

/** true si no hay desglose o su suma coincide con la tara total (±0.005 kg). */
export function desgloseTaraCoincide(detalle: ReadonlyArray<{ kg: number }> | null | undefined, taraTotal: number): boolean {
  if (!detalle || detalle.length === 0) return true;
  return Math.abs(sumaTarasDetalle(detalle) - taraTotal) <= TOLERANCIA_TARAS_KG + 1e-9;
}

/** Formato que guarda la BD (snake_case, sin claves vacías) dentro de p_materiales. */
export function tarasDetalleARpc(detalle: ReadonlyArray<TaraDetalleInput> | null | undefined) {
  if (!detalle || detalle.length === 0) return null;
  return detalle.map(t => ({
    tipo: t.tipo,
    ...(t.taraId ? { tara_id: t.taraId } : {}),
    nombre: t.nombre,
    ...(t.cantidad != null ? { cantidad: t.cantidad } : {}),
    kg: redondearKg(t.kg),
  }));
}

/** Lee el jsonb de la BD de forma tolerante: columna ausente, null o con
 *  formato inesperado devuelve null (el ticket se ve como antes, sin desglose). */
export function tarasDetalleDesdeBd(raw: unknown): TaraDetallePublico[] | null {
  if (!Array.isArray(raw)) return null;
  const lista: TaraDetallePublico[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const r = el as Record<string, unknown>;
    const kg = Number(r.kg);
    if (typeof r.nombre !== 'string' || !Number.isFinite(kg)) continue;
    lista.push({
      tipo: r.tipo === 'tabla' ? 'tabla' : 'manual',
      ...(typeof r.tara_id === 'string' ? { taraId: r.tara_id } : {}),
      nombre: r.nombre,
      ...(r.cantidad != null && Number.isFinite(Number(r.cantidad)) ? { cantidad: Number(r.cantidad) } : {}),
      kg,
    });
  }
  return lista.length > 0 ? lista : null;
}

/** 'Saca ×2 = 1,20 kg · Cesta = 0,50 kg'. Duplicado de describirTarasDetalle en
 *  shared/types/ticket-pesaje.ts (el backend no importa shared en runtime). */
export function describirTarasDetalle(detalle: ReadonlyArray<TaraDetallePublico> | null | undefined, fmtKg: (kg: number) => string): string {
  return (detalle ?? [])
    .map(t => `${t.nombre}${t.tipo === 'tabla' && (t.cantidad ?? 1) !== 1 ? ` ×${t.cantidad}` : ''} = ${fmtKg(t.kg)} kg`)
    .join(' · ');
}
