/** Lógica pura (sin React) de los bloques de la pantalla nueva de inventario (Fase 3): parámetros de los
 *  endpoints /pantalla/*, vistas, orden/agrupación/totales de la tabla, CSV, alertas y tarjetas.
 *  Los tipos vienen del contrato compartido (shared/types/inventario-pantalla.ts). */

import type {
  AlertaInventario,
  EtapaInventario,
  FilaDetalleInventario,
  SeveridadAlerta,
  TarjetaInventario,
  VistaInventario,
} from '@shared/types/inventario-pantalla.js';
import { VISTA_POR_DEFECTO, formatearNumero, type EtapaFiltro, type FiltrosPantalla, type VistaUrl } from './inventario-nuevo';

// ---------------------------------------------------------------- vistas

export const VISTAS_PRINCIPALES: Array<{ clave: VistaUrl; etiqueta: string; descripcion: string }> = [
  { clave: 'exportacion', etiqueta: 'Exportación', descripcion: 'Lote 1 a Lote 4: lo que se arma, se embala en contenedores y se envía al exterior.' },
  { clave: 'venta_nacional', etiqueta: 'Venta nacional', descripcion: 'Solo Ferroso y No ferroso: material que se vende tal cual en el mercado nacional, sin transformarlo.' },
  { clave: 'trabajo_interno', etiqueta: 'Trabajo interno', descripcion: 'Lotes de trabajo (BGPP, BGYP, PCPP, PCYP, LOTE MPP y otros como PCB LIGADO), Procesadores y desarme RAEE: material que primero se trabaja en casa y ni se exporta ni se vende tal cual.' },
];

export const ETIQUETA_OTRAS = { clave: 'otras' as const, etiqueta: 'Otras', descripcion: 'Lo que no encaja en las otras tres vistas, por ejemplo la Basura.' };

/** Orden fijo de las vistas en la tabla de detalle. */
export const ORDEN_VISTAS: VistaInventario[] = ['exportacion', 'venta_nacional', 'trabajo_interno', 'otras'];
export const etiquetaVista = (v: VistaInventario): string => [...VISTAS_PRINCIPALES, ETIQUETA_OTRAS].find(o => o.clave === v)?.etiqueta ?? v;

export function vistaActiva(f: Pick<FiltrosPantalla, 'vista'>): VistaUrl {
  return f.vista ?? VISTA_POR_DEFECTO;
}

/** Texto del estado vacío de cada vista (siempre explica qué hacer). */
export const MENSAJE_VACIO_VISTA: Record<VistaUrl, { texto: string; enlace?: { ruta: string; etiqueta: string } }> = {
  exportacion: {
    texto: 'Aún no hay kg embalados en lotes de exportación: márcalos en «Próximo contenedor».',
    enlace: { ruta: '#proximo-contenedor', etiqueta: 'Ir a Próximo contenedor' },
  },
  venta_nacional: {
    texto: 'No hay Ferroso ni No ferroso con stock con estos filtros. Se llenan con las compras (pesajes) de esos materiales.',
    enlace: { ruta: '/inventario-legacy?pestana=almacenes', etiqueta: 'Ver almacenes' },
  },
  trabajo_interno: {
    texto: 'No hay lotes de trabajo, Procesadores ni material en desarme con estos filtros. Aparecen al pesar tarjetas a MPP, BGPP, PCPP u otros lotes, o al registrar un desarme.',
    enlace: { ruta: '/transformaciones', etiqueta: 'Registrar transformación' },
  },
  otras: { texto: 'No hay material fuera de las tres vistas principales (por ejemplo, Basura).' },
};

// ---------------------------------------------------------------- parámetros de los endpoints

export const LIMITE_FILAS_INICIAL = 500;
export const LIMITE_FILAS_MAXIMO = 2000;
export const PASOS_LIMITE = [500, 1000, 2000] as const;

export interface OpcionesParametros {
  /** No enviar `categoria` (las tarjetas se quedan completas y solo resaltan la elegida). */
  sinCategoria?: boolean;
  limite?: number;
  incluirClasificaciones?: boolean;
  /** Pide la respuesta sin costos ni precios (`sinValor=1`) aunque el usuario tenga facturacion:ver. /inventario lo envía siempre; Métricas no. */
  sinValor?: boolean;
}

/** Query de /api/inventario/pantalla/*. desde/hasta solo viajan juntos. `etapa`, `proveedor` y `lote` no existen en el
 *  contrato: la etapa se filtra en el cliente y las otras dos no se envían. */
export function parametrosPantalla(f: FiltrosPantalla, op: OpcionesParametros = {}): URLSearchParams {
  const p = new URLSearchParams();
  if (f.desde && f.hasta) {
    p.set('desde', f.desde);
    p.set('hasta', f.hasta);
  }
  if (f.categoria && !op.sinCategoria) p.set('categoria', f.categoria);
  if (f.almacen) p.set('almacen', f.almacen);
  if (f.q) p.set('q', f.q);
  if (op.limite) p.set('limite', String(op.limite));
  if (op.incluirClasificaciones) p.set('incluirClasificaciones', 'true');
  if (op.sinValor) p.set('sinValor', '1');
  return p;
}

/** Clave estable para decidir si hay que volver a pedir (cambia solo si cambia algo que viaja al servidor). */
export function claveParametros(p: URLSearchParams): string {
  return [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
}

// ---------------------------------------------------------------- formato

export const formatearDiasEstimados = (d: number): string => `${formatearNumero(d, 0)} días`;

/** Ya no hay filas «despachado»: lo despachado se ve bajo el nombre como «Último despacho». */
export const ETIQUETA_ETAPA: Record<string, string> = {
  recibido: 'Recibido',
  en_proceso: 'En proceso',
  listo: 'Listo',
};

/** Etapa del filtro de la URL (materia_prima/en_proceso/listo) -> etapa del contrato. */
export const ETAPA_DE_FILTRO: Record<EtapaFiltro, EtapaInventario> = {
  materia_prima: 'recibido',
  en_proceso: 'en_proceso',
  listo: 'listo',
};

// ---------------------------------------------------------------- tarjetas

export type TarjetaVistaFiltrada = TarjetaInventario;

export function tarjetasDeVista(tarjetas: TarjetaInventario[], vista: VistaInventario): TarjetaInventario[] {
  return tarjetas.filter(t => t.vista === vista);
}

export interface SegmentoBarra {
  clave: 'recibido' | 'en_proceso' | 'listo';
  etiqueta: string;
  kg: number;
  /** 0-100; los tres suman 100 (o 0 si no hay kg). */
  pct: number;
}

/** Segmentos de la barra apilada por etapa. Kg negativos o no finitos cuentan como 0. */
export function segmentosEtapas(e: { recibidoKg: number; enProcesoKg: number; listoKg: number }): { segmentos: SegmentoBarra[]; totalKg: number } {
  const limpio = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const kgs = [limpio(e.recibidoKg), limpio(e.enProcesoKg), limpio(e.listoKg)];
  const total = kgs[0] + kgs[1] + kgs[2];
  const claves = ['recibido', 'en_proceso', 'listo'] as const;
  const etiquetas = ['Recibido', 'En proceso', 'Listo'];
  return {
    totalKg: total,
    segmentos: claves.map((clave, i) => ({ clave, etiqueta: etiquetas[i], kg: kgs[i], pct: total > 0 ? (kgs[i] / total) * 100 : 0 })),
  };
}

/** Partes de un desglose (limpio/sucio, recuperable/desecho, por procesar/procesado) con su %; omite las de 0 kg. */
export function partesDesglose(partes: Array<{ clave: string; etiqueta: string; kg: number }>): Array<{ clave: string; etiqueta: string; kg: number; pct: number }> {
  const validas = partes.map(p => ({ ...p, kg: Number.isFinite(p.kg) && p.kg > 0 ? p.kg : 0 }));
  const total = validas.reduce((a, p) => a + p.kg, 0);
  return validas.filter(p => p.kg > 0).map(p => ({ ...p, pct: total > 0 ? (p.kg / total) * 100 : 0 }));
}

// ---------------------------------------------------------------- tabla de detalle

export type ColumnaTabla = 'material' | 'categoria' | 'etapa' | 'kg' | 'dias' | 'ubicacion';
export type SentidoOrden = 'asc' | 'desc';
export interface OrdenTabla { columna: ColumnaTabla; sentido: SentidoOrden }

export const ORDEN_TABLA_POR_DEFECTO: OrdenTabla = { columna: 'kg', sentido: 'desc' };

export interface DefColumna {
  clave: Exclude<ColumnaTabla, 'categoria'>;
  etiqueta: string;
  derecha: boolean;
}

/** Columnas de la tabla, en orden: el kg pegado al nombre. Esta pantalla no muestra dinero (todo lo monetario está en Métricas). */
export const COLUMNAS_TABLA: DefColumna[] = [
  { clave: 'material', etiqueta: 'Material', derecha: false },
  { clave: 'kg', etiqueta: 'Kg', derecha: true },
  { clave: 'etapa', etiqueta: 'Etapa', derecha: false },
  { clave: 'dias', etiqueta: 'Días', derecha: true },
  { clave: 'ubicacion', etiqueta: 'Ubicación', derecha: false },
];

/** Texto de la columna Etapa. La etapa del contrato (recibido/en_proceso/listo) es una agrupación interna:
 *  en lotes con fase o de exportación se muestra el paso real del PCB para no contradecir las insignias. */
const ETAPAS_VISIBLES = ['Recibido', 'Por procesar', 'En proceso', 'Procesado', 'En saca', 'Listo', 'Embalado (Listo)'] as const;
export type EtapaVisible = (typeof ETAPAS_VISIBLES)[number];

export function etapaVisible(f: Pick<FilaDetalleInventario, 'tipo' | 'clase' | 'fase' | 'etapa'>): EtapaVisible {
  if (f.tipo === 'lote') {
    if (f.clase === 'trabajo' && f.fase === 'por_procesar') return 'Por procesar';
    if (f.clase === 'trabajo' && f.fase === 'procesado') return 'Procesado';
    if (f.clase === 'exportacion') return f.etapa === 'listo' ? 'Embalado (Listo)' : 'En saca';
  }
  return (ETIQUETA_ETAPA[f.etapa] ?? 'Recibido') as EtapaVisible;
}

export const EXPLICACION_ETAPAS_PCB = 'En qué paso está cada fila. Lotes de PCB: por procesar (lote de trabajo con material sin tratar) → procesado (ya desarmado o clasificado) → en saca (lote de exportación armado, todavía sin embalar) → embalado (listo para despachar). El resto de los materiales usa Recibido (llegó y no se ha trabajado), En proceso y Listo (disponible para vender o embalado). Lo que ya salió se ve debajo del nombre como «Último despacho».';

const ORDEN_ETAPA = (f: FilaDetalleInventario): number => ETAPAS_VISIBLES.indexOf(etapaVisible(f));

/** Nombre corto del almacén: «Galpón 1» -> «G1», «ALMACEN G2» -> «G2», «Almacén 2» -> «A2»; si no encaja, el mismo nombre. */
export function abreviarAlmacen(nombre: string): string {
  const n = nombre.trim();
  const m = /^(galp[oó]n|almac[eé]n|bodega)\s*#?\s*(\w{1,3})$/i.exec(n);
  if (!m) return n;
  const resto = m[2].toUpperCase();
  return /^G\d+$/.test(resto) ? resto : `${m[1][0].toUpperCase()}${resto}`;
}

/** Almacén con más kg (para ordenar por ubicación) y texto completo "G1 1.200 kg · G2 300 kg". */
export function ubicacionPrincipal(f: FilaDetalleInventario): string {
  if (f.porAlmacen.length === 0) return '';
  return [...f.porAlmacen].sort((a, b) => b.kg - a.kg)[0].almacenNombre;
}
export function textoUbicacion(f: FilaDetalleInventario): string {
  return f.porAlmacen.map(a => `${a.almacenNombre} ${formatearNumero(a.kg, 0)} kg`).join(' · ');
}
/** Ubicación corta para la tabla: «G1» si está en un solo almacén; «G1 1.200 · G2 300» si está repartido. */
export function textoUbicacionCorta(f: FilaDetalleInventario): string {
  if (f.porAlmacen.length === 0) return '';
  if (f.porAlmacen.length === 1) return abreviarAlmacen(f.porAlmacen[0].almacenNombre);
  return f.porAlmacen.map(a => `${abreviarAlmacen(a.almacenNombre)} ${formatearNumero(a.kg, 0)}`).join(' · ');
}

/** Texto gris bajo el nombre: «Último despacho: 03/10/2026 · 1.200 kg». Vacío si nunca se despachó. */
export function textoUltimoDespacho(f: Pick<FilaDetalleInventario, 'ultimoDespacho'>): string {
  const d = f.ultimoDespacho;
  if (!d) return '';
  const [a, m, dia] = d.fecha.slice(0, 10).split('-');
  const fecha = a && m && dia ? `${dia}/${m}/${a}` : d.fecha;
  return `Último despacho: ${fecha} · ${formatearNumero(d.kg, 0)} kg`;
}
/** Texto gris bajo el nombre: «En transformación: 300 kg». Vacío si no hay. */
export function textoEnTransformacion(f: Pick<FilaDetalleInventario, 'kgEnTransformacion'>): string {
  return f.kgEnTransformacion > 0 ? `En transformación: ${formatearNumero(f.kgEnTransformacion, 0)} kg` : '';
}

/** Solo las filas de lote con id se pueden desplegar para ver de qué compras se compone. */
export const esFilaExpandible = (f: Pick<FilaDetalleInventario, 'tipo' | 'loteId'>): boolean => f.tipo === 'lote' && Boolean(f.loteId);

/** Filtros que viajan a la composición de un lote: periodo y almacén activos. */
export function filtrosComposicion(f: Pick<FiltrosPantalla, 'desde' | 'hasta' | 'almacen'>): { desde?: string; hasta?: string; almacenId?: string } {
  return {
    ...(f.desde && f.hasta ? { desde: f.desde, hasta: f.hasta } : {}),
    ...(f.almacen ? { almacenId: f.almacen } : {}),
  };
}

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Filtro de texto instantáneo en el cliente (sin tildes ni mayúsculas, todas las palabras). Sirve mientras llega la respuesta del servidor. */
export function filtrarPorTexto(filas: FilaDetalleInventario[], q: string | undefined): FilaDetalleInventario[] {
  const palabras = sinTildes(q ?? '').split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return filas;
  return filas.filter(f => {
    const texto = sinTildes(`${f.material} ${f.categoria}`);
    return palabras.every(p => texto.includes(p));
  });
}

type ValorOrden = number | string | null;

function valorDeColumna(f: FilaDetalleInventario, c: ColumnaTabla): ValorOrden {
  switch (c) {
    case 'material': return f.material;
    case 'categoria': return f.categoria;
    case 'etapa': return ORDEN_ETAPA(f);
    case 'kg': return f.kg;
    case 'dias': return f.dias ? f.dias.diasPromedio : null;
    case 'ubicacion': return ubicacionPrincipal(f) || null;
  }
}

/** Compara dos valores del mismo tipo; los nulos van SIEMPRE al final, sea cual sea el sentido. */
function comparar(a: ValorOrden, b: ValorOrden, sentido: SentidoOrden): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true });
  return sentido === 'asc' ? cmp : -cmp;
}

/** Palabras que no identifican el producto sino su estado o un adorno del nombre. */
const PALABRAS_SUELTAS = new Set(['sucio', 'sucia', 'sucios', 'sucias', 'limpio', 'limpia', 'limpios', 'limpias', 'usado', 'usada', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'tipo', 'no', 'nro', 'num', 'numero']);

/** Familia del producto por similitud de nombre: la primera palabra que lo identifica, sin tildes, mayúsculas,
 *  números ni plural. "Plástico sucio", "Plásticos 2" y "PLASTICO limpio" caen en la misma familia ("plastico"). */
export function claveFamilia(material: string): string {
  const palabras = material
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(p => p && !/^\d+$/.test(p) && !PALABRAS_SUELTAS.has(p));
  const base = palabras[0] ?? material.trim().toLowerCase();
  return base.length > 4 && base.endsWith('s') ? base.slice(0, -1) : base;
}

const compararNombre = (a: FilaDetalleInventario, b: FilaDetalleInventario) =>
  a.material.localeCompare(b.material, 'es', { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

/** Copia ordenada (no muta). Al ordenar por material o kg los productos de una misma familia de nombre quedan
 *  juntos (las familias se ordenan por el total de la columna); con las demás columnas se ordena fila por fila. */
export function ordenarFilas(filas: FilaDetalleInventario[], orden: OrdenTabla): FilaDetalleInventario[] {
  const porFila = (a: FilaDetalleInventario, b: FilaDetalleInventario) =>
    comparar(valorDeColumna(a, orden.columna), valorDeColumna(b, orden.columna), orden.sentido) || compararNombre(a, b);
  if (orden.columna !== 'material' && orden.columna !== 'kg') return [...filas].sort(porFila);

  const familias = new Map<string, FilaDetalleInventario[]>();
  for (const fila of filas) {
    const clave = claveFamilia(fila.material);
    familias.set(clave, [...(familias.get(clave) ?? []), fila]);
  }
  const totalFamilia = (items: FilaDetalleInventario[]): number | null => {
    if (orden.columna === 'material') return null;
    const valores = items.map(i => valorDeColumna(i, orden.columna)).filter((v): v is number => typeof v === 'number');
    return valores.length > 0 ? valores.reduce((t, v) => t + v, 0) : null;
  };
  return [...familias.entries()]
    .map(([clave, items]) => ({ clave, items: [...items].sort(porFila), total: totalFamilia(items) }))
    .sort((a, b) =>
      (orden.columna === 'material'
        ? comparar(a.clave, b.clave, orden.sentido)
        : comparar(a.total, b.total, orden.sentido) || comparar(a.clave, b.clave, 'asc')))
    .flatMap(g => g.items);
}

export interface TotalesFilas {
  /** Stock actual (todas las filas son stock). */
  kg: number;
  /** Kg retirados a una transformación que aún no termina (informativo: no están en `kg`). */
  kgEnTransformacion: number;
  filas: number;
}

const redondear3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function totalizarFilas(filas: FilaDetalleInventario[]): TotalesFilas {
  let kg = 0, kgEnTransformacion = 0;
  for (const f of filas) {
    kg += f.kg;
    kgEnTransformacion += f.kgEnTransformacion || 0;
  }
  return {
    kg: redondear3(kg),
    kgEnTransformacion: redondear3(kgEnTransformacion),
    filas: filas.length,
  };
}

export interface GrupoTabla {
  clave: string;
  nombre: string;
  vista: VistaInventario;
  filas: FilaDetalleInventario[];
  totales: TotalesFilas;
}

export interface GrupoVista {
  vista: VistaInventario;
  etiqueta: string;
  grupos: GrupoTabla[];
  totales: TotalesFilas;
}

/** Agrupa las categorías por vista (orden fijo: Exportación, Venta nacional, Trabajo interno, Otras) con totales por vista.
 *  Respeta el orden de los grupos recibidos dentro de cada vista y omite las vistas sin filas. */
export function agruparPorVista(grupos: GrupoTabla[]): GrupoVista[] {
  return ORDEN_VISTAS
    .map(vista => {
      const delaVista = grupos.filter(g => g.vista === vista);
      return { vista, etiqueta: etiquetaVista(vista), grupos: delaVista, totales: totalizarFilas(delaVista.flatMap(g => g.filas)) };
    })
    .filter(v => v.grupos.length > 0);
}

/** Agrupa por categoría y ordena filas dentro de cada grupo. Los grupos se ordenan por el total de la columna
 *  elegida cuando es numérica comparable (kg), y por nombre en el resto. */
export function agruparFilas(filas: FilaDetalleInventario[], orden: OrdenTabla): GrupoTabla[] {
  const porClave = new Map<string, FilaDetalleInventario[]>();
  for (const f of filas) porClave.set(f.categoriaClave, [...(porClave.get(f.categoriaClave) ?? []), f]);
  const grupos: GrupoTabla[] = [...porClave.entries()].map(([clave, items]) => ({
    clave,
    nombre: items[0].categoria,
    vista: items[0].vista,
    filas: ordenarFilas(items, orden),
    totales: totalizarFilas(items),
  }));
  const porNombre = (a: GrupoTabla, b: GrupoTabla) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
  const valorGrupo = (g: GrupoTabla): number | null =>
    orden.columna === 'kg' ? g.totales.kg : null;
  return grupos.sort((a, b) => {
    if (orden.columna === 'kg') {
      return comparar(valorGrupo(a), valorGrupo(b), orden.sentido) || porNombre(a, b);
    }
    return orden.columna === 'categoria' && orden.sentido === 'desc' ? porNombre(b, a) : porNombre(a, b);
  });
}

export function filtrarPorEtapa(filas: FilaDetalleInventario[], etapa: EtapaFiltro | undefined): FilaDetalleInventario[] {
  if (!etapa) return filas;
  const objetivo = ETAPA_DE_FILTRO[etapa];
  return filas.filter(f => f.etapa === objetivo || (f.kgPorEtapa && kgDeEtapa(f, objetivo) > 0));
}

function kgDeEtapa(f: FilaDetalleInventario, e: EtapaInventario): number {
  const k = f.kgPorEtapa;
  return e === 'recibido' ? k.recibido : e === 'en_proceso' ? k.enProceso : k.listo;
}

/** Siguiente orden al hacer clic en una columna: misma columna alterna sentido; otra empieza en asc (texto) o desc (números). */
export function alternarOrden(actual: OrdenTabla, columna: ColumnaTabla): OrdenTabla {
  if (actual.columna === columna) return { columna, sentido: actual.sentido === 'asc' ? 'desc' : 'asc' };
  const esTexto = columna === 'material' || columna === 'categoria' || columna === 'ubicacion' || columna === 'etapa';
  return { columna, sentido: esTexto ? 'asc' : 'desc' };
}

export const ariaSort = (orden: OrdenTabla, columna: ColumnaTabla): 'ascending' | 'descending' | 'none' =>
  orden.columna !== columna ? 'none' : orden.sentido === 'asc' ? 'ascending' : 'descending';

// ---------------------------------------------------------------- CSV (es-VE: ';' y coma decimal, UTF-8 con BOM)

export const BOM_UTF8 = '﻿';
const SEPARADOR_CSV = ';';
const SALTO_CSV = '\r\n';

/** Escapa un campo de texto: comillas dobles duplicadas y entre comillas si lleva ; " o salto de línea. Neutraliza
 *  fórmulas (= + - @ al inicio) para que Excel no las ejecute. */
export function escaparCampoCsv(valor: string): string {
  let v = valor;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Número con coma decimal y sin separador de miles (Excel es-VE lo lee como número). Vacío si no hay dato. */
export function numeroCsv(n: number | null | undefined, decimales = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const redondeado = Math.round((n + Number.EPSILON) * 10 ** decimales) / 10 ** decimales;
  return String(redondeado).replace('.', ',');
}

export const ENCABEZADO_CSV_BASE = ['Material', 'Categoría', 'Tipo', 'Etapa', 'Kg', 'Días en inventario (estimado)', 'Ubicación', 'Último despacho (fecha)', 'Último despacho (kg)', 'En transformación (kg)'] as const;

export function armarCsv(filas: FilaDetalleInventario[]): string {
  const lineas = [[...ENCABEZADO_CSV_BASE].map(escaparCampoCsv).join(SEPARADOR_CSV)];
  for (const f of filas) {
    const base = [
      escaparCampoCsv(f.material),
      escaparCampoCsv(f.categoria),
      f.tipo === 'lote' ? 'Lote' : 'Material',
      etapaVisible(f),
      numeroCsv(f.kg, 3),
      numeroCsv(f.dias?.diasPromedio, 1),
      escaparCampoCsv(textoUbicacion(f)),
      f.ultimoDespacho ? f.ultimoDespacho.fecha.slice(0, 10) : '',
      numeroCsv(f.ultimoDespacho?.kg, 3),
      numeroCsv(f.kgEnTransformacion > 0 ? f.kgEnTransformacion : null, 3),
    ];
    lineas.push(base.join(SEPARADOR_CSV));
  }
  return BOM_UTF8 + lineas.join(SALTO_CSV) + SALTO_CSV;
}

export const nombreArchivoCsv = (hoy: Date): string => `inventario-${hoy.toISOString().slice(0, 10)}.csv`;


// ---------------------------------------------------------------- alertas

export interface EstiloSeveridad {
  etiqueta: string;
  /** Clases de Tailwind del contenedor. El rojo es SOLO para severidad 'roja'. */
  contenedor: string;
  insignia: string;
  /** Texto que acompaña al color (no depender solo del color). */
  prefijo: string;
}

export const ESTILO_SEVERIDAD: Record<SeveridadAlerta, EstiloSeveridad> = {
  roja: { etiqueta: 'Urgente', prefijo: '!!', contenedor: 'border-red-300 bg-red-50', insignia: 'bg-red-700 text-white' },
  amarilla: { etiqueta: 'Atención', prefijo: '!', contenedor: 'border-amber-300 bg-amber-50', insignia: 'bg-amber-200 text-amber-900' },
  info: { etiqueta: 'Aviso', prefijo: 'i', contenedor: 'border-border bg-surface', insignia: 'bg-slate-200 text-slate-800' },
};

export const ESTILO_CONTEO_ALERTA: Record<SeveridadAlerta, string> = {
  roja: 'bg-red-700 text-white',
  amarilla: 'bg-amber-200 text-amber-900',
  info: 'bg-slate-200 text-slate-800',
};

/** Enlace sugerido: lotes y embalados llevan a Lotes (pantalla anterior); el resto usa el que sugiere el backend. */
export function enlaceAlerta(a: AlertaInventario): { ruta: string; etiqueta: string } {
  if (a.loteId && (a.tipo === 'antiguedad' || a.tipo === 'embalado_sin_contenedor')) {
    return { ruta: '/inventario-legacy?pestana=lotes', etiqueta: 'Ver en Lotes' };
  }
  return a.enlace;
}

export function formatearValorAlerta(a: AlertaInventario): string {
  if (a.unidad === 'dias') return `${formatearNumero(a.valor, 0)} días (estimado)`;
  if (a.unidad === 'pct') return `${formatearNumero(a.valor, 1)} %`;
  return `${formatearNumero(a.valor, 0)} kg`;
}

export function ordenarAlertas(alertas: AlertaInventario[]): AlertaInventario[] {
  const peso: Record<SeveridadAlerta, number> = { roja: 0, amarilla: 1, info: 2 };
  return [...alertas].sort((a, b) => peso[a.severidad] - peso[b.severidad] || b.valor - a.valor);
}

// ---------------------------------------------------------------- tarjeta «Productos y lotes con stock»

export interface ConteoItems {
  total: number;
  porVista: Record<VistaInventario, number>;
}

/** Cuenta los productos y lotes con stock en galpón (una fila del detalle = un ítem) y los reparte por vista.
 *  Recibe los grupos del detalle (calculados por el servidor sobre TODAS las filas). Sin dinero. */
export function contarItemsPorVista(grupos: Array<{ vista: VistaInventario; filas: number }>): ConteoItems {
  const porVista: Record<VistaInventario, number> = { exportacion: 0, venta_nacional: 0, trabajo_interno: 0, otras: 0 };
  for (const g of grupos) porVista[g.vista] += Number.isFinite(g.filas) && g.filas > 0 ? g.filas : 0;
  return { total: ORDEN_VISTAS.reduce((t, v) => t + porVista[v], 0), porVista };
}

export const AYUDA_ITEMS_CON_STOCK = 'Cuántos productos y lotes distintos tienen kg en el galpón hoy. Cada producto suelto (por ejemplo, Plástico 1 limpio) cuenta uno y cada lote (Lote 1, BGPP…) cuenta uno. Debajo se reparte por vista: Exportación, Venta nacional, Trabajo interno y Otras. No cambia con el rango de fechas ni con la categoría o el buscador; sí respeta el almacén elegido.';

// ---------------------------------------------------------------- avisos sin dinero

const PATRON_DINERO = /costo|precio|dinero|valor|usd|\$/i;

/** /inventario solo muestra kilos: descarta los avisos que hablan de costos, precios o dinero si el servidor los envía. No modifica la lista. */
export function avisosSinDinero(avisos: readonly string[]): string[] {
  return avisos.filter(a => !PATRON_DINERO.test(a));
}
