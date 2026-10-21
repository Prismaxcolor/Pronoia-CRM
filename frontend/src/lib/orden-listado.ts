export type CampoOrden = 'culminacion' | 'inicio' | 'correlativo';
export type SentidoOrden = 'desc' | 'asc';
export interface OrdenListado { campo: CampoOrden; sentido: SentidoOrden }

/** Por defecto: los últimos terminados primero. */
export const ORDEN_POR_DEFECTO: OrdenListado = { campo: 'culminacion', sentido: 'desc' };

export const ETIQUETAS_ORDEN: Record<CampoOrden, string> = {
  culminacion: 'Fecha de culminación',
  inicio: 'Fecha de inicio',
  correlativo: 'N° correlativo',
};

export interface Ordenable {
  numero: number | null;
  createdAt: string;
  completadoEn: string | null;
}

// Los registros sin valor (p. ej. aún no completados) quedan siempre al final,
// sin importar el sentido elegido.
function compararNumeros(a: number | null, b: number | null, sentido: SentidoOrden): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return sentido === 'desc' ? b - a : a - b;
}

function valorCampo(x: Ordenable, campo: CampoOrden): number | null {
  if (campo === 'correlativo') return x.numero;
  const iso = campo === 'culminacion' ? x.completadoEn : x.createdAt;
  return iso ? new Date(iso).getTime() : null;
}

/** Devuelve una copia ordenada; no muta la lista original. */
export function ordenarListado<T>(items: T[], orden: OrdenListado, leer: (x: T) => Ordenable): T[] {
  return [...items].sort((a, b) => {
    const ra = leer(a);
    const rb = leer(b);
    const principal = compararNumeros(valorCampo(ra, orden.campo), valorCampo(rb, orden.campo), orden.sentido);
    if (principal !== 0) return principal;
    // Desempate estable: lo creado más recientemente primero.
    return compararNumeros(valorCampo(ra, 'inicio'), valorCampo(rb, 'inicio'), 'desc');
  });
}
