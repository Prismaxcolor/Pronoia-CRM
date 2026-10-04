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
  { clave: 'exportacion', etiqueta: 'Exportación', descripcion: 'Lotes 1 a 4 y la ruta del PGM: lo que se embala y se envía al exterior.' },
  { clave: 'venta_nacional', etiqueta: 'Venta nacional', descripcion: 'Ferroso, No ferroso y Basura: se venden tal cual en el mercado nacional.' },
  { clave: 'trabajo_interno', etiqueta: 'Trabajo interno', descripcion: 'Lotes de trabajo (por procesar / procesado), desarme RAEE y Procesadores: ni se exportan ni se venden tal cual.' },
];

export const ETIQUETA_OTRAS = { clave: 'otras' as const, etiqueta: 'Otras', descripcion: 'Material que no encaja en las tres vistas anteriores.' };

export function vistaActiva(f: Pick<FiltrosPantalla, 'vista'>): VistaUrl {
  return f.vista ?? VISTA_POR_DEFECTO;
}

/** Texto del estado vacío de cada vista (siempre explica qué hacer). */
export const MENSAJE_VACIO_VISTA: Record<VistaUrl, { texto: string; enlace?: { ruta: string; etiqueta: string } }> = {
  exportacion: {
    texto: 'Aún no hay kg embalados: márcalos en Próximo contenedor.',
    enlace: { ruta: '#proximo-contenedor', etiqueta: 'Ir a Próximo contenedor' },
  },
  venta_nacional: {
    texto: 'No hay Ferroso, No ferroso ni Basura con stock con estos filtros. Se llenan con las compras (pesajes) de esos materiales.',
    enlace: { ruta: '/inventario-legacy?pestana=almacenes', etiqueta: 'Ver almacenes' },
  },
  trabajo_interno: {
    texto: 'No hay lotes de trabajo ni material en desarme con estos filtros. Aparecen al pesar tarjetas a MPP, BGPP, PCPP u otros lotes, o al registrar un desarme.',
    enlace: { ruta: '/transformaciones', etiqueta: 'Registrar transformación' },
  },
  otras: { texto: 'No hay material fuera de las tres vistas principales.' },
};

// ---------------------------------------------------------------- parámetros de los endpoints

export const LIMITE_FILAS_INICIAL = 500;
export const LIMITE_FILAS_MAXIMO = 2000;
export const PASOS_LIMITE = [500, 1000, 2000] as const;

export interface OpcionesParametros {
  /** No enviar `categoria` (las tarjetas y el Sankey se quedan completos y solo resaltan la elegida). */
  sinCategoria?: boolean;
  limite?: number;
  incluirClasificaciones?: boolean;
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
  return p;
}

/** Clave estable para decidir si hay que volver a pedir (cambia solo si cambia algo que viaja al servidor). */
export function claveParametros(p: URLSearchParams): string {
  return [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
}

// ---------------------------------------------------------------- formato

export const formatearUsdKg = (n: number): string => `USD ${formatearNumero(n, 2)}/kg`;
export const formatearDiasEstimados = (d: number): string => `${formatearNumero(d, 0)} d`;

export const ETIQUETA_ETAPA: Record<EtapaInventario, string> = {
  recibido: 'Recibido',
  en_proceso: 'En proceso',
  listo: 'Listo',
  despachado: 'Despachado',
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

export type ColumnaTabla = 'material' | 'categoria' | 'etapa' | 'kg' | 'precioKg' | 'usd' | 'dias' | 'ubicacion';
export type SentidoOrden = 'asc' | 'desc';
export interface OrdenTabla { columna: ColumnaTabla; sentido: SentidoOrden }

export const ORDEN_TABLA_POR_DEFECTO: OrdenTabla = { columna: 'kg', sentido: 'desc' };

/** Texto de la columna Etapa. La etapa del contrato (recibido/en_proceso/listo/despachado) es una agrupación interna:
 *  en lotes con fase o de exportación se muestra el paso real del PCB para no contradecir las insignias. */
const ETAPAS_VISIBLES = ['Recibido', 'Por procesar', 'En proceso', 'Procesado', 'En saca', 'Listo', 'Embalado (Listo)', 'Despachado'] as const;
export type EtapaVisible = (typeof ETAPAS_VISIBLES)[number];

export function etapaVisible(f: Pick<FilaDetalleInventario, 'tipo' | 'clase' | 'fase' | 'etapa'>): EtapaVisible {
  if (f.tipo === 'lote' && f.etapa !== 'despachado') {
    if (f.clase === 'trabajo' && f.fase === 'por_procesar') return 'Por procesar';
    if (f.clase === 'trabajo' && f.fase === 'procesado') return 'Procesado';
    if (f.clase === 'exportacion') return f.etapa === 'listo' ? 'Embalado (Listo)' : 'En saca';
  }
  return ETIQUETA_ETAPA[f.etapa] as EtapaVisible;
}

export const EXPLICACION_ETAPAS_PCB = 'Etapas de un lote de PCB: por procesar (lote de trabajo con material sin tratar) → procesado (ya desarmado o clasificado) → en saca (lote de exportación armado, aún sin embalar) → embalado (listo para despachar). El resto de materiales usan Recibido, En proceso, Listo y Despachado.';

const ORDEN_ETAPA = (f: FilaDetalleInventario): number => ETAPAS_VISIBLES.indexOf(etapaVisible(f));

/** $/kg de la fila: costo promedio en materiales, precio estimado de venta en lotes (cifras distintas: ver `usdFila`). */
export const precioKgFila = (f: FilaDetalleInventario): number | null => (f.tipo === 'lote' ? f.precioEstimadoKg : f.costoPromedioKg);
/** USD de la fila: valor a COSTO en materiales, valor ESTIMADO de venta en lotes. Nunca se suman entre sí. */
export const usdFila = (f: FilaDetalleInventario): number | null => (f.tipo === 'lote' ? f.valorEstimadoUsd : f.valorCostoUsd);

/** Almacén con más kg (para ordenar por ubicación) y texto completo "G1 1.200 kg · G2 300 kg". */
export function ubicacionPrincipal(f: FilaDetalleInventario): string {
  if (f.porAlmacen.length === 0) return '';
  return [...f.porAlmacen].sort((a, b) => b.kg - a.kg)[0].almacenNombre;
}
export function textoUbicacion(f: FilaDetalleInventario): string {
  return f.porAlmacen.map(a => `${a.almacenNombre} ${formatearNumero(a.kg, 0)} kg`).join(' · ');
}

type ValorOrden = number | string | null;

function valorDeColumna(f: FilaDetalleInventario, c: ColumnaTabla): ValorOrden {
  switch (c) {
    case 'material': return f.material;
    case 'categoria': return f.categoria;
    case 'etapa': return ORDEN_ETAPA(f);
    case 'kg': return f.kg;
    case 'precioKg': return precioKgFila(f);
    case 'usd': return usdFila(f);
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
    .filter(p => p && !/^d+$/.test(p) && !PALABRAS_SUELTAS.has(p));
  const base = palabras[0] ?? material.trim().toLowerCase();
  return base.length > 4 && base.endsWith('s') ? base.slice(0, -1) : base;
}

const compararNombre = (a: FilaDetalleInventario, b: FilaDetalleInventario) =>
  a.material.localeCompare(b.material, 'es', { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);

/** Copia ordenada (no muta). Al ordenar por material, kg o USD los productos de una misma familia de nombre quedan
 *  juntos (las familias se ordenan por el total de la columna); con las demás columnas se ordena fila por fila. */
export function ordenarFilas(filas: FilaDetalleInventario[], orden: OrdenTabla): FilaDetalleInventario[] {
  const porFila = (a: FilaDetalleInventario, b: FilaDetalleInventario) =>
    comparar(valorDeColumna(a, orden.columna), valorDeColumna(b, orden.columna), orden.sentido) || compararNombre(a, b);
  if (orden.columna !== 'material' && orden.columna !== 'kg' && orden.columna !== 'usd') return [...filas].sort(porFila);

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
  /** Stock en galpón (solo filas enGalpon). */
  kgEnGalpon: number;
  /** Kg retirados a transformación bruta (filas informativas en_proceso fuera del galpón). */
  kgEnTransformacion: number;
  kgDespachado: number;
  /** Suma de valores a costo (materiales). null si ninguna fila trae costo (o valorOculto). */
  valorCostoUsd: number | null;
  /** Suma de valores estimados de venta (lotes). Cifra distinta: no se suma al costo. */
  valorEstimadoUsd: number | null;
  filas: number;
}

const redondear3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function totalizarFilas(filas: FilaDetalleInventario[]): TotalesFilas {
  let kgEnGalpon = 0, kgEnTransformacion = 0, kgDespachado = 0;
  let costo = 0, estimado = 0, hayCosto = false, hayEstimado = false;
  for (const f of filas) {
    if (f.enGalpon) kgEnGalpon += f.kg;
    else if (f.etapa === 'despachado') kgDespachado += f.kg;
    else kgEnTransformacion += f.kg;
    if (!f.enGalpon) continue;
    if (f.tipo === 'material' && f.valorCostoUsd !== null) { costo += f.valorCostoUsd; hayCosto = true; }
    if (f.tipo === 'lote' && f.valorEstimadoUsd !== null) { estimado += f.valorEstimadoUsd; hayEstimado = true; }
  }
  return {
    kgEnGalpon: redondear3(kgEnGalpon),
    kgEnTransformacion: redondear3(kgEnTransformacion),
    kgDespachado: redondear3(kgDespachado),
    valorCostoUsd: hayCosto ? redondear3(costo) : null,
    valorEstimadoUsd: hayEstimado ? redondear3(estimado) : null,
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

/** Agrupa por categoría y ordena filas dentro de cada grupo. Los grupos se ordenan por el total de la columna
 *  elegida cuando es numérica comparable (kg, USD), y por nombre en el resto. */
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
    orden.columna === 'kg' ? g.totales.kgEnGalpon : orden.columna === 'usd' ? (g.totales.valorCostoUsd ?? g.totales.valorEstimadoUsd) : null;
  return grupos.sort((a, b) => {
    if (orden.columna === 'kg' || orden.columna === 'usd') {
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
  return e === 'recibido' ? k.recibido : e === 'en_proceso' ? k.enProceso : e === 'listo' ? k.listo : k.despachado;
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

export interface OpcionesCsv { valorOculto: boolean }

export const ENCABEZADO_CSV_BASE = ['Material', 'Categoría', 'Tipo', 'Etapa', 'En galpón', 'Kg', 'Días en inventario (estimado)', 'Ubicación'] as const;
export const ENCABEZADO_CSV_VALOR = ['Costo USD/kg (materiales)', 'Valor a costo USD (materiales)', 'Precio estimado de venta USD/kg (lotes)', 'Valor estimado de venta USD (lotes)'] as const;

export function armarCsv(filas: FilaDetalleInventario[], op: OpcionesCsv): string {
  const encabezado = op.valorOculto ? [...ENCABEZADO_CSV_BASE] : [...ENCABEZADO_CSV_BASE, ...ENCABEZADO_CSV_VALOR];
  const lineas = [encabezado.map(escaparCampoCsv).join(SEPARADOR_CSV)];
  for (const f of filas) {
    const base = [
      escaparCampoCsv(f.material),
      escaparCampoCsv(f.categoria),
      f.tipo === 'lote' ? 'Lote' : 'Material',
      etapaVisible(f),
      f.enGalpon ? 'Sí' : 'No',
      numeroCsv(f.kg, 3),
      numeroCsv(f.dias?.diasPromedio, 1),
      escaparCampoCsv(textoUbicacion(f)),
    ];
    const valor = op.valorOculto ? [] : [
      numeroCsv(f.costoPromedioKg, 4),
      numeroCsv(f.valorCostoUsd, 2),
      numeroCsv(f.precioEstimadoKg, 4),
      numeroCsv(f.valorEstimadoUsd, 2),
    ];
    lineas.push([...base, ...valor].join(SEPARADOR_CSV));
  }
  return BOM_UTF8 + lineas.join(SALTO_CSV) + SALTO_CSV;
}

export const nombreArchivoCsv = (hoy: Date): string => `inventario-${hoy.toISOString().slice(0, 10)}.csv`;

export const AVISO_CSV_SIN_VALOR = 'No tienes permiso para ver valores: el archivo incluye solo kilos, etapa, días y ubicación (sin costos, precios ni USD).';

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
