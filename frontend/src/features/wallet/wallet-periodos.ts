/** Períodos rápidos de la Wallet nueva (7D, 30D, 12S, 6M, 1A). Lógica pura: el "hoy" se pasa de afuera
 *  (fecha UTC a medianoche, como la entrega hoyLocal) para poder probarla. Se prueba en backend/tests/wallet-periodos.test.ts. */

import { periodoAnterior } from '../../lib/cochinito-kpis';
import { esFechaIso } from '../../lib/formato';

export type ClavePeriodo = '7D' | '30D' | '12S' | '6M' | '1A';

export interface DefPeriodo {
  clave: ClavePeriodo;
  etiqueta: string;
  /** Texto de la cabecera de las tarjetas: "ÚLTIMOS 30 DÍAS". */
  titulo: string;
}

export const PERIODOS: readonly DefPeriodo[] = [
  { clave: '7D', etiqueta: '7D', titulo: 'ÚLTIMOS 7 DÍAS' },
  { clave: '30D', etiqueta: '30D', titulo: 'ÚLTIMOS 30 DÍAS' },
  { clave: '12S', etiqueta: '12S', titulo: 'ÚLTIMAS 12 SEMANAS' },
  { clave: '6M', etiqueta: '6M', titulo: 'ÚLTIMOS 6 MESES' },
  { clave: '1A', etiqueta: '1A', titulo: 'ÚLTIMO AÑO' },
];

export const PERIODO_POR_DEFECTO: ClavePeriodo = '30D';

export interface RangoFechas {
  desde: string;
  hasta: string;
}

const DIA_MS = 86400000;
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

/** Resta meses (o años = 12 meses) sin desbordar: el 31 de agosto menos 6 meses es el 28/29 de febrero, no el 3 de marzo. */
function restarMeses(hoy: Date, meses: number): Date {
  const total = hoy.getUTCFullYear() * 12 + hoy.getUTCMonth() - meses;
  const anio = Math.floor(total / 12);
  const mes = total - anio * 12;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(hoy.getUTCDate(), ultimoDia)));
}

/** Rango [desde, hasta] del período que termina hoy (ambos extremos incluidos). */
export function rangoDePeriodo(clave: ClavePeriodo, hoy: Date): RangoFechas {
  const hasta = aIso(hoy);
  switch (clave) {
    case '7D': return { desde: aIso(new Date(hoy.getTime() - 6 * DIA_MS)), hasta };
    case '30D': return { desde: aIso(new Date(hoy.getTime() - 29 * DIA_MS)), hasta };
    case '12S': return { desde: aIso(new Date(hoy.getTime() - 83 * DIA_MS)), hasta };
    case '6M': return { desde: aIso(new Date(restarMeses(hoy, 6).getTime() + DIA_MS)), hasta };
    case '1A': return { desde: aIso(new Date(restarMeses(hoy, 12).getTime() + DIA_MS)), hasta };
  }
}

/** Período inmediatamente anterior, de igual duración (para "vs período anterior"). */
export function rangoPeriodoAnterior(rango: RangoFechas): RangoFechas {
  return periodoAnterior(rango.desde, rango.hasta);
}

/** Mismo período de hace un año: el día final se mueve 12 meses atrás (sin desbordar) y se conserva la cantidad de días,
 *  para que cada día del período actual tenga su par por posición. */
export function rangoMismoPeriodoAnioPasado(rango: RangoFechas): RangoFechas {
  const hasta = restarMeses(new Date(`${rango.hasta}T00:00:00Z`), 12);
  const dias = Math.round((new Date(`${rango.hasta}T00:00:00Z`).getTime() - new Date(`${rango.desde}T00:00:00Z`).getTime()) / DIA_MS);
  return { desde: aIso(new Date(hasta.getTime() - dias * DIA_MS)), hasta: aIso(hasta) };
}

/** Clave válida a partir de un texto (p. ej. un parámetro de la URL); cualquier otra cosa da el período por defecto. */
export function periodoDesdeTexto(valor: string | null | undefined): ClavePeriodo {
  const v = (valor ?? '').toUpperCase();
  return PERIODOS.find(p => p.clave === v)?.clave ?? PERIODO_POR_DEFECTO;
}

export function tituloPeriodo(clave: ClavePeriodo): string {
  return PERIODOS.find(p => p.clave === clave)?.titulo ?? '';
}

// ---------------------------------------------------------------------------
// Extensión para Registros: "Todo" y rango personalizado. Se AGREGA sin tocar lo anterior
// (Estadísticas sigue usando PERIODOS / periodoDesdeTexto con los cinco períodos rápidos).
// ---------------------------------------------------------------------------

export type ClavePeriodoRegistros = ClavePeriodo | 'TODO';

export const PERIODOS_REGISTROS: readonly { clave: ClavePeriodoRegistros; etiqueta: string; titulo: string }[] = [
  ...PERIODOS,
  { clave: 'TODO', etiqueta: 'Todo', titulo: 'TODO EL HISTORIAL' },
];

/** Fecha de inicio de "Todo": anterior a cualquier movimiento real. */
export const DESDE_TODO = '1900-01-01';

export type SeleccionPeriodo =
  | { tipo: 'rapido'; clave: ClavePeriodoRegistros }
  | { tipo: 'personalizado'; rango: RangoFechas };

/** Rango válido: dos fechas AAAA-MM-DD reales y desde <= hasta; si no, null. */
export function rangoPersonalizado(desde: string | null | undefined, hasta: string | null | undefined): RangoFechas | null {
  if (!esFechaIso(desde) || !esFechaIso(hasta) || desde > hasta) return null;
  return { desde, hasta };
}

/** Selección de período a partir de los parámetros de la URL: un rango válido manda sobre `p`; `p` desconocido da 30D. */
export function seleccionDePeriodo(valores: { p?: string; desde?: string; hasta?: string }): SeleccionPeriodo {
  const rango = rangoPersonalizado(valores.desde, valores.hasta);
  if (rango) return { tipo: 'personalizado', rango };
  const v = (valores.p ?? '').toUpperCase();
  const clave = PERIODOS_REGISTROS.find(p => p.clave === v)?.clave ?? PERIODO_POR_DEFECTO;
  return { tipo: 'rapido', clave };
}

/** Rango y título de una selección. "Todo" va de DESDE_TODO a hoy. */
export function resolverSeleccionPeriodo(sel: SeleccionPeriodo, hoy: Date): { rango: RangoFechas; titulo: string } {
  if (sel.tipo === 'personalizado') return { rango: sel.rango, titulo: 'PERÍODO PERSONALIZADO' };
  if (sel.clave === 'TODO') return { rango: { desde: DESDE_TODO, hasta: aIso(hoy) }, titulo: 'TODO EL HISTORIAL' };
  return { rango: rangoDePeriodo(sel.clave, hoy), titulo: tituloPeriodo(sel.clave) };
}
