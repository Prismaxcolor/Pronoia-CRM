/** Datos de presentación de los reportes del Wallet (sin React ni jsPDF). Se prueba en backend/tests/reporte-wallet-datos.test.ts. */

import type { CategoriaWallet, FilaReporteCuenta, ReporteCategorias, ReporteCuenta, TotalesMoneda } from '@shared/types/index.js';
import { nombreArchivoDocumento } from '../../../lib/nombre-archivo';
import { etiquetaCategoria } from './categorias-logica';
import { correlativoCoincide } from '../../../lib/correlativo-busqueda';
import { numeroMovimiento } from '../detalle-movimiento';

export const etiquetaMoneda = (moneda: string): string => (moneda === 'VES' ? 'Bs' : moneda);

/** Monedas con movimientos en el reporte, en orden alfabético (USD antes que VES). */
export function monedasDelReporte(r: ReporteCategorias): string[] {
  return r.totalesGenerales.map(t => t.moneda).sort((a, b) => a.localeCompare(b));
}

export interface FilaTablaCategoria {
  /** 0 = categoría, 1 = subcategoría. */
  nivel: 0 | 1;
  nombre: string;
  color: string | null;
  ingresos: number;
  egresos: number;
  total: number;
}

const deMoneda = (totales: readonly TotalesMoneda[], moneda: string): TotalesMoneda | undefined => totales.find(t => t.moneda === moneda);

const aFila = (nivel: 0 | 1, nombre: string, color: string | null, t: TotalesMoneda): FilaTablaCategoria =>
  ({ nivel, nombre, color, ingresos: t.ingresos, egresos: t.egresos, total: t.total });

/** Filas (categoría y sus subcategorías) con los importes de UNA moneda; las que no tienen movimientos en ella se omiten. */
export function filasPorMoneda(r: ReporteCategorias, moneda: string): FilaTablaCategoria[] {
  return r.grupos.flatMap(g => {
    const total = deMoneda(g.totales, moneda);
    if (!total) return [];
    const subs = g.subcategorias.flatMap(s => {
      const ts = deMoneda(s.totales, moneda);
      return ts ? [aFila(1, s.nombre, s.color, ts)] : [];
    });
    return [aFila(0, g.nombre, g.color, total), ...subs];
  });
}

export function totalGeneral(r: ReporteCategorias, moneda: string): TotalesMoneda {
  return deMoneda(r.totalesGenerales, moneda) ?? { moneda, ingresos: 0, egresos: 0, total: 0 };
}

const ETIQUETA_TIPO = { ingreso: 'Ingreso', egreso: 'Egreso', transferencia: 'Transferencia' } as const;
const ETIQUETA_SUBTIPO = { pago: 'Pago', adelanto: 'Adelanto', cobro: 'Cobro', anticipo: 'Anticipo' } as const;

export function textoTipoFila(f: Pick<FilaReporteCuenta, 'tipo' | 'subtipo'>): string {
  return f.subtipo ? `${ETIQUETA_TIPO[f.tipo]} · ${ETIQUETA_SUBTIPO[f.subtipo]}` : ETIQUETA_TIPO[f.tipo];
}

/** Aviso cuando el reporte deja fuera movimientos de cuentas sin acceso; null si no hay ninguno. */
export function textoMovimientosAcceso(n: number): string | null {
  if (n <= 0) return null;
  return `No incluye ${n} ${n === 1 ? 'movimiento' : 'movimientos'} de cuentas a las que no tienes acceso.`;
}

export function nombreArchivoReporte(prefijo: string, entidad: string | null, desde: string, hasta: string): string {
  return nombreArchivoDocumento({ prefijo, codigo: `${desde}-a-${hasta}`, entidad });
}

/** Máximo de días de un reporte (el servidor aplica el mismo límite). */
export const MAX_DIAS_REPORTE = 366;
const MS_POR_DIA = 86_400_000;

/** Mensaje si el rango no sirve para un reporte (falta una fecha, está al revés o es demasiado largo); null si sirve. */
export function mensajeRango(desde: string, hasta: string): string | null {
  if (!desde || !hasta) return 'Elige las fechas "desde" y "hasta".';
  if (desde > hasta) return 'La fecha "desde" no puede ser posterior a "hasta".';
  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_POR_DIA) + 1;
  return dias > MAX_DIAS_REPORTE ? `El reporte puede abarcar como máximo ${MAX_DIAS_REPORTE} días: acorta el periodo.` : null;
}

/** Línea del reporte que dice qué categorías abarca ("Todas las categorías" si no se eligió ninguna). */
export function textoSeleccion(ids: readonly string[], indice: ReadonlyMap<string, CategoriaWallet>, incluirSinCategoria: boolean): string {
  const nombres = ids.map(id => etiquetaCategoria(id, indice)?.nombre).filter((n): n is string => !!n);
  const sin = incluirSinCategoria ? ' y movimientos sin categoría' : '';
  return nombres.length === 0 ? `Todas las categorías${sin}` : `Categorías: ${nombres.join(', ')}${sin}`;
}

/** Máximo de filas por página impresa en los PDF de reportes del Wallet. */
export const FILAS_POR_PAGINA_PDF = 15;

/** Parte una lista en trozos de `tamano` (el último puede ser menor); lista vacía => sin trozos. No modifica la original. */
export function partirEnTrozos<T>(items: readonly T[], tamano: number = FILAS_POR_PAGINA_PDF): T[][] {
  if (!(tamano >= 1)) throw new Error('El tamaño del trozo debe ser al menos 1.');
  const trozos: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) trozos.push(items.slice(i, i + tamano));
  return trozos;
}

/** Filas cuyo correlativo (MV-0001, PG-0003, N000123...) o número contiene el texto; texto vacío => todas. Solo dígitos también compara con el número exacto. */
export function filtrarFilasPorCorrelativo(filas: readonly FilaReporteCuenta[], texto: string): FilaReporteCuenta[] {
  const q = texto.trim().toLowerCase();
  if (q === '') return [...filas];
  const exacto = /^\d+$/.test(q) ? Number(q) : null;
  return filas.filter(f =>
    correlativoCoincide(numeroMovimiento(f), q) ||
    (exacto !== null && (f.numeroSistema === exacto || f.numero === exacto)));
}

/** Totales de entradas, salidas y neto de las filas vigentes (las anuladas no cuentan). */
export function totalesDeFilas(filas: readonly FilaReporteCuenta[]): ReporteCuenta['totales'] {
  const vigentes = filas.filter(f => !f.anulado);
  const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
  const entradas = redondear(vigentes.reduce((s, f) => s + f.entrada, 0));
  const salidas = redondear(vigentes.reduce((s, f) => s + f.salida, 0));
  return { entradas, salidas, neto: redondear(entradas - salidas) };
}

/** Alterna una cuenta en la selección de un reporte (devuelve una lista nueva, no modifica la original). */
export function alternarCuenta(seleccion: readonly string[], id: string): string[] {
  return seleccion.includes(id) ? seleccion.filter(x => x !== id) : [...seleccion, id];
}

/** Reporte de cuenta con solo las filas que coinciden con el correlativo buscado y sus totales recalculados; sin texto, el mismo reporte. */
export function reporteFiltrado(r: ReporteCuenta, texto: string): ReporteCuenta {
  if (texto.trim() === '') return r;
  const filas = filtrarFilasPorCorrelativo(r.filas, texto);
  return { ...r, filas, totales: totalesDeFilas(filas) };
}

export interface FalloCuenta { bancaId: string; error: string }

/** Reparte los resultados de pedir el reporte de varias cuentas (en el mismo orden que `ids`) en los que cargaron y los que fallaron. */
export function separarResultadosCuentas(
  ids: readonly string[],
  resultados: ReadonlyArray<ReporteCuenta | { error: string }>
): { reportes: ReporteCuenta[]; fallos: FalloCuenta[] } {
  const reportes: ReporteCuenta[] = [];
  const fallos: FalloCuenta[] = [];
  resultados.forEach((r, i) => {
    if ('error' in r) fallos.push({ bancaId: ids[i], error: r.error });
    else reportes.push(r);
  });
  return { reportes, fallos };
}

/** Junta reportes ya cargados con los recién cargados (el nuevo reemplaza al de la misma cuenta) en el orden de `ordenIds`. */
export function combinarReportesCuentas(actuales: readonly ReporteCuenta[], nuevos: readonly ReporteCuenta[], ordenIds: readonly string[]): ReporteCuenta[] {
  const porId = new Map([...actuales, ...nuevos].map(r => [r.banca.id, r] as const));
  return ordenIds.flatMap(id => { const r = porId.get(id); return r ? [r] : []; });
}
