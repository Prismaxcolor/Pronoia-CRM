/** Lógica pura del editor de "Precio estimado de venta de los lotes" (Métricas). Sin React ni DOM para poder
 *  probarla desde backend/tests. El precio es USD por kg, aproximado y de VENTA: nunca se suma al costo. */
import type { ClaseLote } from '../../../shared/types/lote';

export interface LotePrecio {
  id: string;
  nombre: string;
  clase: ClaseLote;
  stockKg: number;
  precioEstimadoKg: number | null;
  actualizadoEn: string | null;
}

/** Texto escrito por la persona, por id de lote. Solo guarda las filas que difieren del precio guardado. */
export type EdicionesPrecio = Readonly<Record<string, string>>;

export type PrecioParseado = { ok: true; valor: number | null } | { ok: false; motivo: string };

const MOTIVO_INVALIDO = 'Escribe un número mayor o igual a 0 (por ejemplo 1,25), o deja vacío para quitar el precio.';

/** "" = quitar el precio (null). Acepta coma o punto decimal. Rechaza negativos, texto y valores no finitos. */
export function parsearPrecio(texto: string): PrecioParseado {
  const limpio = texto.trim();
  if (limpio === '') return { ok: true, valor: null };
  if (!/^\d+([.,]\d+)?$/.test(limpio)) return { ok: false, motivo: MOTIVO_INVALIDO };
  const n = Number(limpio.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { ok: false, motivo: MOTIVO_INVALIDO };
  return { ok: true, valor: n };
}

export const textoDePrecio = (precio: number | null): string => (precio == null ? '' : String(precio).replace('.', ','));

const iguales = (a: number | null, b: number | null) => a === b || (a != null && b != null && Math.abs(a - b) < 1e-9);

/** Devuelve nuevas ediciones con el texto de un lote; si coincide con lo guardado, la fila deja de contar como modificada. */
export function conEdicion(ediciones: EdicionesPrecio, lote: LotePrecio, texto: string): EdicionesPrecio {
  const resto = Object.fromEntries(Object.entries(ediciones).filter(([id]) => id !== lote.id));
  const p = parsearPrecio(texto);
  if (p.ok && iguales(p.valor, lote.precioEstimadoKg)) return resto;
  return { ...resto, [lote.id]: texto };
}

/** Precio efectivo de un lote (editado válido o guardado). Un texto inválido no cuenta: se usa el guardado. */
export function precioEfectivo(lote: LotePrecio, ediciones: EdicionesPrecio): number | null {
  const t = ediciones[lote.id];
  if (t === undefined) return lote.precioEstimadoKg;
  const p = parsearPrecio(t);
  return p.ok ? p.valor : lote.precioEstimadoKg;
}

/** kg × precio por kg, o null si no hay precio. Un stock negativo no resta valor (se toma 0). */
export function valorEstimado(stockKg: number, precio: number | null): number | null {
  if (precio == null) return null;
  return Math.max(0, stockKg) * precio;
}

export function totalEstimado(lotes: readonly LotePrecio[], ediciones: EdicionesPrecio): { total: number; conPrecio: number; sinPrecio: number } {
  let total = 0, conPrecio = 0, sinPrecio = 0;
  for (const l of lotes) {
    const v = valorEstimado(l.stockKg, precioEfectivo(l, ediciones));
    if (v == null) sinPrecio += 1; else { total += v; conPrecio += 1; }
  }
  return { total, conPrecio, sinPrecio };
}

export interface CambioPrecio { id: string; nombre: string; precioEstimadoKg: number | null }

/** Filas modificadas y válidas listas para guardar, más las filas inválidas (bloquean el guardado). */
export function prepararCambios(lotes: readonly LotePrecio[], ediciones: EdicionesPrecio): { cambios: CambioPrecio[]; invalidos: string[] } {
  const cambios: CambioPrecio[] = [];
  const invalidos: string[] = [];
  for (const l of lotes) {
    const t = ediciones[l.id];
    if (t === undefined) continue;
    const p = parsearPrecio(t);
    if (!p.ok) { invalidos.push(l.id); continue; }
    if (!iguales(p.valor, l.precioEstimadoKg)) cambios.push({ id: l.id, nombre: l.nombre, precioEstimadoKg: p.valor });
  }
  return { cambios, invalidos };
}

/** Quita de las ediciones los lotes que ya se guardaron. */
export function sinGuardados(ediciones: EdicionesPrecio, idsGuardados: readonly string[]): EdicionesPrecio {
  const fuera = new Set(idsGuardados);
  return Object.fromEntries(Object.entries(ediciones).filter(([id]) => !fuera.has(id)));
}

/** Descarta ediciones de lotes que ya no están en la lista (borrador viejo). */
export function limpiarEdiciones(ediciones: EdicionesPrecio, lotes: readonly LotePrecio[]): EdicionesPrecio {
  const ids = new Set(lotes.map(l => l.id));
  return Object.fromEntries(Object.entries(ediciones).filter(([id]) => ids.has(id)));
}

/** Orden: exportación primero, luego trabajo, luego otros; dentro, por nombre (numérico natural). */
const ORDEN_CLASE: Record<ClaseLote, number> = { exportacion: 0, trabajo: 1, otro: 2 };
export function ordenarLotes<T extends { clase: ClaseLote; nombre: string }>(lotes: readonly T[]): T[] {
  return [...lotes].sort((a, b) => ORDEN_CLASE[a.clase] - ORDEN_CLASE[b.clase] || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}
