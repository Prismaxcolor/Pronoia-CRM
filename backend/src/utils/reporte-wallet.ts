/**
 * Cálculo puro de los reportes de Wallet (sin BD):
 *  - por categorías: ingresos, egresos y total por categoría y subcategoría, separados por moneda;
 *  - de una cuenta: movimientos con lo que entra y sale de ella.
 * Nunca se mezclan monedas en un total. Todo devuelve valores nuevos.
 */
import { bancaPermitida, tieneExtremoOculto, TEXTO_CUENTA_RESTRINGIDA, type BancasPermitidas } from './banca-acceso.js';
import { nombreCompletoCategoria, type CategoriaFila } from './categoria-wallet.js';

export interface MovimientoReporte {
  id: string;
  tipo: 'ingreso' | 'egreso' | 'transferencia';
  subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
  numero: number | null;
  numeroSistema: number | null;
  monto: number;
  moneda: string;
  montoDestino: number | null;
  fecha: string;
  descripcion: string;
  referencia: string;
  bancaOrigenId: string;
  bancaDestinoId: string | null;
  categoriaId: string | null;
  anulado: boolean;
  mesaCambistaId: string | null;
  mesaEstado: 'en_proceso' | 'completada' | null;
}

export interface TotalesMonedaCalculo { moneda: string; ingresos: number; egresos: number; total: number }

export interface SubtotalCalculo {
  categoriaId: string | null;
  nombre: string;
  color: string | null;
  movimientos: number;
  totales: TotalesMonedaCalculo[];
}

export interface GrupoCalculo extends SubtotalCalculo { subcategorias: SubtotalCalculo[] }

export interface ReporteCategoriasCalculo {
  desde: string;
  hasta: string;
  grupos: GrupoCalculo[];
  totalesGenerales: TotalesMonedaCalculo[];
  movimientosExcluidosPorAcceso: number;
}

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const dia = (fecha: string): string => fecha.slice(0, 10);
const porTexto = (a: string, b: string): number => a.localeCompare(b, 'es');
const SIN_CATEGORIA = 'Sin categoría';
const SIN_SUBCATEGORIA = 'Sin subcategoría';

/** Acumulador por moneda: { moneda -> [ingresos, egresos] } (sin redondear hasta el final). */
type Acumulado = ReadonlyMap<string, readonly [number, number]>;

function sumar(acum: Acumulado, m: MovimientoReporte): Acumulado {
  const [ing, egr] = acum.get(m.moneda) ?? [0, 0];
  const nuevo: readonly [number, number] = m.tipo === 'ingreso' ? [ing + m.monto, egr] : [ing, egr + m.monto];
  return new Map(acum).set(m.moneda, nuevo);
}

function totalesDe(acum: Acumulado): TotalesMonedaCalculo[] {
  return [...acum.entries()]
    .sort(([a], [b]) => porTexto(a, b))
    .map(([moneda, [ing, egr]]) => ({ moneda, ingresos: redondear2(ing), egresos: redondear2(egr), total: redondear2(ing - egr) }));
}

function subtotal(movs: readonly MovimientoReporte[], categoriaId: string | null, nombre: string, color: string | null): SubtotalCalculo {
  const acum = movs.reduce<Acumulado>(sumar, new Map());
  return { categoriaId, nombre, color, movimientos: movs.length, totales: totalesDe(acum) };
}

/** Movimientos de ingreso o egreso vigentes dentro del rango (las transferencias no llevan categoría). */
const cuentaParaCategorias = (m: MovimientoReporte, desde: string, hasta: string): boolean =>
  !m.anulado && m.tipo !== 'transferencia' && dia(m.fecha) >= desde && dia(m.fecha) <= hasta;

function grupoDeCategoria(raiz: CategoriaFila, movs: readonly MovimientoReporte[], categorias: readonly CategoriaFila[]): GrupoCalculo {
  const hijas = categorias.filter(c => c.padreId === raiz.id);
  const directos = movs.filter(m => m.categoriaId === raiz.id);
  const subs = hijas
    .map(h => subtotal(movs.filter(m => m.categoriaId === h.id), h.id, h.nombre, h.color))
    .filter(s => s.movimientos > 0)
    .sort((a, b) => porTexto(a.nombre, b.nombre));
  const filas = directos.length > 0 ? [...subs, subtotal(directos, raiz.id, SIN_SUBCATEGORIA, raiz.color)] : subs;
  const propios = subtotal(movs, raiz.id, raiz.nombre, raiz.color);
  return { ...propios, subcategorias: filas };
}

export interface EntradaReporteCategorias {
  movimientos: readonly MovimientoReporte[];
  categorias: readonly CategoriaFila[];
  /** Ids incluidos (ya resueltos con sus subcategorías); null = todas las categorías. */
  seleccion: ReadonlySet<string> | null;
  incluirSinCategoria: boolean;
  permitidas: BancasPermitidas;
  desde: string;
  hasta: string;
}

export function construirReporteCategorias(e: EntradaReporteCategorias): ReporteCategoriasCalculo {
  const enRango = e.movimientos.filter(m => cuentaParaCategorias(m, e.desde, e.hasta));
  const visibles = enRango.filter(m => bancaPermitida(e.permitidas, m.bancaOrigenId));
  const incluidos = visibles.filter(m =>
    m.categoriaId === null ? e.incluirSinCategoria : e.seleccion === null || e.seleccion.has(m.categoriaId));
  const raizDe = (id: string): CategoriaFila | undefined => {
    const c = e.categorias.find(x => x.id === id);
    return c?.padreId ? e.categorias.find(x => x.id === c.padreId) : c;
  };
  const porRaiz = new Map<string, MovimientoReporte[]>();
  for (const m of incluidos) {
    const raiz = m.categoriaId ? raizDe(m.categoriaId) : undefined;
    if (raiz) porRaiz.set(raiz.id, [...(porRaiz.get(raiz.id) ?? []), m]);
  }
  const grupos = [...porRaiz.entries()]
    .map(([id, movs]) => grupoDeCategoria(e.categorias.find(c => c.id === id)!, movs, e.categorias))
    .sort((a, b) => porTexto(a.nombre, b.nombre));
  const sin = incluidos.filter(m => m.categoriaId === null);
  const todos: GrupoCalculo[] = sin.length > 0 ? [...grupos, { ...subtotal(sin, null, SIN_CATEGORIA, null), subcategorias: [] }] : grupos;
  return {
    desde: e.desde,
    hasta: e.hasta,
    grupos: todos,
    totalesGenerales: totalesDe(incluidos.reduce<Acumulado>(sumar, new Map())),
    movimientosExcluidosPorAcceso: enRango.length - visibles.length,
  };
}

// ---------------------------------------------------------------------------
// Reporte de una cuenta
// ---------------------------------------------------------------------------

export interface FilaCuentaCalculo {
  id: string;
  fecha: string;
  tipo: MovimientoReporte['tipo'];
  subtipo: MovimientoReporte['subtipo'];
  numero: number | null;
  numeroSistema: number | null;
  descripcion: string;
  referencia: string;
  cuentaContraria: string | null;
  categoriaId: string | null;
  /** Nombre ("Categoría › Subcategoría") y color de la categoría, listos para imprimir. */
  categoria: { nombre: string; color: string } | null;
  entrada: number;
  salida: number;
  anulado: boolean;
  enProceso: boolean;
}

export interface ReporteCuentaCalculo {
  filas: FilaCuentaCalculo[];
  totales: { entradas: number; salidas: number; neto: number };
}

export interface EntradaReporteCuenta {
  bancaId: string;
  movimientos: readonly MovimientoReporte[];
  categorias: readonly CategoriaFila[];
  nombresBancas: ReadonlyMap<string, string>;
  permitidas: BancasPermitidas;
}

/** Lo que entra y sale de la cuenta por un movimiento (una transferencia con mesa en proceso aún no acredita al destino). */
function montosEnCuenta(m: MovimientoReporte, bancaId: string): { entrada: number; salida: number; enProceso: boolean } {
  if (m.tipo === 'ingreso') return { entrada: m.monto, salida: 0, enProceso: false };
  if (m.tipo === 'egreso') return { entrada: 0, salida: m.monto, enProceso: false };
  if (m.bancaOrigenId === bancaId) return { entrada: 0, salida: m.monto, enProceso: false };
  const enProceso = m.mesaCambistaId !== null && m.mesaEstado === 'en_proceso';
  return { entrada: enProceso ? 0 : (m.montoDestino ?? m.monto), salida: 0, enProceso };
}

function cuentaContraria(m: MovimientoReporte, e: EntradaReporteCuenta): string | null {
  if (m.tipo !== 'transferencia') return null;
  const otra = m.bancaOrigenId === e.bancaId ? m.bancaDestinoId : m.bancaOrigenId;
  if (!otra) return null;
  return bancaPermitida(e.permitidas, otra) ? (e.nombresBancas.get(otra) ?? 'Cuenta desconocida') : TEXTO_CUENTA_RESTRINGIDA;
}

function categoriaImprimible(id: string | null, categorias: readonly CategoriaFila[]): FilaCuentaCalculo['categoria'] {
  const nombre = nombreCompletoCategoria(id, categorias);
  const color = categorias.find(c => c.id === id)?.color;
  return nombre && color ? { nombre, color } : null;
}

function filaDeCuenta(m: MovimientoReporte, e: EntradaReporteCuenta): FilaCuentaCalculo {
  // Con la cuenta contraria fuera del acceso, descripción y referencia podrían nombrarla: se enmascaran.
  const oculta = tieneExtremoOculto(e.permitidas, m);
  return {
    id: m.id, fecha: dia(m.fecha), tipo: m.tipo, subtipo: m.subtipo, numero: m.numero, numeroSistema: m.numeroSistema,
    descripcion: oculta ? TEXTO_CUENTA_RESTRINGIDA : m.descripcion, referencia: oculta ? TEXTO_CUENTA_RESTRINGIDA : m.referencia, cuentaContraria: cuentaContraria(m, e),
    categoriaId: m.categoriaId, categoria: categoriaImprimible(m.categoriaId, e.categorias),
    anulado: m.anulado, ...montosEnCuenta(m, e.bancaId),
  };
}

const claveOrden = (f: FilaCuentaCalculo): number => f.numeroSistema ?? f.numero ?? 0;

export function construirReporteCuenta(e: EntradaReporteCuenta): ReporteCuentaCalculo {
  const filas = e.movimientos
    .map(m => filaDeCuenta(m, e))
    .sort((a, b) => porTexto(a.fecha, b.fecha) || claveOrden(a) - claveOrden(b));
  const vigentes = filas.filter(f => !f.anulado);
  const entradas = redondear2(vigentes.reduce((s, f) => s + f.entrada, 0));
  const salidas = redondear2(vigentes.reduce((s, f) => s + f.salida, 0));
  return { filas, totales: { entradas, salidas, neto: redondear2(entradas - salidas) } };
}
