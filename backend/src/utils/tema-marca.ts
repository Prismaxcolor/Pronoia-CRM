/**
 * Tema de color por usuario. null = verde corporativo (por defecto).
 * Espejo de la restricción check de public.users.tema_marca.
 */
export const TEMAS_MARCA = ['azul'] as const;
export type TemaMarca = (typeof TEMAS_MARCA)[number];

/** Cualquier valor desconocido (o columna aún inexistente) degrada a null. */
export function normalizarTemaMarca(valor: unknown): TemaMarca | null {
  return TEMAS_MARCA.find((t) => t === valor) ?? null;
}
