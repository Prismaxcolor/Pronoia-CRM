import type {
  AlertasPantalla,
  CategoriasPantalla,
  DetallePantalla,
  FiltrosPantalla,
  MetaPantalla,
  VistaInventario,
} from '../../../shared/types/inventario-pantalla.js';
import { crearCacheCorto } from '../utils/cache-corto.js';
import { construirAlertas } from '../utils/alertas-inventario.js';
import {
  armarDetalle,
  construirFilasDetalleConAvisos,
  construirTarjetas,
  filtrarFilas,
  rendimientoPorCategoria,
  separarClasificaciones,
} from '../utils/pantalla-inventario.js';
import type { MovimientosInventario } from '../utils/movimientos-pantalla.js';
import type { CostoProducto, EmbalajeEntrada, InventarioAlmacenEntrada, LoteEntrada, RangoFechas } from '../utils/resumen-inventario.js';
import type { ConfiguracionInventario } from '../schemas/configuracion-inventario.js';
import { FILAS_DETALLE_POR_DEFECTO, MAX_FILAS_DETALLE } from '../schemas/inventario-pantalla.js';
import { leerConfiguracionInventario } from './configuracion-inventario-service.js';
import { cargarEmbalajesVigentes } from './lote-embalaje-service.js';
import {
  cargarAlmacenes,
  cargarCostos,
  cargarLotes,
  esencial,
  inventarioDeAlmacen,
  leerConRespaldo,
  resolverRangoMerma,
  type Seguimiento,
} from './inventario-resumen-service.js';
import {
  leerAjustes,
  leerEmbalajesConContenedor,
  leerProductos,
  leerTickets,
  leerTransformaciones,
} from './inventario-pantalla-datos.js';
import { registrarInvalidacionCacheResumen } from './resumen-cache.js';

/** Mismo presupuesto que el resumen: deja margen bajo el límite de la función serverless. */
export const PRESUPUESTO_PANTALLA_MS = 8_000;
export const TTL_CACHE_PANTALLA_MS = 20_000;
/** Una base parcial (datos incompletos) se cachea solo este rato: absorbe la carga sin servirla por mucho tiempo. */
export const TTL_CACHE_PARCIAL_MS = 5_000;

export interface OpcionesPantalla {
  desde?: string;
  hasta?: string;
  categoria?: string;
  almacen?: string;
  q?: string;
  /** Solo el detalle. */
  limite?: number;
  vista?: VistaInventario;
  incluirClasificaciones?: boolean;
  /** Solo true para usuarios con facturacion:ver; por defecto false (ni se consultan los costos). */
  incluirValor?: boolean;
  /** Solo para pruebas. */
  hoy?: string;
  presupuestoMs?: number;
}

/** Todo lo que no depende de los filtros: se calcula una vez y lo comparten los endpoints de la pantalla y de costos. */
export interface BasePantalla {
  generadoEn: string;
  almacenes: InventarioAlmacenEntrada[];
  lotes: LoteEntrada[];
  embalajes: EmbalajeEntrada[];
  costos: Map<string, CostoProducto>;
  config: ConfiguracionInventario;
  movimientos: MovimientosInventario;
  avisos: string[];
  parcial: boolean;
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

async function calcularBase(incluirValor: boolean, presupuestoMs: number): Promise<BasePantalla> {
  const inicio = Date.now();
  const seg: Seguimiento = { avisos: [], parcial: false, restanteMs: () => presupuestoMs - (Date.now() - inicio) };
  const avisosLecturas: string[] = [];
  const vacio = <T>(): T[] => [];

  // El inventario de cada almacén (lo más lento) arranca en cuanto se conocen los almacenes.
  const inventariosPromesa = esencial(cargarAlmacenes(), 'los almacenes', seg).then(almacenes =>
    Promise.all(almacenes.map(a => inventarioDeAlmacen(a, seg)))
  );
  const [almacenes, lotes, embalajes, config, costos, productos, tickets, transformaciones, ajustes, embContenedor] = await Promise.all([
    inventariosPromesa,
    esencial(cargarLotes(), 'los lotes', seg),
    leerConRespaldo(cargarEmbalajesVigentes(), [] as EmbalajeEntrada[], 'No se pudieron leer los embalajes: los kilos embalados aparecen en 0 y no son confiables.', seg),
    esencial(leerConfiguracionInventario(), 'la configuración', seg),
    incluirValor
      ? leerConRespaldo(cargarCostos(avisosLecturas), new Map<string, CostoProducto>(), 'No se pudieron leer los costos de compra: el valor a costo de los materiales no es confiable.', seg)
      : Promise.resolve(new Map<string, CostoProducto>()),
    esencial(leerProductos(), 'los productos', seg),
    leerConRespaldo(leerTickets(), vacio<MovimientosInventario['tickets'][number]>(), 'No se pudieron leer los tickets de compra y venta: despachos y antigüedad no son completos.', seg),
    leerConRespaldo(leerTransformaciones(), { transformaciones: vacio<MovimientosInventario['transformaciones'][number]>(), sinMermaTipificada: false }, 'No se pudieron leer las transformaciones: rendimiento y merma no son completos.', seg),
    leerConRespaldo(leerAjustes(), vacio<MovimientosInventario['ajustes'][number]>(), 'No se pudieron leer los ajustes de toma física: la antigüedad estimada no es completa.', seg),
    leerConRespaldo(leerEmbalajesConContenedor(), vacio<MovimientosInventario['embalajes'][number]>(), 'No se pudo leer el contenedor de los embalajes: la alerta de embalado sin contenedor no es completa.', seg),
  ]);
  if (avisosLecturas.length > 0) {
    seg.parcial = true;
    seg.avisos.push(...avisosLecturas);
  }
  if (transformaciones.sinMermaTipificada) {
    // Aviso INFORMATIVO: la merma sale "sin clasificar" (estado definido, no datos faltantes), así que no marca
    // `parcial` y la base se cachea con el TTL normal. Solo los avisos de lecturas fallidas o lentas son parciales.
    seg.avisos.push('Aún no está habilitada la merma por tipo en la base de datos: la merma aparece sin clasificar.');
  }
  return {
    generadoEn: new Date().toISOString(),
    almacenes, lotes, embalajes, costos, config,
    movimientos: { productos, tickets, transformaciones: transformaciones.transformaciones, ajustes, embalajes: embContenedor },
    avisos: seg.avisos,
    parcial: seg.parcial,
  };
}

/**
 * Caché corta compartida por los endpoints; la clave incluye el permiso de valor (con costos o sin ellos).
 * Los avisos informativos no impiden cachear; una base parcial se cachea solo TTL_CACHE_PARCIAL_MS.
 */
const cacheBase = crearCacheCorto<BasePantalla>({
  ttlMs: TTL_CACHE_PANTALLA_MS,
  ttlPara: b => (b.parcial ? TTL_CACHE_PARCIAL_MS : TTL_CACHE_PANTALLA_MS),
});
registrarInvalidacionCacheResumen(() => cacheBase.invalidar());

export function invalidarCachePantalla(): void {
  cacheBase.invalidar();
}

interface Contexto {
  base: BasePantalla;
  rango: RangoFechas;
  hoy: string;
  valorOculto: boolean;
  filtros: FiltrosPantalla;
  avisos: string[];
}

async function prepararContexto(opts: OpcionesPantalla): Promise<Contexto> {
  const rango = resolverRangoMerma(opts);
  if (!rango) throw new Error('Rango de fechas inválido: usa desde y hasta (YYYY-MM-DD) con desde <= hasta.');
  const incluirValor = opts.incluirValor === true;
  const base = await cacheBase.obtener(`valor:${incluirValor ? 1 : 0}`, () =>
    calcularBase(incluirValor, opts.presupuestoMs ?? PRESUPUESTO_PANTALLA_MS)
  );
  return {
    base, rango, hoy: opts.hoy ?? hoyISO(), valorOculto: !incluirValor, avisos: [...base.avisos],
    filtros: { desde: rango.desde, hasta: rango.hasta, categoria: opts.categoria ?? null, almacen: opts.almacen ?? null, q: opts.q ?? null },
  };
}

/** Base compartida (caché corta) con o sin costos; la usa también el servicio de costos. */
export async function obtenerBasePantalla(incluirValor: boolean, presupuestoMs = PRESUPUESTO_PANTALLA_MS): Promise<BasePantalla> {
  return cacheBase.obtener(`valor:${incluirValor ? 1 : 0}`, () => calcularBase(incluirValor, presupuestoMs));
}

const meta = (c: Contexto): MetaPantalla => ({
  generadoEn: c.base.generadoEn, valorOculto: c.valorOculto, parcial: c.base.parcial, avisos: c.avisos, filtros: c.filtros,
});

/** Filas del contexto; los avisos del cálculo (antigüedad con filtro de almacén) se suman a los de la respuesta. */
function filasDelContexto(c: Contexto) {
  const { filas, fuera, avisos } = construirFilasDetalleConAvisos({
    almacenes: c.base.almacenes, lotes: c.base.lotes, embalajes: c.base.embalajes, costos: c.base.costos,
    movimientos: c.base.movimientos, hoy: c.hoy, rango: c.rango, almacenId: c.filtros.almacen, valorOculto: c.valorOculto,
  });
  for (const a of avisos) if (!c.avisos.includes(a)) c.avisos.push(a);
  return { filas, fuera };
}

/** Tabla única de detalle: materiales y lotes en galpón, kg en transformación y despachos del período. */
export async function obtenerDetallePantalla(opts: OpcionesPantalla = {}): Promise<DetallePantalla> {
  const c = await prepararContexto(opts);
  const { filas, fuera } = filasDelContexto(c);
  const filtro = { categoria: opts.categoria, q: opts.q, vista: opts.vista };
  const filtradas = filtrarFilas(filas, filtro);
  const fueraFiltradas = filtrarFilas(fuera, filtro);
  const { visibles, kgOcultos, valorOcultoUsd } = opts.incluirClasificaciones
    ? { visibles: filtradas, kgOcultos: 0, valorOcultoUsd: null }
    : separarClasificaciones(filtradas);
  const fueraVisibles = opts.incluirClasificaciones ? fueraFiltradas : fueraFiltradas.filter(f => !f.esClasificacionCompra);
  const maxFilas = Math.min(opts.limite ?? FILAS_DETALLE_POR_DEFECTO, MAX_FILAS_DETALLE);
  const d = armarDetalle(visibles, maxFilas, c.valorOculto, kgOcultos, valorOcultoUsd, fueraVisibles);
  if (d.limite.truncado) {
    c.avisos.push(`Se muestran ${d.limite.maxFilas} de ${d.limite.totalFilas} filas: afina los filtros o sube el límite. Los totales cuentan todas.`);
  }
  return { ...meta(c), ...d };
}

/** Tarjetas por categoría (y clase de lote) y por vista, con la barra por etapa. */
export async function obtenerCategoriasPantalla(opts: OpcionesPantalla = {}): Promise<CategoriasPantalla> {
  const c = await prepararContexto(opts);
  const { filas, fuera } = filasDelContexto(c);
  const filtro = { categoria: opts.categoria, q: opts.q };
  const { visibles, kgOcultos } = separarClasificaciones(filtrarFilas(filas, filtro));
  const fueraVisibles = filtrarFilas(fuera, filtro).filter(f => !f.esClasificacionCompra);
  const transformaciones = c.base.movimientos.transformaciones.filter(t => !c.filtros.almacen || t.almacenId === c.filtros.almacen);
  const r = construirTarjetas(visibles, rendimientoPorCategoria(transformaciones, c.rango), c.valorOculto, fueraVisibles);
  return { ...meta(c), ...r, kgClasificacionesCompraOcultas: kgOcultos };
}

/** Alertas: antigüedad (según configuracion_inventario), merma sobre el umbral y embalado sin contenedor. */
export async function obtenerAlertasPantalla(opts: OpcionesPantalla = {}): Promise<AlertasPantalla> {
  const c = await prepararContexto(opts);
  const filas = filtrarFilas(filasDelContexto(c).filas, { categoria: opts.categoria, q: opts.q });
  const transformaciones = c.base.movimientos.transformaciones.filter(t => !c.filtros.almacen || t.almacenId === c.filtros.almacen);
  const r = construirAlertas({ filas, config: c.base.config, transformaciones, rango: c.rango, embalajes: c.base.movimientos.embalajes });
  return { ...meta(c), ...r };
}
