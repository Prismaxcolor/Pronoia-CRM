/** Normaliza un código para búsqueda: minúsculas y sin separadores. */
export function normalizarCodigo(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * ¿El código coincide con lo que escribió el usuario? Tolerante al formato:
 * "16", "p16" y "pesaje16" encuentran todos a "Pesaje-0016". Query vacío
 * coincide con todo (sin filtro).
 */
export function coincideCodigo(codigo: string | null | undefined, query: string): boolean {
  const q = normalizarCodigo(query);
  if (!q) return true;
  if (!codigo) return false;
  return normalizarCodigo(codigo).includes(q);
}
