/** Fecha y hora en la zona de negocio (Venezuela, America/Caracas, UTC-4 sin horario de verano).
 *  Lógica pura (sin React ni DOM). Hay una copia gemela en frontend/src/lib/fecha-negocio.ts: si cambias una, cambia la otra
 *  (backend/tests/fecha-negocio.test.ts prueba ambas con los mismos casos).
 *
 *  Reglas:
 *  - "AAAA-MM-DD" (columna `date`) es un día de calendario: se muestra tal cual, sin convertir de zona.
 *  - Un instante (timestamptz con Z u offset, o un Date) se convierte SIEMPRE a la zona de negocio, no a la del navegador ni a UTC.
 *  - Formato: dd/mm/aaaa hh:mm en 24 h (el mismo que ya usa el bot de Telegram). */

export const ZONA_NEGOCIO = 'America/Caracas';

const PARTES = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface PartesNegocio {
  anio: string;
  mes: string;
  dia: string;
  hora: string;
  minuto: string;
}

/** Con zona (Z, +00:00, -04:00) → es un instante. */
const INSTANTE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}(:?\d{2})?)$/i;
const SOLO_FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Partes (año, mes, día, hora, minuto) del instante en la zona de negocio. null si no es un instante válido. */
export function partesNegocio(valor: string | Date | null | undefined): PartesNegocio | null {
  let fecha: Date;
  if (valor instanceof Date) fecha = valor;
  else if (typeof valor === 'string' && INSTANTE_RE.test(valor.trim())) fecha = new Date(valor.trim().replace(' ', 'T'));
  else return null;
  if (Number.isNaN(fecha.getTime())) return null;
  const mapa: Record<string, string> = {};
  for (const p of PARTES.formatToParts(fecha)) mapa[p.type] = p.value;
  return { anio: mapa.year, mes: mapa.month, dia: mapa.day, hora: mapa.hour, minuto: mapa.minute };
}

/** Día de calendario "AAAA-MM-DD" de un valor: fecha pura tal cual; instante → día en la zona de negocio. */
export function diaNegocio(valor: string | Date | null | undefined): string | null {
  if (typeof valor === 'string' && SOLO_FECHA_RE.test(valor.slice(0, 10)) && !INSTANTE_RE.test(valor.trim())) return valor.slice(0, 10);
  const p = partesNegocio(valor);
  return p ? `${p.anio}-${p.mes}-${p.dia}` : null;
}

/** "Hoy" (AAAA-MM-DD) en la zona de negocio, no en UTC ni en la del navegador. */
export function hoyNegocio(ahora: Date = new Date()): string {
  return diaNegocio(ahora) as string;
}

/** "07/10/2026" (instante → día en Caracas; fecha pura tal cual). Sin dato: "—". */
export function formatearFechaNegocio(valor: string | Date | null | undefined): string {
  const dia = diaNegocio(valor);
  return dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : '—';
}

/** "14:05" (24 h, Caracas). Una fecha pura no tiene hora: "—". */
export function formatearHoraNegocio(valor: string | Date | null | undefined): string {
  const p = partesNegocio(valor);
  return p ? `${p.hora}:${p.minuto}` : '—';
}

/** "07/10/2026 14:05" (Caracas). Si el valor es solo una fecha (sin hora) devuelve solo "07/10/2026". */
export function formatearFechaHora(valor: string | Date | null | undefined): string {
  const p = partesNegocio(valor);
  if (p) return `${p.dia}/${p.mes}/${p.anio} ${p.hora}:${p.minuto}`;
  return formatearFechaNegocio(valor);
}

/** "Registrado por Ana · 07/10/2026 14:05". Sin nombre: "Registrado por — · …". Sin fecha, solo el nombre. */
export function leyendaRegistro(nombre: string | null | undefined, instante: string | Date | null | undefined, verbo = 'Registrado'): string {
  const quien = nombre?.trim() || '—';
  return instante ? `${verbo} por ${quien} · ${formatearFechaHora(instante)}` : `${verbo} por ${quien}`;
}

/** "Última edición por Ana · 07/10/2026 14:05"; null si nunca se editó. */
export function leyendaUltimaEdicion(nombre: string | null | undefined, instante: string | Date | null | undefined): string | null {
  if (!instante) return null;
  return leyendaRegistro(nombre, instante, 'Última edición');
}

/** Offset fijo de la zona de negocio: Venezuela no tiene horario de verano (UTC-4 todo el año). */
export const OFFSET_NEGOCIO = '-04:00';

/** Primer instante del día de negocio "AAAA-MM-DD", para filtrar columnas timestamptz con gte. */
export function inicioDiaNegocio(dia: string): string {
  return `${dia.slice(0, 10)}T00:00:00.000${OFFSET_NEGOCIO}`;
}

/** Último instante del día de negocio "AAAA-MM-DD", para filtrar columnas timestamptz con lte. */
export function finDiaNegocio(dia: string): string {
  return `${dia.slice(0, 10)}T23:59:59.999${OFFSET_NEGOCIO}`;
}

/** "Ana · 07/10/2026 14:05" para filas "Registrado por" (etiqueta aparte). Sin nombre: "—"; sin instante, solo el nombre. */
export function nombreYMomento(nombre: string | null | undefined, instante: string | Date | null | undefined): string {
  const quien = nombre?.trim() || '—';
  return instante ? `${quien} · ${formatearFechaHora(instante)}` : quien;
}

/** Día de negocio (columna `date`, editable) con la hora en que se registró: "07/10/2026 14:05".
 *  Si el registro se hizo otro día (documento con fecha atrasada), solo el día: la hora no corresponde a esa fecha. */
export function fechaConHora(dia: string | null | undefined, instante: string | Date | null | undefined): string {
  if (!dia) return formatearFechaHora(instante);
  const solo = formatearFechaNegocio(dia);
  return diaNegocio(instante) === dia.slice(0, 10) ? `${solo} ${formatearHoraNegocio(instante)}` : solo;
}
