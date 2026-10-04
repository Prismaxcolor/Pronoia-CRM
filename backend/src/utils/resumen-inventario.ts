/**
 * Resumen agregado del inventario (base de la pantalla nueva de /inventario): lógica pura, sin BD.
 *
 * Fuente de los kilos: el inventario por almacén (obtenerInventarioAlmacen), el mismo
 * cálculo que la pantalla vieja. En él un lote es UNA línea (destinoTipo 'lote') y el material
 * sin lote es una línea por producto, así que lo pesado a un lote por compra NO se cuenta dos
 * veces (en stock_almacen() SQL sí: allí el lote se atribuye también a sus productos).
 *
 * Valor del inventario (decisión de Julio, 2026-10-03), dos cifras SEPARADAS:
 *  - materiales sin lote, a COSTO de compra (promedio ponderado por producto);
 *  - lotes, a precio estimado de VENTA cargado a mano (los lotes mezclan materiales y no se costean).
 * Nunca se suman entre sí ni se inventan precios: se informan los kilos sin costo / sin precio.
 */
import { resumirEmbalado, type EmbalajeParaResumen } from './embalaje-lote.js';
import type { ClaseLote } from './lote-clasificacion.js';
import type { ConfiguracionInventario } from '../schemas/configuracion-inventario.js';
import type { FilaMerma, ResumenMerma } from './merma-transformacion.js';
import type { ResumenMermaPorTipo } from './merma-tipificada.js';

const redondear = (n: number, d: number): number => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f + 0;
};
const kg = (n: number) => redondear(n, 3);
const usd = (n: number) => redondear(n, 2);

// ---- entradas ---------------------------------------------------------------

export interface ArticuloEntrada {
  productoId: string;
  nombre: string;
  destinoTipo: 'mpp' | 'lote' | 'sin_movimiento';
  loteId: string | null;
  stock: number;
}

export interface GrupoEntrada {
  tipoMaterialId: string | null;
  nombreCategoria: string;
  articulos: ReadonlyArray<ArticuloEntrada>;
}

export interface InventarioAlmacenEntrada {
  almacenId: string;
  nombre: string;
  /** false = almacén archivado. Su stock cuenta igual (los lotes y embalajes no distinguen por activo). Por defecto true. */
  activo?: boolean;
  grupos: ReadonlyArray<GrupoEntrada>;
}

export interface LoteEntrada {
  id: string;
  nombre: string;
  activo: boolean;
  clase: ClaseLote;
  precioEstimadoKg: number | null;
  precioEstimadoActualizadoEn: string | null;
  /** lotes.fase tal como está en la BD (por_procesar | procesado); ausente/null si no se definió. */
  fase?: string | null;
}

export interface CostoProducto {
  /** Costo promedio ponderado USD/kg de las facturas de compra vigentes. */
  costoPromedioKg: number;
  kgFacturados: number;
}

export interface EmbalajeEntrada extends EmbalajeParaResumen {
  loteId: string;
}

export interface EntradaResumen {
  almacenes: ReadonlyArray<InventarioAlmacenEntrada>;
  lotes: ReadonlyArray<LoteEntrada>;
  embalajes: ReadonlyArray<EmbalajeEntrada>;
  /** Productos marcados como NO vendibles (catalizador entero). */
  productosNoVendibles: ReadonlySet<string>;
  costos: ReadonlyMap<string, CostoProducto>;
  config: ConfiguracionInventario;
}

// ---- salida -----------------------------------------------------------------

export interface CategoriaResumen {
  tipoMaterialId: string | null;
  nombre: string;
  kg: number;
  /** Los tres campos de costo se omiten cuando el usuario no puede ver valores (valorOculto). */
  kgConCosto?: number;
  kgSinCosto?: number;
  /** Valor a costo de los kg con costo registrado. */
  valorCostoUsd?: number;
}

export interface ProductoSinCosto {
  productoId: string;
  nombre: string;
  kg: number;
}

export interface LoteResumen {
  loteId: string;
  nombre: string;
  activo: boolean;
  clase: ClaseLote;
  stockKg: number;
  precioEstimadoKg: number | null;
  precioEstimadoActualizadoEn: string | null;
  /** stock x precio estimado; null si el lote no tiene precio. */
  valorEstimadoUsd: number | null;
  embaladoKg: number;
  embaladoMarcadoKg: number;
  enSacaKg: number;
  embaladoMayorQueStock: boolean;
  porAlmacen: Array<{ almacenId: string; stockKg: number }>;
}

export interface ValorInventario {
  costoMateriales: {
    valorUsd: number;
    kgConCosto: number;
    kgSinCosto: number;
    /** Kilos de material con stock negativo (no se valoran). */
    kgNegativos: number;
    productosSinCosto: ProductoSinCosto[];
  };
  ventaEstimadaLotes: {
    valorUsd: number;
    kgConPrecio: number;
    kgSinPrecio: number;
    lotesSinPrecio: Array<{ loteId: string; nombre: string; stockKg: number }>;
  };
}

export interface ResumenInventarioBase {
  almacenes: Array<{ almacenId: string; nombre: string; activo: boolean; totalKg: number }>;
  totalKg: number;
  materiales: {
    totalKg: number;
    porCategoria: CategoriaResumen[];
    /** Material cuyo producto está marcado como no vendible (hoy: catalizador entero). */
    kgNoVendible: number;
  };
  lotes: {
    totalKg: number;
    porClase: Array<{ clase: ClaseLote; kg: number; lotes: number }>;
    items: LoteResumen[];
  };
  exportacion: { stockKg: number; listoKg: number; enSacaKg: number };
  /**
   * Valor del inventario (costos de compra y precios de venta). null cuando el usuario no tiene
   * permiso de facturación: en ese caso valorOculto es true y ni los costos se calculan.
   */
  valor: ValorInventario | null;
  valorOculto: boolean;
  contenedor: {
    metaKg: number;
    /** Kilos embalados/listos de lotes de exportación (recortados al stock). */
    listoKg: number;
    faltanKg: number;
    progresoPct: number;
    /** Desglose por lote de exportación (Lote 1-4). */
    porLote: Array<{ loteId: string; nombre: string; stockKg: number; listoKg: number; enSacaKg: number }>;
  };
}

// ---- cálculo ----------------------------------------------------------------

const ORDEN_CLASES: ClaseLote[] = ['exportacion', 'trabajo', 'otro'];

/** Costo promedio ponderado por producto a partir de líneas de factura de compra vigentes
 *  (peso facturado y subtotal). Ignora líneas sin peso o sin valor. */
export function costoPromedioPorProducto(
  lineas: ReadonlyArray<{ productoId: string; peso: number; subtotal: number }>
): Map<string, CostoProducto> {
  const acumulado = new Map<string, { peso: number; valor: number }>();
  for (const l of lineas) {
    if (!Number.isFinite(l.peso) || !Number.isFinite(l.subtotal) || l.peso <= 0 || l.subtotal < 0) continue;
    const a = acumulado.get(l.productoId) ?? { peso: 0, valor: 0 };
    acumulado.set(l.productoId, { peso: a.peso + l.peso, valor: a.valor + l.subtotal });
  }
  const costos = new Map<string, CostoProducto>();
  for (const [productoId, a] of acumulado) {
    if (a.peso > 0) costos.set(productoId, { costoPromedioKg: a.valor / a.peso, kgFacturados: kg(a.peso) });
  }
  return costos;
}

interface MaterialAcumulado {
  productoId: string;
  nombre: string;
  tipoMaterialId: string | null;
  categoria: string;
  kg: number;
}

function acumular(almacenes: ReadonlyArray<InventarioAlmacenEntrada>) {
  const materiales = new Map<string, MaterialAcumulado>();
  const lotes = new Map<string, Map<string, number>>(); // loteId -> almacenId -> kg
  for (const alm of almacenes) {
    for (const g of alm.grupos) {
      for (const a of g.articulos) {
        if (!Number.isFinite(a.stock)) continue;
        if (a.destinoTipo === 'lote' && a.loteId) {
          const porAlmacen = lotes.get(a.loteId) ?? new Map<string, number>();
          porAlmacen.set(alm.almacenId, (porAlmacen.get(alm.almacenId) ?? 0) + a.stock);
          lotes.set(a.loteId, porAlmacen);
        } else if (a.destinoTipo === 'mpp') {
          const previo = materiales.get(a.productoId);
          materiales.set(a.productoId, {
            productoId: a.productoId, nombre: a.nombre, tipoMaterialId: g.tipoMaterialId, categoria: g.nombreCategoria,
            kg: (previo?.kg ?? 0) + a.stock,
          });
        }
      }
    }
  }
  return { materiales, lotes };
}

export function construirResumenInventario(entrada: EntradaResumen): ResumenInventarioBase & { valor: ValorInventario } {
  const { materiales, lotes: stockLotes } = acumular(entrada.almacenes);

  // ---- materiales sin lote, a costo
  const porCategoria = new Map<string, Required<CategoriaResumen>>();
  const sinCosto: ProductoSinCosto[] = [];
  let kgConCosto = 0;
  let kgSinCosto = 0;
  let kgNegativos = 0;
  let valorCosto = 0;
  let kgNoVendible = 0;
  let totalMateriales = 0;
  for (const m of materiales.values()) {
    totalMateriales += m.kg;
    if (entrada.productosNoVendibles.has(m.productoId)) kgNoVendible += m.kg;
    const clave = m.tipoMaterialId ?? '__sin__';
    const cat = porCategoria.get(clave) ?? {
      tipoMaterialId: m.tipoMaterialId, nombre: m.categoria, kg: 0, kgConCosto: 0, kgSinCosto: 0, valorCostoUsd: 0,
    };
    cat.kg += m.kg;
    if (m.kg > 0) {
      const costo = entrada.costos.get(m.productoId);
      if (costo) {
        cat.kgConCosto += m.kg;
        cat.valorCostoUsd += m.kg * costo.costoPromedioKg;
        kgConCosto += m.kg;
        valorCosto += m.kg * costo.costoPromedioKg;
      } else {
        cat.kgSinCosto += m.kg;
        kgSinCosto += m.kg;
        sinCosto.push({ productoId: m.productoId, nombre: m.nombre, kg: kg(m.kg) });
      }
    } else if (m.kg < 0) {
      kgNegativos += m.kg;
    }
    porCategoria.set(clave, cat);
  }

  // ---- lotes
  const embalajesPorLote = new Map<string, EmbalajeEntrada[]>();
  for (const e of entrada.embalajes) embalajesPorLote.set(e.loteId, [...(embalajesPorLote.get(e.loteId) ?? []), e]);

  const items: LoteResumen[] = entrada.lotes
    .map((l): LoteResumen => {
      const porAlmacen = [...(stockLotes.get(l.id) ?? new Map<string, number>())].map(([almacenId, s]) => ({ almacenId, stockKg: kg(s) }));
      const stockKg = kg(porAlmacen.reduce((a, p) => a + p.stockKg, 0));
      const emb = resumirEmbalado(stockKg, embalajesPorLote.get(l.id) ?? []);
      const valorEstimado = l.precioEstimadoKg != null ? usd(Math.max(stockKg, 0) * l.precioEstimadoKg) : null;
      return {
        loteId: l.id, nombre: l.nombre, activo: l.activo, clase: l.clase, stockKg,
        precioEstimadoKg: l.precioEstimadoKg, precioEstimadoActualizadoEn: l.precioEstimadoActualizadoEn,
        valorEstimadoUsd: valorEstimado,
        embaladoKg: emb.embaladoKg, embaladoMarcadoKg: emb.embaladoMarcadoKg, enSacaKg: emb.enSacaKg,
        embaladoMayorQueStock: emb.embaladoMayorQueStock, porAlmacen,
      };
    })
    // un lote archivado sin stock ni embalajes no aporta nada a la pantalla
    .filter(l => l.activo || Math.abs(l.stockKg) > 0.005 || l.embaladoMarcadoKg > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));

  const stockLotesTotal = kg(items.reduce((a, l) => a + l.stockKg, 0));
  const porClase = ORDEN_CLASES.map(clase => {
    const delGrupo = items.filter(l => l.clase === clase);
    return { clase, kg: kg(delGrupo.reduce((a, l) => a + l.stockKg, 0)), lotes: delGrupo.length };
  });

  const conPrecio = items.filter(l => l.valorEstimadoUsd != null && l.stockKg > 0);
  const sinPrecio = items.filter(l => l.precioEstimadoKg == null && l.stockKg > 0.005);

  // ---- exportación / contenedor
  const exportacion = items.filter(l => l.clase === 'exportacion');
  const listoKg = kg(exportacion.reduce((a, l) => a + l.embaladoKg, 0));
  const metaKg = entrada.config.metaContenedorKg;

  return {
    almacenes: entrada.almacenes.map(a => ({
      almacenId: a.almacenId,
      nombre: a.nombre,
      activo: a.activo !== false,
      totalKg: kg(a.grupos.reduce((s, g) => s + g.articulos.reduce((t, x) => t + (Number.isFinite(x.stock) ? x.stock : 0), 0), 0)),
    })),
    totalKg: kg(totalMateriales + stockLotesTotal),
    materiales: {
      totalKg: kg(totalMateriales),
      porCategoria: [...porCategoria.values()]
        .map(c => ({ ...c, kg: kg(c.kg), kgConCosto: kg(c.kgConCosto), kgSinCosto: kg(c.kgSinCosto), valorCostoUsd: usd(c.valorCostoUsd) }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      kgNoVendible: kg(kgNoVendible),
    },
    lotes: { totalKg: stockLotesTotal, porClase, items },
    exportacion: {
      stockKg: kg(exportacion.reduce((a, l) => a + l.stockKg, 0)),
      listoKg,
      enSacaKg: kg(exportacion.reduce((a, l) => a + l.enSacaKg, 0)),
    },
    valorOculto: false,
    valor: {
      costoMateriales: {
        valorUsd: usd(valorCosto),
        kgConCosto: kg(kgConCosto),
        kgSinCosto: kg(kgSinCosto),
        kgNegativos: kg(kgNegativos),
        productosSinCosto: sinCosto.sort((a, b) => b.kg - a.kg),
      },
      ventaEstimadaLotes: {
        valorUsd: usd(conPrecio.reduce((a, l) => a + (l.valorEstimadoUsd ?? 0), 0)),
        kgConPrecio: kg(conPrecio.reduce((a, l) => a + l.stockKg, 0)),
        kgSinPrecio: kg(sinPrecio.reduce((a, l) => a + l.stockKg, 0)),
        lotesSinPrecio: sinPrecio.map(l => ({ loteId: l.loteId, nombre: l.nombre, stockKg: l.stockKg })),
      },
    },
    contenedor: {
      metaKg,
      listoKg,
      faltanKg: kg(Math.max(metaKg - listoKg, 0)),
      progresoPct: metaKg > 0 ? redondear(Math.min((listoKg / metaKg) * 100, 100), 1) : 0,
      porLote: exportacion.map(l => ({ loteId: l.loteId, nombre: l.nombre, stockKg: l.stockKg, listoKg: l.embaladoKg, enSacaKg: l.enSacaKg })),
    },
  };
}

/**
 * Quita del resumen todo lo que revela costos de compra o precios de venta (usuarios sin
 * facturacion:ver). Devuelve una copia; los kilos, el embalado y el contenedor no cambian.
 */
export function ocultarValor(resumen: ResumenInventarioBase): ResumenInventarioBase {
  return {
    ...resumen,
    valor: null,
    valorOculto: true,
    materiales: {
      ...resumen.materiales,
      porCategoria: resumen.materiales.porCategoria.map(({ tipoMaterialId, nombre, kg }) => ({ tipoMaterialId, nombre, kg })),
    },
    lotes: {
      ...resumen.lotes,
      items: resumen.lotes.items.map(l => ({ ...l, precioEstimadoKg: null, precioEstimadoActualizadoEn: null, valorEstimadoUsd: null })),
    },
  };
}

// ---- períodos de merma -------------------------------------------------------

const DIA_MS = 86_400_000;
const aFecha = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const aMs = (f: string) => Date.parse(`${f}T00:00:00.000Z`);

export interface RangoFechas {
  desde: string;
  hasta: string;
}

/** Período inmediatamente anterior y de la misma duración (en días, inclusivo). */
export function rangoAnterior(r: RangoFechas): RangoFechas {
  const dias = Math.round((aMs(r.hasta) - aMs(r.desde)) / DIA_MS) + 1;
  return { desde: aFecha(aMs(r.desde) - dias * DIA_MS), hasta: aFecha(aMs(r.desde) - DIA_MS) };
}

/** Rango por defecto: los últimos `dias` días hasta `hoy` (inclusive). */
export function rangoPorDefecto(hoy: string, dias = 30): RangoFechas {
  return { desde: aFecha(aMs(hoy) - (dias - 1) * DIA_MS), hasta: hoy };
}

// ---- merma del período ---------------------------------------------------------

export interface ReporteMermaParaResumen {
  totales: ResumenMerma;
  porTipo: ResumenMermaPorTipo;
  filas: ReadonlyArray<FilaMerma>;
}

export interface MermaPeriodoResumen extends RangoFechas {
  transformaciones: number;
  kgEntrada: number;
  kgSalida: number;
  kgMerma: number;
  pctMerma: number;
  tipos: ResumenMermaPorTipo['tipos'];
  sinClasificar: ResumenMermaPorTipo['sinClasificar'];
}

export interface ResumenMermaInventario {
  umbralPct: number;
  actual: MermaPeriodoResumen;
  anterior: MermaPeriodoResumen;
  variacion: {
    kgMerma: number;
    /** Diferencia en puntos porcentuales (actual - anterior); null si el período anterior no tiene entrada. */
    pctMermaPuntos: number | null;
  };
  /** La merma del período supera el umbral configurado. */
  sobreUmbral: boolean;
  /** Transformaciones del período cuya merma supera el umbral (las 20 más altas). */
  transformacionesAltas: Array<{ id: string; codigo: string | null; categoria: string; fecha: string; kgMerma: number; pctMerma: number }>;
}

const MAX_TRANSFORMACIONES_ALTAS = 20;

function periodo(rango: RangoFechas, r: ReporteMermaParaResumen): MermaPeriodoResumen {
  return {
    ...rango,
    transformaciones: r.totales.transformaciones,
    kgEntrada: r.totales.kgEntrada,
    kgSalida: r.totales.kgSalida,
    kgMerma: r.totales.kgMerma,
    pctMerma: r.totales.pctMerma,
    tipos: r.porTipo.tipos,
    sinClasificar: r.porTipo.sinClasificar,
  };
}

export function armarResumenMerma(
  rangoActual: RangoFechas,
  actual: ReporteMermaParaResumen,
  rangoPrevio: RangoFechas,
  anterior: ReporteMermaParaResumen,
  umbralPct: number
): ResumenMermaInventario {
  return {
    umbralPct,
    actual: periodo(rangoActual, actual),
    anterior: periodo(rangoPrevio, anterior),
    variacion: {
      kgMerma: kg(actual.totales.kgMerma - anterior.totales.kgMerma),
      pctMermaPuntos: anterior.totales.kgEntrada > 0 ? redondear(actual.totales.pctMerma - anterior.totales.pctMerma, 2) : null,
    },
    sobreUmbral: actual.totales.kgEntrada > 0 && actual.totales.pctMerma > umbralPct,
    transformacionesAltas: actual.filas
      .filter(f => f.pctMerma > umbralPct)
      .sort((a, b) => b.pctMerma - a.pctMerma)
      .slice(0, MAX_TRANSFORMACIONES_ALTAS)
      .map(f => ({ id: f.id, codigo: f.codigo, categoria: f.categoria, fecha: f.fecha, kgMerma: f.kgMerma, pctMerma: f.pctMerma })),
  };
}
