import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado } from '../utils/paginacion.js';
import { logger } from '../utils/logger.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { obtenerInventarioAlmacen } from './inventario-service.js';
import { leerConfiguracionInventario } from './configuracion-inventario-service.js';
import { cargarEmbalajesVigentes } from './lote-embalaje-service.js';
import { reportesMermaDosPeriodos } from './transformacion-service.js';
import { cacheResumen } from './resumen-cache.js';
import { conLimiteDeTiempo } from '../utils/tiempo-limite.js';
import { resumirMerma } from '../utils/merma-transformacion.js';
import { resumirMermaPorTipo } from '../utils/merma-tipificada.js';
import { leerClasificacion } from '../utils/lote-clasificacion.js';
import {
  armarResumenMerma,
  construirResumenInventario,
  combinarCostos,
  costoPromedioPorProducto,
  ocultarValor,
  rangoAnterior,
  rangoPorDefecto,
  type CostoProducto,
  type LoteEntrada,
  type RangoFechas,
  type ReporteMermaParaResumen,
  type ResumenInventarioBase,
  type ResumenMermaInventario,
} from '../utils/resumen-inventario.js';
import type { ConfiguracionInventario } from '../schemas/configuracion-inventario.js';
import { hoyNegocio } from '../utils/fecha-negocio.js';

/** Por defecto 8 s: deja margen bajo el límite de la función serverless. */
export const PRESUPUESTO_RESUMEN_MS = 8_000;

export interface OpcionesResumenInventario {
  /** Rango de la merma (YYYY-MM-DD). Por defecto, los últimos 30 días. Ambos o ninguno. */
  desde?: string;
  hasta?: string;
  /** Solo para pruebas: fecha de "hoy" (YYYY-MM-DD). */
  hoy?: string;
  /**
   * Incluir costos de compra y precios de venta. Solo true para usuarios con facturacion:ver; por
   * defecto false: sin permiso ni se consultan los costos.
   */
  incluirValor?: boolean;
  /** Tiempo máximo antes de devolver un resumen parcial con aviso (por defecto 8 s). */
  presupuestoMs?: number;
}

export interface ResumenInventario extends ResumenInventarioBase {
  generadoEn: string;
  configuracion: ConfiguracionInventario;
  merma: ResumenMermaInventario;
  /** Avisos de lecturas que fallaron o no terminaron a tiempo (la cifra afectada no es completa). */
  avisos: string[];
  /** true si algún cálculo falló o no terminó a tiempo: ver avisos. */
  parcial: boolean;
}

export interface AlmacenRow {
  id: string;
  nombre: string;
  activo: boolean;
}

interface LineaCompraRow {
  producto_id: string | null;
  peso: number | string | null;
  subtotal: number | string | null;
}

/** TODOS los almacenes, también los inactivos: stock_lote_total() y los embalajes no distinguen por
 *  activo, así que filtrarlos aquí haría que el resumen no cuadre con /api/lotes. */
export async function cargarAlmacenes(): Promise<AlmacenRow[]> {
  const { data, error } = await supabaseAdmin.from('almacenes').select('id, nombre, activo').order('nombre');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; nombre: string; activo: boolean | null }>).map(a => ({
    id: a.id,
    nombre: a.nombre,
    activo: a.activo !== false,
  }));
}

export async function cargarLotes(): Promise<LoteEntrada[]> {
  const { data, error } = await supabaseAdmin.from('lotes').select('*').order('nombre');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(r => {
    const c = leerClasificacion(r);
    return {
      id: String(r.id),
      nombre: String(r.nombre),
      activo: r.activo !== false,
      clase: c.clase,
      precioEstimadoKg: c.precioEstimadoKg,
      precioEstimadoActualizadoEn: (r.precio_estimado_actualizado_en as string | null | undefined) ?? null,
      fase: (r.fase as string | null | undefined) ?? null,
    };
  });
}

/** Productos marcados como no vendibles (productos.vendible = false). Vacío si la columna aún no existe. */
export async function cargarNoVendibles(avisos: string[]): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('productos').select('id').eq('vendible', false);
  if (error) {
    // 42703 = columna inexistente (migración pendiente): no es un fallo, simplemente nada está marcado.
    if (error.code !== '42703') avisos.push('No se pudo leer qué productos no son vendibles.');
    return new Set();
  }
  return new Set(((data ?? []) as Array<{ id: string }>).map(p => p.id));
}

/** Costos de referencia manuales (productos.costo_referencia_kg). Vacío si la columna aún no existe (migración pendiente). */
export async function cargarCostosReferencia(): Promise<Map<string, number>> {
  let filas: Array<{ id: string; costo_referencia_kg: number | string | null }>;
  try {
    filas = await leerPaginado<{ id: string; costo_referencia_kg: number | string | null }>((desde, hasta) =>
      supabaseAdmin.from('productos').select('id, costo_referencia_kg').order('id').range(desde, hasta)
    );
  } catch (err) {
    if (esObjetoInexistente(err as { code?: string; message?: string })) return new Map();
    throw err;
  }
  const mapa = new Map<string, number>();
  for (const r of filas) {
    const v = Number(r.costo_referencia_kg);
    if (r.costo_referencia_kg != null && Number.isFinite(v) && v >= 0) mapa.set(r.id, v);
  }
  return mapa;
}

/**
 * Costo EFECTIVO (USD/kg) por producto: la referencia manual si existe; si no, el promedio ponderado de las
 * facturas de compra NO anuladas. Si falta cualquiera de las dos lecturas se usa la otra y se avisa.
 */
export async function cargarCostos(avisos: string[]): Promise<Map<string, CostoProducto>> {
  const [facturas, referencias] = await Promise.all([
    cargarCostosFacturas(avisos),
    cargarCostosReferencia().catch(err => {
      logger.warn({ evento: 'resumen_inventario_costos_referencia_no_leidos', motivo: err instanceof Error ? err.message : String(err) });
      avisos.push('No se pudieron leer los costos de referencia: el valor a costo solo usa las facturas.');
      return new Map<string, number>();
    }),
  ]);
  return combinarCostos(facturas, referencias);
}

/** Costo promedio ponderado (USD/kg) por producto de las facturas de compra NO anuladas. */
async function cargarCostosFacturas(avisos: string[]): Promise<Map<string, CostoProducto>> {
  try {
    const filas = await leerPaginado<LineaCompraRow>((desde, hasta) =>
      supabaseAdmin
        .from('detalle_facturas_compra')
        .select('producto_id, peso, subtotal, facturas_compra!inner(estado)')
        .neq('facturas_compra.estado', 'anulada')
        .order('id')
        .range(desde, hasta)
    );
    return costoPromedioPorProducto(
      filas.flatMap(f =>
        f.producto_id ? [{ productoId: f.producto_id, peso: Number(f.peso), subtotal: Number(f.subtotal) }] : []
      )
    );
  } catch (err) {
    logger.warn({ evento: 'resumen_inventario_costos_no_leidos', motivo: err instanceof Error ? err.message : String(err) });
    avisos.push('No se pudieron leer los costos de compra: el valor a costo de los materiales no es confiable.');
    return new Map();
  }
}

const hoyISO = () => hoyNegocio();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Rango pedido (ambos extremos o ninguno) o el de por defecto. null si es inválido. */
export function resolverRangoMerma(opts: OpcionesResumenInventario): RangoFechas | null {
  if (!opts.desde && !opts.hasta) return rangoPorDefecto(opts.hoy ?? hoyISO());
  if (!opts.desde || !opts.hasta || !FECHA.test(opts.desde) || !FECHA.test(opts.hasta) || opts.desde > opts.hasta) return null;
  return { desde: opts.desde, hasta: opts.hasta };
}

const MERMA_VACIA: ReporteMermaParaResumen = {
  totales: resumirMerma([], 'mes').totales,
  porTipo: resumirMermaPorTipo([]),
  filas: [],
};

/** Estado compartido por las lecturas de una misma petición: avisos, si alguna quedó incompleta y el tiempo que resta. */
export interface Seguimiento {
  avisos: string[];
  parcial: boolean;
  restanteMs: () => number;
}

/** Espera una lectura dentro del presupuesto; si falla o vence usa `respaldo` y deja un aviso. */
export async function leerConRespaldo<T>(promesa: Promise<T>, respaldo: T, aviso: string, seg: Seguimiento): Promise<T> {
  const r = await conLimiteDeTiempo(promesa, seg.restanteMs());
  if (r.ok) return r.valor;
  seg.parcial = true;
  seg.avisos.push(r.motivo === 'tiempo' ? `${aviso} (tardó demasiado)` : aviso);
  if (r.motivo === 'error') {
    logger.warn({
      evento: 'resumen_inventario_lectura_fallida',
      aviso,
      motivo: r.error instanceof Error ? r.error.message : String(r.error),
    });
  }
  return respaldo;
}

/** Lectura sin la cual no hay resumen (almacenes, lotes): si falla o vence, el resumen falla. */
export async function esencial<T>(promesa: Promise<T>, nombre: string, seg: Seguimiento): Promise<T> {
  const r = await conLimiteDeTiempo(promesa, seg.restanteMs());
  if (r.ok) return r.valor;
  if (r.motivo === 'error') throw r.error;
  throw new Error(`El resumen del inventario tardó demasiado al leer ${nombre}.`);
}

/** Inventario de un almacén con el presupuesto restante; si falla o vence, se omite con aviso. */
export async function inventarioDeAlmacen(a: AlmacenRow, seg: Seguimiento) {
  const grupos = await leerConRespaldo(
    obtenerInventarioAlmacen(a.id),
    [] as Awaited<ReturnType<typeof obtenerInventarioAlmacen>>,
    `No se pudo calcular el inventario del almacén "${a.nombre}": sus kilos no están en el resumen.`,
    seg
  );
  return { almacenId: a.id, nombre: a.nombre, activo: a.activo, grupos };
}

async function calcularResumen(opts: OpcionesResumenInventario, rango: RangoFechas): Promise<ResumenInventario> {
  const previo = rangoAnterior(rango);
  const inicio = Date.now();
  const presupuesto = opts.presupuestoMs ?? PRESUPUESTO_RESUMEN_MS;
  const seg: Seguimiento = { avisos: [], parcial: false, restanteMs: () => presupuesto - (Date.now() - inicio) };
  const incluirValor = opts.incluirValor === true;

  // Todo lo independiente en paralelo. Los costos solo se consultan si el usuario puede verlos.
  const avisosLecturas: string[] = [];
  // El inventario de cada almacén (lo más lento) arranca en cuanto se conocen los almacenes, sin esperar al resto.
  const inventariosPromesa = esencial(cargarAlmacenes(), 'los almacenes', seg).then(almacenes =>
    Promise.all(almacenes.map(a => inventarioDeAlmacen(a, seg)))
  );
  const [inventarios, lotes, embalajes, config, noVendibles, costos, mermas] = await Promise.all([
    inventariosPromesa,
    esencial(cargarLotes(), 'los lotes', seg),
    leerConRespaldo(
      cargarEmbalajesVigentes(),
      [] as Awaited<ReturnType<typeof cargarEmbalajesVigentes>>,
      'No se pudieron leer los embalajes: los kilos embalados aparecen en 0 y no son confiables.',
      seg
    ),
    esencial(leerConfiguracionInventario(), 'la configuración', seg),
    leerConRespaldo(cargarNoVendibles(avisosLecturas), new Set<string>(), 'No se pudo leer qué productos no son vendibles.', seg),
    incluirValor
      ? leerConRespaldo(
          cargarCostos(avisosLecturas),
          new Map<string, CostoProducto>(),
          'No se pudieron leer los costos de compra: el valor a costo de los materiales no es confiable.',
          seg
        )
      : Promise.resolve(new Map<string, CostoProducto>()),
    leerConRespaldo(reportesMermaDosPeriodos(rango, previo), null, 'No se pudo calcular la merma del período.', seg),
  ]);
  if (avisosLecturas.length > 0) {
    seg.parcial = true;
    seg.avisos.push(...avisosLecturas);
  }
  const completo = construirResumenInventario({
    almacenes: inventarios,
    lotes,
    embalajes,
    productosNoVendibles: noVendibles,
    costos,
    config,
  });
  const base = incluirValor ? completo : ocultarValor(completo);

  for (const a of base.almacenes) {
    if (!a.activo && Math.abs(a.totalKg) > 0.005) {
      seg.avisos.push(`El almacén "${a.nombre}" está inactivo y aún tiene ${a.totalKg} kg: se incluyen en los totales.`);
    }
  }
  if (mermas && mermas.avisos.length > 0) {
    seg.parcial = true;
    seg.avisos.push(...mermas.avisos);
  }
  return {
    generadoEn: new Date().toISOString(),
    ...base,
    configuracion: config,
    merma: armarResumenMerma(rango, mermas?.actual ?? MERMA_VACIA, previo, mermas?.previo ?? MERMA_VACIA, config.umbralMermaPct),
    avisos: seg.avisos,
    parcial: seg.parcial,
  };
}

/**
 * Resumen agregado del inventario en UNA llamada: kilos por categoría y clase de lote, stock por lote
 * (clase, precio estimado, embalado, en saca), kilos de exportación y listos, valor a costo de los
 * materiales y valor estimado de venta de los lotes (dos cifras separadas), meta de contenedor y merma
 * del período comparada con el anterior. Solo lectura; sin llamadas RPC por lote.
 *
 * Costos y precios de venta SOLO si `incluirValor` (usuario con facturacion:ver); si no, valorOculto
 * y ni se consultan los costos. Caché de 20 s por (rango, permiso de valor). Si algo falla o excede el
 * presupuesto de tiempo devuelve lo calculado con `parcial: true` y un aviso por cada cifra afectada.
 */
export async function obtenerResumenInventario(opts: OpcionesResumenInventario = {}): Promise<ResumenInventario> {
  const rango = resolverRangoMerma(opts);
  if (!rango) throw new Error('Rango de fechas inválido: usa desde y hasta (YYYY-MM-DD) con desde <= hasta.');
  const clave = `valor:${opts.incluirValor === true ? 1 : 0}|${rango.desde}|${rango.hasta}`;
  return cacheResumen.obtener(clave, () => calcularResumen(opts, rango));
}
