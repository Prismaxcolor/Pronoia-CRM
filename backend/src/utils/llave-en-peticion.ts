/** True si el cuerpo de la petición trae una llave de edición no vacía. */
export function presentaLlave(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const llave = (body as { llaveEdicion?: unknown }).llaveEdicion;
  return typeof llave === 'string' && llave.trim().length > 0;
}
