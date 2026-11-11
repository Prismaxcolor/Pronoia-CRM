/** Lógica pura de la pestaña Gastos: agrupaciones alternativas (subcategoría, cuenta, proveedor/cliente), destino de cada fila
 *  y tendencia de gastos por tipo (pago / adelanto / otros). Se prueba en backend/tests/wallet-estadisticas-gastos.test.ts. */

import type { Banca, CategoriaWallet } from '@shared/types/index.js';
import { PALETA_BANCAS } from '../../../lib/color-banca';
import { rutaRegistros } from './estadisticas-enlaces';
import { agruparPorCategoria, redondear2, serieFlujo, COLOR_SIN_CATEGORIA, type FilaCategoria, type Granularidad, type MovUsd, type PuntoFlujo } from './estadisticas-logica';
import { colorDeCuenta } from './estadisticas-saldos';
import type { ClavePeriodo, RangoFechas } from '../wallet-periodos';

export type VistaGastos = 'total' | 'tipo';

/** Clave de la fila "Sin categoría" (la fija agruparPorCategoria) y sufijo de la fila "X (sin subcategoría)". */
const CLAVE_SIN_CATEGORIA_FILA = 'sin';
const SUFIJO_GASTO_DIRECTO = ':directo';

export type Agrupacion = 'categoria' | 'subcategoria' | 'cuenta' | 'contraparte';

export const AGRUPACIONES: ReadonlyArray<{ valor: Agrupacion; etiqueta: string; /** Para el título: "Gastos por …". */ sustantivo: string }> = [
  { valor: 'categoria', etiqueta: 'Categorías', sustantivo: 'categoría' },
  { valor: 'subcategoria', etiqueta: 'Subcategorías', sustantivo: 'subcategoría' },
  { valor: 'cuenta', etiqueta: 'Cuentas', sustantivo: 'cuenta' },
  { valor: 'contraparte', etiqueta: 'Proveedor/Cliente', sustantivo: 'proveedor o cliente' },
];

export const sustantivoAgrupacion = (a: Agrupacion): string => AGRUPACIONES.find(x => x.valor === a)?.sustantivo ?? '';

const masGrande = (a: FilaCategoria, b: FilaCategoria): number => b.usd - a.usd || a.nombre.localeCompare(b.nombre, 'es');

/** Subcategorías al mismo nivel: cada categoría con subcategorías se reemplaza por ellas; las que no tienen quedan tal cual. */
export function aplanarSubcategorias(filas: readonly FilaCategoria[]): FilaCategoria[] {
  return filas.flatMap(f => (f.hijas.length > 0 ? f.hijas : [f])).sort(masGrande);
}

/** Cuentas que recibieron el gasto, de mayor a menor. El color es el propio de la cuenta (o el de su grupo). */
export function agruparPorCuenta(items: readonly MovUsd[], bancas: readonly Banca[]): FilaCategoria[] {
  const porId = new Map(bancas.map(b => [b.id, b]));
  const acum = new Map<string, FilaCategoria>();
  for (const it of items) {
    const banca = porId.get(it.bancaId);
    const previa = acum.get(it.bancaId) ?? {
      id: it.bancaId, clave: it.bancaId, nombre: banca?.nombre ?? 'Cuenta archivada u oculta', color: banca ? colorDeCuenta(banca) : COLOR_SIN_CATEGORIA,
      usd: 0, cantidad: 0, hijas: [], variacion: null,
      ...(banca?.imagenUrl ? { imagenUrl: banca.imagenUrl } : {}),
    };
    acum.set(it.bancaId, { ...previa, usd: previa.usd + it.usd, cantidad: previa.cantidad + 1 });
  }
  return [...acum.values()].map(f => ({ ...f, usd: redondear2(f.usd) })).sort(masGrande);
}

export const CLAVE_SIN_CONTRAPARTE = 'sin-contraparte';
export const NOMBRE_SIN_CONTRAPARTE = 'Sin proveedor ni cliente';
/** Nombre que se usa cuando la persona no puede ver los nombres de proveedores/clientes. */
export const NOMBRE_CONTRAPARTE_GENERICO = 'Proveedor';
export const NOMBRE_CLIENTE_GENERICO = 'Cliente';

/** Por proveedor (o cliente). `nombreDe` devuelve null si el nombre no está disponible (sin permiso, no cargó o falló): entonces
 *  se muestra "Proveedor" o "Cliente" según corresponda (numerado por rol si hay varios) y la agrupación sigue siendo por id. */
export function agruparPorContraparte(items: readonly MovUsd[], nombreDe: (id: string) => string | null): FilaCategoria[] {
  const acum = new Map<string, FilaCategoria>();
  const roles = new Map<string, string>();
  for (const it of items) {
    const id = it.proveedorId ?? it.clienteId;
    const clave = id ?? CLAVE_SIN_CONTRAPARTE;
    if (id) roles.set(id, it.proveedorId ? NOMBRE_CONTRAPARTE_GENERICO : NOMBRE_CLIENTE_GENERICO);
    const previa = acum.get(clave) ?? { id, clave, nombre: id ? nombreDe(id) ?? '' : NOMBRE_SIN_CONTRAPARTE, color: COLOR_SIN_CATEGORIA, usd: 0, cantidad: 0, hijas: [], variacion: null };
    acum.set(clave, { ...previa, usd: previa.usd + it.usd, cantidad: previa.cantidad + 1 });
  }
  const filas = [...acum.values()].map(f => ({ ...f, usd: redondear2(f.usd) })).sort((a, b) => b.usd - a.usd);
  const rolDe = (f: FilaCategoria): string => (f.id ? roles.get(f.id) ?? NOMBRE_CONTRAPARTE_GENERICO : '');
  const sinNombre = filas.filter(f => f.nombre === '');
  return filas.map((f, i) => {
    const rol = rolDe(f);
    const delRol = sinNombre.filter(x => rolDe(x) === rol);
    const nombre = f.nombre !== '' ? f.nombre : delRol.length > 1 ? `${rol} ${delRol.indexOf(f) + 1}` : rol;
    return { ...f, nombre, color: f.id ? PALETA_BANCAS[i % PALETA_BANCAS.length].hex : COLOR_SIN_CATEGORIA };
  });
}

export interface EntradaAgrupacion {
  egresos: readonly MovUsd[];
  indiceCategorias: ReadonlyMap<string, CategoriaWallet>;
  bancas: readonly Banca[];
  nombreContraparte: (id: string) => string | null;
}

/** Filas de gasto según la agrupación elegida. */
export function filasDeAgrupacion(a: Agrupacion, e: EntradaAgrupacion): FilaCategoria[] {
  switch (a) {
    case 'categoria': return agruparPorCategoria(e.egresos, e.indiceCategorias);
    case 'subcategoria': return aplanarSubcategorias(agruparPorCategoria(e.egresos, e.indiceCategorias));
    case 'cuenta': return agruparPorCuenta(e.egresos, e.bancas);
    case 'contraparte': return agruparPorContraparte(e.egresos, e.nombreContraparte);
  }
}

/** A dónde lleva tocar una fila hoja: categoría/subcategoría -> Registros de esa categoría; cuenta -> Registros de esa cuenta;
 *  siempre solo egresos (esta pestaña es de gastos), de modo que "N registros" coincida con las filas de Registros.
 *  "Sin categoría" usa el filtro `cat=sin`. Sin destino: proveedor/cliente (Registros no filtra por ellos), "Otra categoría" y
 *  "X (sin subcategoría)" (Registros no puede separar el gasto directo de una categoría de sus subcategorías: abriría de más). */
export function rutaDeFila(a: Agrupacion, fila: Pick<FilaCategoria, 'id'> & { clave?: string }, periodo: ClavePeriodo): string | null {
  if (a === 'contraparte') return null;
  if (a === 'cuenta') return fila.id ? rutaRegistros({ banca: fila.id, tipo: 'egreso', periodo }) : null;
  if (fila.clave === CLAVE_SIN_CATEGORIA_FILA) return rutaRegistros({ cat: 'sin', tipo: 'egreso', periodo });
  if (!fila.id || fila.clave?.endsWith(SUFIJO_GASTO_DIRECTO)) return null;
  return rutaRegistros({ cat: fila.id, tipo: 'egreso', periodo });
}

/** Monto de una fila de gasto. Si la fila ES una cuenta (agrupación por cuenta), respeta el ojo cerrado de esa cuenta; las demás
 *  agrupaciones mezclan cuentas y solo se enmascaran con "ocultar cantidades". */
export function formatearMontoFila(
  a: Agrupacion, fila: Pick<FilaCategoria, 'id' | 'usd'>, fmt: (monto: number) => string, fmtCuenta: (cuentaId: string, monto: number) => string,
): string {
  return a === 'cuenta' && fila.id ? fmtCuenta(fila.id, fila.usd) : fmt(fila.usd);
}

// ---------------------------------------------------------------- tendencia por tipo

export interface PuntoGastoTipo {
  clave: string;
  etiqueta: string;
  pagos: number;
  adelantos: number;
  otros: number;
  total: number;
}

const gastosDeTipo = (egresos: readonly MovUsd[], quien: 'pago' | 'adelanto' | 'otros'): MovUsd[] =>
  egresos.filter(e => (quien === 'otros' ? e.subtipo !== 'pago' && e.subtipo !== 'adelanto' : e.subtipo === quien));

/** Gastos por tramo separados en pagos, adelantos y otros egresos. El total de cada tramo es la suma de las tres partes. */
export function serieGastosPorTipo(rango: RangoFechas, egresos: readonly MovUsd[], g: Granularidad): PuntoGastoTipo[] {
  const serie = (q: 'pago' | 'adelanto' | 'otros'): PuntoFlujo[] => serieFlujo(rango, { ingresos: [], egresos: gastosDeTipo(egresos, q) }, g);
  const pagos = serie('pago');
  const adelantos = serie('adelanto');
  const otros = serie('otros');
  return pagos.map((p, i) => ({
    clave: p.clave,
    etiqueta: p.etiqueta,
    pagos: p.egresos,
    adelantos: adelantos[i].egresos,
    otros: otros[i].egresos,
    total: redondear2(p.egresos + adelantos[i].egresos + otros[i].egresos),
  }));
}
