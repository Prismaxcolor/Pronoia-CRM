/** Fechas de calendario YYYY-MM-DD (sin hora ni zona). */

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** True si el texto es YYYY-MM-DD y esa fecha existe en el calendario (rechaza 2026-02-31 y 2026-13-45). */
export function esFechaReal(valor: string): boolean {
  if (!FORMATO_FECHA.test(valor)) return false;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export const MENSAJE_FECHA_INEXISTENTE = 'La fecha no existe en el calendario.';
