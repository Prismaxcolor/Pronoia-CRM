/**
 * Merma de transformaciones: lógica pura (sin BD).
 *
 * Misma definición que la UI de transformaciones (TransformacionesPage /
 * TransformacionDetallePage): merma = peso neto de entrada - suma del neto de
 * todas las salidas (materiales sueltos y/o lotes de destino, indistinto).
 * No se guarda nada: el histórico se deriva de las transformaciones completas.
 *
 * Desde el rediseño de inventario cada fila puede traer además la merma
 * tipificada (basura, plástico, ...): ver merma-tipificada.ts.
 */
import { desglosarMerma, type DetalleMerma, type MermaPorTipo } from './merma-tipificada.js';

export type AgrupacionMerma = 'dia' | 'semana' | 'mes';

export interface TransformacionParaMerma {
  id: string;
  numero: number | null;
  codigo: string | null;
  categoria: string;
  /** Fecha operativa de la transformación (YYYY-MM-DD). */
  fecha: string;
  almacenId: string | null;
  productoEntradaId: string | null;
  nombreProductoEntrada: string | null;
  nombreLoteOrigen: string | null;
  entradaDetalle: ReadonlyArray<{ productoId: string }>;
  pesoNeto: number;
  salidas: ReadonlyArray<{ pesoNeto: number }>;
  /** Desglose opcional de la merma por tipo (transformacion_merma_detalle). */
  mermaDetalle?: ReadonlyArray<DetalleMerma>;
}

export interface FilaMerma {
  id: string;
  numero: number | null;
  codigo: string | null;
  categoria: string;
  fecha: string;
  almacenId: string | null;
  /** Producto de entrada, o lote de origen cuando la entrada es un lote (PCB). */
  entrada: string;
  kgEntrada: number;
  kgSalida: number;
  kgMerma: number;
  pctMerma: number;
  /** Merma tipificada por tipo (0 en los tipos no registrados). */
  mermaPorTipo: MermaPorTipo;
  kgTipificado: number;
  /** Merma que nadie clasificó; en transformaciones sin desglose es toda la merma. */
  kgSinClasificar: number;
  /** Kilos tipificados que exceden la merma actual (solo si se editaron pesos después). */
  kgTipificadoExcede: number;
}

export interface ResumenMerma {
  transformaciones: number;
  kgEntrada: number;
  kgSalida: number;
  kgMerma: number;
  pctMerma: number;
}

export interface PeriodoMerma extends ResumenMerma {
  /** Primer día del período (YYYY-MM-DD): el día, el lunes de la semana o el día 1 del mes. */
  periodo: string;
}

const redondear = (n: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};
const kg = (n: number) => redondear(n, 3) + 0; // + 0 evita -0

function pct(merma: number, entrada: number): number {
  return entrada > 0 ? redondear((merma / entrada) * 100, 2) + 0 : 0;
}

export function calcularMerma(
  netoEntrada: number,
  netosSalidas: readonly number[]
): { kgMerma: number; pctMerma: number } {
  const salida = netosSalidas.reduce((a, n) => a + n, 0);
  const merma = kg(netoEntrada - salida);
  return { kgMerma: merma, pctMerma: pct(merma, netoEntrada) };
}

export function claveDePeriodo(fecha: string, agrupar: AgrupacionMerma): string {
  if (agrupar === 'dia') return fecha;
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number);
  if (agrupar === 'mes') return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const fechaUtc = new Date(Date.UTC(y, m - 1, d));
  const diasDesdeLunes = (fechaUtc.getUTCDay() + 6) % 7;
  fechaUtc.setUTCDate(fechaUtc.getUTCDate() - diasDesdeLunes);
  return fechaUtc.toISOString().slice(0, 10);
}

export function construirFilaMerma(t: TransformacionParaMerma): FilaMerma {
  const kgSalida = kg(t.salidas.reduce((a, s) => a + s.pesoNeto, 0));
  const kgEntrada = kg(t.pesoNeto);
  const { kgMerma, pctMerma } = calcularMerma(t.pesoNeto, t.salidas.map(s => s.pesoNeto));
  const desglose = desglosarMerma(kgMerma, t.mermaDetalle ?? []);
  return {
    id: t.id,
    numero: t.numero,
    codigo: t.codigo,
    categoria: t.categoria,
    fecha: t.fecha,
    almacenId: t.almacenId,
    entrada: t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '—',
    kgEntrada,
    kgSalida,
    kgMerma,
    pctMerma,
    mermaPorTipo: desglose.porTipo,
    kgTipificado: desglose.kgTipificado,
    kgSinClasificar: desglose.kgSinClasificar,
    kgTipificadoExcede: desglose.excedeKg,
  };
}

function resumir(filas: readonly FilaMerma[]): ResumenMerma {
  const kgEntrada = kg(filas.reduce((a, f) => a + f.kgEntrada, 0));
  const kgSalida = kg(filas.reduce((a, f) => a + f.kgSalida, 0));
  const kgMerma = kg(kgEntrada - kgSalida);
  return { transformaciones: filas.length, kgEntrada, kgSalida, kgMerma, pctMerma: pct(kgMerma, kgEntrada) };
}

export function resumirMerma(
  filas: readonly FilaMerma[],
  agrupar: AgrupacionMerma
): { periodos: PeriodoMerma[]; totales: ResumenMerma } {
  const grupos = new Map<string, FilaMerma[]>();
  for (const f of filas) {
    const clave = claveDePeriodo(f.fecha, agrupar);
    grupos.set(clave, [...(grupos.get(clave) ?? []), f]);
  }
  const periodos = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, grupo]) => ({ periodo, ...resumir(grupo) }));
  return { periodos, totales: resumir(filas) };
}

/** Producto de entrada directo, o presente en el detalle de entrada (PCB). */
export function filtrarPorProducto<T extends Pick<TransformacionParaMerma, 'productoEntradaId' | 'entradaDetalle'>>(
  ts: readonly T[],
  productoId: string | undefined
): T[] {
  if (!productoId) return [...ts];
  return ts.filter(t => t.productoEntradaId === productoId || t.entradaDetalle.some(d => d.productoId === productoId));
}
