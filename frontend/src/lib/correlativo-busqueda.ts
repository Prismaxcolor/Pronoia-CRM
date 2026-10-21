/** Búsqueda por correlativo (MV-0012, PG-0003, N000123…) tolerante con ceros y separadores: "mv-12", "MV12" y "mv 12" encuentran MV-0012. Lógica pura. */

const PREFIJO_Y_NUMERO = /^([a-z]{1,3})[\s-]*0*(\d+)$/;

/** ¿La consulta del usuario corresponde a este código? Coincide si lo contiene o si prefijo y número (sin ceros) son iguales. */
export function correlativoCoincide(codigo: string, consulta: string): boolean {
  const q = consulta.trim().toLowerCase();
  const c = codigo.trim().toLowerCase();
  if (q === '' || c === '') return false;
  if (c.includes(q)) return true;
  const buscado = PREFIJO_Y_NUMERO.exec(q);
  const real = PREFIJO_Y_NUMERO.exec(c);
  return buscado !== null && real !== null && buscado[1] === real[1] && buscado[2] === real[2];
}
