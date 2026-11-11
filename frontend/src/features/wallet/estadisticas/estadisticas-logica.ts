/** Lógica pura de Estadísticas de la Wallet nueva: flujo de caja, categorías, top de gastos y tabla de efectivo (USD).
 *  Reglas de datos: se excluyen los movimientos anulados; las transferencias NO son ingreso ni gasto (su comisión sí cuenta
 *  porque el sistema la guarda como un egreso aparte); lo que no tiene equivalente en USD no se suma, se cuenta aparte.
 *  Se prueba en backend/tests/wallet-estadisticas.test.ts. Saldos y activos: estadisticas-saldos.ts. */

import type { CategoriaWallet, Movimiento } from '@shared/types/index.js';
import { diaDe, lunesDeSemana, montoUsdDe } from '../../../lib/cochinito-kpis';
import { variacionPct } from '../../../lib/graficas';
import { formatearFechaCorta } from '../../../lib/formato';
import type { RangoFechas } from '../wallet-periodos';

export const variacion = variacionPct;

export const COLOR_SIN_CATEGORIA = '#6B7280';
const DIA_MS = 86400000;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** Hasta cuántos días se dibuja un punto por día; hasta MAX_DIAS_SEMANAL, por semana; más allá, por mes. */
const MAX_DIAS_DIARIO = 31;
const MAX_DIAS_SEMANAL = 120;

export const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const aFecha = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();
const aIso = (t: number): string => new Date(t).toISOString().slice(0, 10);

export interface MovUsd {
  id: string;
  dia: string;
  usd: number;
  categoriaId: string | null;
  bancaId: string;
  descripcion: string;
  proveedorId: string | null;
  clienteId: string | null;
  /** Pago / adelanto / otro (cobro, anticipo) / null: lo usa la tendencia de gastos "por tipo". */
  subtipo: Movimiento['subtipo'];
}

export interface FlujoPreparado {
  ingresos: MovUsd[];
  egresos: MovUsd[];
  /** Ingresos/egresos del rango que no se pudieron pasar a USD (no entran en ninguna suma). */
  sinEquivalente: number;
  /** De `sinEquivalente`, cuántos son egresos (los que afectan a Gastos). */
  sinEquivalenteEgresos: number;
}

/** Ingresos y egresos vigentes del rango, ya en USD. Devuelve estructuras nuevas; no toca la lista recibida. */
export function prepararFlujo(movimientos: readonly Movimiento[], rango: RangoFechas): FlujoPreparado {
  const ingresos: MovUsd[] = [];
  const egresos: MovUsd[] = [];
  let sinEquivalente = 0;
  let sinEquivalenteEgresos = 0;
  for (const m of movimientos) {
    if (m.anulado || (m.tipo !== 'ingreso' && m.tipo !== 'egreso')) continue;
    const dia = diaDe(m);
    if (!dia || dia < rango.desde || dia > rango.hasta) continue;
    const usd = montoUsdDe(m);
    if (usd === null) { sinEquivalente += 1; if (m.tipo === 'egreso') sinEquivalenteEgresos += 1; continue; }
    const fila: MovUsd = {
      id: m.id, dia, usd, categoriaId: m.categoriaId ?? null, bancaId: m.bancaOrigenId, descripcion: m.descripcion,
      proveedorId: m.proveedorId ?? null, clienteId: m.clienteId ?? null, subtipo: m.subtipo ?? null,
    };
    (m.tipo === 'ingreso' ? ingresos : egresos).push(fila);
  }
  return { ingresos, egresos, sinEquivalente, sinEquivalenteEgresos };
}

export const sumarUsd = (items: readonly MovUsd[]): number => redondear2(items.reduce((s, i) => s + i.usd, 0));

export interface TotalesFlujo {
  ingresos: number;
  egresos: number;
  neto: number;
  cantidadIngresos: number;
  cantidadEgresos: number;
}

export function totalesFlujo(p: Pick<FlujoPreparado, 'ingresos' | 'egresos'>): TotalesFlujo {
  const ingresos = sumarUsd(p.ingresos);
  const egresos = sumarUsd(p.egresos);
  return { ingresos, egresos, neto: redondear2(ingresos - egresos), cantidadIngresos: p.ingresos.length, cantidadEgresos: p.egresos.length };
}

/** Días del rango, ambos extremos incluidos. */
export function diasEnRango(rango: RangoFechas): number {
  return Math.round((aFecha(rango.hasta) - aFecha(rango.desde)) / DIA_MS) + 1;
}

export type Granularidad = 'dia' | 'semana' | 'mes';

export function granularidadPara(rango: RangoFechas): Granularidad {
  const dias = diasEnRango(rango);
  return dias <= MAX_DIAS_DIARIO ? 'dia' : dias <= MAX_DIAS_SEMANAL ? 'semana' : 'mes';
}

export interface PuntoFlujo {
  /** Inicio del tramo: día, lunes o "AAAA-MM". */
  clave: string;
  etiqueta: string;
  ingresos: number;
  egresos: number;
  neto: number;
  /** Neto acumulado desde el inicio del rango hasta este tramo. */
  acumulado: number;
}

const claveDe = (dia: string, g: Granularidad): string => (g === 'dia' ? dia : g === 'semana' ? lunesDeSemana(dia) : dia.slice(0, 7));

function etiquetaDe(clave: string, g: Granularidad): string {
  if (g !== 'mes') return formatearFechaCorta(clave);
  const [anio, mes] = clave.split('-');
  return `${MESES[Number(mes) - 1]} ${anio.slice(2)}`;
}

/** Serie de flujo por día, semana o mes, rellenando los tramos vacíos del rango para que el eje sea continuo. */
export function serieFlujo(rango: RangoFechas, p: Pick<FlujoPreparado, 'ingresos' | 'egresos'>, g: Granularidad): PuntoFlujo[] {
  const claves: string[] = [];
  for (let t = aFecha(rango.desde); t <= aFecha(rango.hasta); t += DIA_MS) {
    const c = claveDe(aIso(t), g);
    if (claves[claves.length - 1] !== c) claves.push(c);
  }
  const ing = new Map<string, number>();
  const egr = new Map<string, number>();
  for (const i of p.ingresos) ing.set(claveDe(i.dia, g), (ing.get(claveDe(i.dia, g)) ?? 0) + i.usd);
  for (const e of p.egresos) egr.set(claveDe(e.dia, g), (egr.get(claveDe(e.dia, g)) ?? 0) + e.usd);
  let acumulado = 0;
  return claves.map(clave => {
    const ingresos = redondear2(ing.get(clave) ?? 0);
    const egresos = redondear2(egr.get(clave) ?? 0);
    const neto = redondear2(ingresos - egresos);
    acumulado = redondear2(acumulado + neto);
    return { clave, etiqueta: etiquetaDe(clave, g), ingresos, egresos, neto, acumulado };
  });
}

export interface FilaCategoria {
  /** Id de la categoría; null en "Sin categoría" y "Otra categoría". */
  id: string | null;
  /** Clave estable para comparar contra el período anterior. */
  clave: string;
  nombre: string;
  color: string;
  usd: number;
  cantidad: number;
  hijas: FilaCategoria[];
  /** Imagen (logo) de la categoría, si tiene; complementa al color y al nombre. */
  imagenUrl?: string;
  /** % contra el período anterior; null si no hay base de comparación. */
  variacion: number | null;
}

interface Acumulador { fila: FilaCategoria; directo: number; cantidadDirecta: number; hijas: Map<string, FilaCategoria> }

const filaBase = (clave: string, id: string | null, nombre: string, color: string, imagenUrl?: string | null): FilaCategoria =>
  ({ id, clave, nombre, color, usd: 0, cantidad: 0, hijas: [], variacion: null, ...(imagenUrl ? { imagenUrl } : {}) });

const masGrande = (a: FilaCategoria, b: FilaCategoria): number => b.usd - a.usd || a.nombre.localeCompare(b.nombre, 'es');

function raizDe(id: string | null, indice: ReadonlyMap<string, CategoriaWallet>): { raiz: CategoriaWallet | null; hoja: CategoriaWallet | null; clave: string } {
  if (id === null) return { raiz: null, hoja: null, clave: 'sin' };
  const hoja = indice.get(id);
  if (!hoja) return { raiz: null, hoja: null, clave: 'otra' };
  const raiz = (hoja.padreId ? indice.get(hoja.padreId) : undefined) ?? hoja;
  return { raiz, hoja, clave: raiz.id };
}

/** Agrupa por categoría (con sus subcategorías dentro de `hijas`), de mayor a menor. Sin categoría y categorías
 *  desconocidas van en filas propias: nunca se esconden dentro de otra. */
export function agruparPorCategoria(items: readonly MovUsd[], indice: ReadonlyMap<string, CategoriaWallet>): FilaCategoria[] {
  const grupos = new Map<string, Acumulador>();
  for (const it of items) {
    const { raiz, hoja, clave } = raizDe(it.categoriaId, indice);
    const nombre = raiz?.nombre ?? (clave === 'sin' ? 'Sin categoría' : 'Otra categoría');
    const g = grupos.get(clave) ?? { fila: filaBase(clave, raiz?.id ?? null, nombre, raiz?.color ?? COLOR_SIN_CATEGORIA, raiz?.imagenUrl), directo: 0, cantidadDirecta: 0, hijas: new Map() };
    g.fila = { ...g.fila, usd: g.fila.usd + it.usd, cantidad: g.fila.cantidad + 1 };
    if (hoja && raiz && hoja.id !== raiz.id) {
      const h = g.hijas.get(hoja.id) ?? filaBase(hoja.id, hoja.id, hoja.nombre, hoja.color, hoja.imagenUrl);
      g.hijas.set(hoja.id, { ...h, usd: h.usd + it.usd, cantidad: h.cantidad + 1 });
    } else {
      g.directo += it.usd;
      g.cantidadDirecta += 1;
    }
    grupos.set(clave, g);
  }
  return [...grupos.values()].map(cerrarGrupo).sort(masGrande);
}

function cerrarGrupo(g: Acumulador): FilaCategoria {
  const hijas = [...g.hijas.values()].map(h => ({ ...h, usd: redondear2(h.usd) }));
  if (hijas.length > 0 && g.cantidadDirecta > 0) {
    hijas.push({ ...filaBase(`${g.fila.clave}:directo`, g.fila.id, `${g.fila.nombre} (sin subcategoría)`, g.fila.color, g.fila.imagenUrl), usd: redondear2(g.directo), cantidad: g.cantidadDirecta });
  }
  return { ...g.fila, usd: redondear2(g.fila.usd), hijas: hijas.sort(masGrande) };
}

/** Agrega el % de variación contra las filas del período anterior (null = sin base). */
export function conVariacion(filas: readonly FilaCategoria[], anteriores: readonly FilaCategoria[] | null): FilaCategoria[] {
  const previas = new Map<string, FilaCategoria>();
  const registrar = (f: FilaCategoria): void => { previas.set(f.clave, f); f.hijas.forEach(registrar); };
  anteriores?.forEach(registrar);
  const aplicar = (f: FilaCategoria): FilaCategoria => ({
    ...f,
    variacion: anteriores ? variacionPct(f.usd, previas.get(f.clave)?.usd) : null,
    hijas: f.hijas.map(aplicar),
  });
  return filas.map(aplicar);
}

/** Los `limite` gastos más grandes del período. */
export function topGastos(egresos: readonly MovUsd[], limite: number): MovUsd[] {
  return [...egresos].sort((a, b) => b.usd - a.usd || (a.dia < b.dia ? 1 : -1)).slice(0, limite);
}

export interface FilaEfectivo {
  cantidad: number;
  promedioPorDia: number | null;
  promedioPorRegistro: number | null;
  total: number;
}

/** Fila de la tabla de flujo de efectivo. Sin registros no hay promedios (null), no ceros engañosos. */
export function tablaEfectivo(items: readonly MovUsd[], dias: number): FilaEfectivo {
  const total = sumarUsd(items);
  if (items.length === 0 || dias <= 0) return { cantidad: items.length, promedioPorDia: null, promedioPorRegistro: null, total };
  return { cantidad: items.length, promedioPorDia: redondear2(total / dias), promedioPorRegistro: redondear2(total / items.length), total };
}

/** Título del estado vacío: si hay movimientos excluidos por falta de equivalente no se afirma que "no hay". */
export function tituloVacio(sustantivo: string, excluidos: number): string {
  return excluidos > 0 ? `No hay ${sustantivo} con equivalente en USD en este período` : `No hay ${sustantivo} en este período`;
}

/** "1 registro" / "N registros". */
export const textoRegistros = (n: number): string => `${n} ${n === 1 ? 'registro' : 'registros'}`;
