/**
 * Filas de detalle y tarjetas de la pantalla nueva de /inventario: lógica pura, sin BD.
 *
 * Los kilos salen del MISMO inventario por almacén que el resumen (obtenerInventarioAlmacen): un lote es
 * una línea (destinoTipo 'lote') y el material sin lote, una por producto, así que lo pesado a un lote por
 * compra no se cuenta dos veces. Aquí solo se reparte y se presenta: no se recalcula el stock.
 *
 * Valor: materiales a COSTO, lotes a precio estimado de VENTA; nunca se suman entre sí.
 */
import type {
  AntiguedadEstimada,
  EtapasBarra,
  FilaDetalleInventario,
  GrupoDetalle,
  KgAlmacen,
  KgPorEtapa,
  RendimientoExportacion,
  TarjetaInventario,
  TarjetaVista,
  VistaInventario,
} from '../../../shared/types/inventario-pantalla.js';
import { antiguedadEstimada, combinarAntiguedades, type EntradaFechada } from './antiguedad-inventario.js';
import { resumirEmbalado } from './embalaje-lote.js';
import {
  claveCategoriaLote,
  coincideCategoria,
  destinoBasuraDeNombre,
  esCategoriaBasura,
  esCategoriaConLimpieza,
  esCategoriaPcb,
  etapaDeLote,
  etapaDeMaterial,
  faseDeLote,
  limpiezaDeMaterial,
  nombreCategoriaLote,
  normalizarTexto,
  sinEtapas,
  vistaDeCategoria,
  vistaDeClaseLote,
} from './inventario-vistas.js';
import {
  claveLote,
  claveProducto,
  entradasFechadas,
  type MovimientosInventario,
  type ProductoMeta,
  type TransformacionMov,
} from './movimientos-pantalla.js';
import { construirFilaMerma } from './merma-transformacion.js';
import type {
  CostoProducto,
  EmbalajeEntrada,
  InventarioAlmacenEntrada,
  LoteEntrada,
  RangoFechas,
} from './resumen-inventario.js';

const redondear = (n: number, d: number): number => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d + 0;
const kg3 = (n: number) => redondear(n, 3);
const usd2 = (n: number) => redondear(n, 2);
/** Por debajo de esto un stock es ruido de redondeo, no inventario. */
const UMBRAL_KG = 0.005;

const VISTAS: VistaInventario[] = ['exportacion', 'venta_nacional', 'trabajo_interno', 'otras'];
const SIN_CATEGORIA = 'Sin categoría';

export interface EntradaFilas {
  almacenes: ReadonlyArray<InventarioAlmacenEntrada>;
  lotes: ReadonlyArray<LoteEntrada>;
  embalajes: ReadonlyArray<EmbalajeEntrada>;
  costos: ReadonlyMap<string, CostoProducto>;
  movimientos: MovimientosInventario;
  /** YYYY-MM-DD. */
  hoy: string;
  /** Período de los despachos. */
  rango: RangoFechas;
  /** Limita todo a un almacén (uuid). */
  almacenId: string | null;
  valorOculto: boolean;
}

interface MaterialStock {
  productoId: string;
  nombre: string;
  tipoMaterialId: string | null;
  categoria: string;
  porAlmacen: Map<string, number>;
}

function acumularStock(almacenes: ReadonlyArray<InventarioAlmacenEntrada>) {
  const materiales = new Map<string, MaterialStock>();
  const lotes = new Map<string, Map<string, number>>();
  for (const alm of almacenes) {
    for (const g of alm.grupos) {
      for (const a of g.articulos) {
        if (!Number.isFinite(a.stock)) continue;
        if (a.destinoTipo === 'lote' && a.loteId) {
          const porAlmacen = lotes.get(a.loteId) ?? new Map<string, number>();
          porAlmacen.set(alm.almacenId, (porAlmacen.get(alm.almacenId) ?? 0) + a.stock);
          lotes.set(a.loteId, porAlmacen);
        } else if (a.destinoTipo === 'mpp') {
          const previo = materiales.get(a.productoId) ?? {
            productoId: a.productoId, nombre: a.nombre, tipoMaterialId: g.tipoMaterialId, categoria: g.nombreCategoria,
            porAlmacen: new Map<string, number>(),
          };
          previo.porAlmacen.set(alm.almacenId, (previo.porAlmacen.get(alm.almacenId) ?? 0) + a.stock);
          materiales.set(a.productoId, previo);
        }
      }
    }
  }
  return { materiales, lotes };
}

function listaAlmacenes(porAlmacen: ReadonlyMap<string, number>, nombres: ReadonlyMap<string, string>, solo: string | null): KgAlmacen[] {
  return [...porAlmacen.entries()]
    .filter(([id, kg]) => (!solo || id === solo) && Math.abs(kg) >= UMBRAL_KG)
    .map(([almacenId, kg]) => ({ almacenId, almacenNombre: nombres.get(almacenId) ?? '—', kg: kg3(kg) }))
    .sort((a, b) => a.almacenNombre.localeCompare(b.almacenNombre, 'es', { numeric: true }));
}

const BASE_FILA = {
  embaladoKg: null, enSacaKg: null, costoPromedioKg: null, valorCostoUsd: null,
  precioEstimadoKg: null, valorEstimadoUsd: null, dias: null, clase: null,
  fase: null, limpieza: null, limpiezaOrigen: null, destinoBasura: null, esClasificacionCompra: false,
} as const;

/**
 * Marcas del material: limpieza (productos.estado_limpieza si está definido; si no, derivada del nombre),
 * destino de basura (derivado del nombre) y clasificación PCB (de su categoría).
 */
function marcasDeMaterial(meta: Pick<ProductoMeta, 'nombre' | 'categoria' | 'estadoLimpieza'>) {
  return {
    ...limpiezaDeMaterial(meta.categoria, meta.nombre, meta.estadoLimpieza),
    destinoBasura: esCategoriaBasura(meta.categoria) ? destinoBasuraDeNombre(meta.nombre) : null,
    esClasificacionCompra: esCategoriaPcb(meta.categoria),
  };
}

function metaDe(productos: ReadonlyMap<string, ProductoMeta>, id: string): ProductoMeta {
  return productos.get(id) ?? { id, nombre: '—', tipoMaterialId: null, categoria: SIN_CATEGORIA };
}

function filaMaterialFuera(
  prefijo: 'transf' | 'desp',
  etapa: 'en_proceso' | 'despachado',
  meta: ProductoMeta,
  kg: number,
  almacenes: KgAlmacen[]
): FilaDetalleInventario {
  const kgPorEtapa: KgPorEtapa = sinEtapas();
  if (etapa === 'en_proceso') kgPorEtapa.enProceso = kg3(kg);
  else kgPorEtapa.despachado = kg3(kg);
  return {
    ...BASE_FILA,
    ...marcasDeMaterial(meta),
    id: `${prefijo}:p:${meta.id}`, tipo: 'material', enGalpon: false, material: meta.nombre, productoId: meta.id, loteId: null,
    categoriaClave: meta.tipoMaterialId ?? '__sin__', categoria: meta.categoria, vista: vistaDeCategoria(meta.categoria),
    etapa, kgPorEtapa, kg: kg3(kg), porAlmacen: almacenes,
  };
}

function filaLoteFuera(
  prefijo: 'transf' | 'desp',
  etapa: 'en_proceso' | 'despachado',
  lote: LoteEntrada,
  kg: number,
  almacenes: KgAlmacen[]
): FilaDetalleInventario {
  const kgPorEtapa: KgPorEtapa = sinEtapas();
  if (etapa === 'en_proceso') kgPorEtapa.enProceso = kg3(kg);
  else kgPorEtapa.despachado = kg3(kg);
  return {
    ...BASE_FILA,
    id: `${prefijo}:l:${lote.id}`, tipo: 'lote', enGalpon: false, material: lote.nombre, productoId: null, loteId: lote.id,
    categoriaClave: claveCategoriaLote(lote.clase), categoria: nombreCategoriaLote(lote.clase), vista: vistaDeClaseLote(lote.clase),
    clase: lote.clase, fase: faseDeLote(lote.clase, lote.fase, lote.nombre), etapa, kgPorEtapa, kg: kg3(kg), porAlmacen: almacenes,
  };
}

interface ItemFuera {
  clave: string;
  kg: number;
  almacenId: string | null;
}

/** Suma por clave, conservando los kg por almacén (para las filas fuera del galpón). */
function sumarPorClave(items: ReadonlyArray<ItemFuera>) {
  const mapa = new Map<string, { kg: number; porAlmacen: Map<string, number> }>();
  for (const it of items) {
    const acc = mapa.get(it.clave) ?? { kg: 0, porAlmacen: new Map<string, number>() };
    acc.kg += it.kg;
    if (it.almacenId) acc.porAlmacen.set(it.almacenId, (acc.porAlmacen.get(it.almacenId) ?? 0) + it.kg);
    mapa.set(it.clave, acc);
  }
  return mapa;
}

/** Kg retirados a transformaciones en estado 'bruto' (ya salieron del stock): material o lote de origen (PCB). */
function retirosEnProceso(
  transformaciones: readonly TransformacionMov[],
  almacenId: string | null
): ItemFuera[] {
  const items: ItemFuera[] = [];
  for (const t of transformaciones) {
    if (t.estado !== 'bruto' || (almacenId && t.almacenId !== almacenId)) continue;
    if (t.categoria === 'pcb' && t.loteOrigenId) {
      items.push({ clave: claveLote(t.loteOrigenId), kg: t.pesoNeto, almacenId: t.almacenId });
      continue;
    }
    for (const e of t.entradas) if (e.productoId) items.push({ clave: claveProducto(e.productoId), kg: e.pesoKg, almacenId: t.almacenId });
  }
  return items.filter(i => Number.isFinite(i.kg) && i.kg > 0);
}

function despachosDelPeriodo(
  tickets: MovimientosInventario['tickets'],
  rango: RangoFechas,
  almacenId: string | null
): ItemFuera[] {
  const items: ItemFuera[] = [];
  for (const t of tickets) {
    if (t.tipo !== 'venta' || !t.fecha || t.fecha < rango.desde || t.fecha > rango.hasta) continue;
    if (almacenId && t.almacenId !== almacenId) continue;
    for (const d of t.detalle) {
      const clave = d.loteId ? claveLote(d.loteId) : d.productoId ? claveProducto(d.productoId) : null;
      if (clave && Number.isFinite(d.pesoNeto) && d.pesoNeto > 0) items.push({ clave, kg: d.pesoNeto, almacenId: t.almacenId });
    }
  }
  return items;
}

/**
 * Todas las filas de la tabla única, sin filtrar por texto/categoría/vista (ver filtrarFilas):
 * stock en galpón (materiales y lotes) + kg en transformación 'bruto' + despachos del período.
 * Con `almacenId` todo se limita a ese almacén.
 */
export function construirFilasDetalle(e: EntradaFilas): FilaDetalleInventario[] {
  return construirFilasDetalleConAvisos(e).filas;
}

export const AVISO_ANTIGUEDAD_CON_ALMACEN = 'antigüedad aproximada con filtro de almacén';

/** Igual que construirFilasDetalle, y devuelve además los avisos del cálculo (hoy: la antigüedad con filtro de almacén). */
export function construirFilasDetalleConAvisos(e: EntradaFilas): { filas: FilaDetalleInventario[]; avisos: string[] } {
  const { materiales, lotes: stockLotes } = acumularStock(e.almacenes);
  const nombres = new Map(e.almacenes.map(a => [a.almacenId, a.nombre]));
  const productos = new Map(e.movimientos.productos.map(p => [p.id, p]));
  const entradas = entradasFechadas(e.movimientos);
  let antiguedadAproximada = false;
  /**
   * Entradas con fecha de un material o lote. Con filtro de almacén solo cuentan las de ese almacén; una
   * entrada sin almacén conocido no se asigna a ninguno (queda sin fecha) y se avisa.
   */
  const entradasDe = (clave: string): EntradaFechada[] => {
    const todas = entradas.get(clave) ?? [];
    if (!e.almacenId) return todas;
    if (todas.some(x => !x.almacenId)) antiguedadAproximada = true;
    return todas.filter(x => x.almacenId === e.almacenId);
  };
  const lotePorId = new Map(e.lotes.map(l => [l.id, l]));
  const filas: FilaDetalleInventario[] = [];

  for (const m of materiales.values()) {
    const kgAlm = e.almacenId ? m.porAlmacen.get(e.almacenId) ?? 0 : [...m.porAlmacen.values()].reduce((a, b) => a + b, 0);
    if (Math.abs(kgAlm) < UMBRAL_KG) continue;
    const vista = vistaDeCategoria(m.categoria);
    const etapa = etapaDeMaterial(vista);
    const kgPorEtapa = sinEtapas();
    if (etapa === 'listo') kgPorEtapa.listo = kg3(kgAlm);
    else kgPorEtapa.recibido = kg3(kgAlm);
    const costo = e.valorOculto ? undefined : e.costos.get(m.productoId);
    filas.push({
      ...BASE_FILA,
      ...marcasDeMaterial({ nombre: m.nombre, categoria: m.categoria, estadoLimpieza: productos.get(m.productoId)?.estadoLimpieza }),
      id: `mat:${m.productoId}`, tipo: 'material', enGalpon: true, material: m.nombre, productoId: m.productoId, loteId: null,
      categoriaClave: m.tipoMaterialId ?? '__sin__', categoria: m.categoria, vista, etapa, kgPorEtapa, kg: kg3(kgAlm),
      costoPromedioKg: costo ? redondear(costo.costoPromedioKg, 4) : null,
      valorCostoUsd: costo && kgAlm > 0 ? usd2(kgAlm * costo.costoPromedioKg) : null,
      dias: antiguedadEstimada(kgAlm, entradasDe(claveProducto(m.productoId)), e.hoy),
      porAlmacen: listaAlmacenes(m.porAlmacen, nombres, e.almacenId),
    });
  }

  const embalajesPorLote = new Map<string, EmbalajeEntrada[]>();
  for (const emb of e.embalajes) embalajesPorLote.set(emb.loteId, [...(embalajesPorLote.get(emb.loteId) ?? []), emb]);
  for (const lote of e.lotes) {
    const porAlmacen = stockLotes.get(lote.id) ?? new Map<string, number>();
    const kgAlm = e.almacenId ? porAlmacen.get(e.almacenId) ?? 0 : [...porAlmacen.values()].reduce((a, b) => a + b, 0);
    if (Math.abs(kgAlm) < UMBRAL_KG) continue;
    const delLote = embalajesPorLote.get(lote.id) ?? [];
    const emb = resumirEmbalado(kg3(kgAlm), e.almacenId ? delLote.filter(x => x.almacenId === e.almacenId) : delLote);
    const fase = faseDeLote(lote.clase, lote.fase, lote.nombre);
    const { etapa, kgPorEtapa } = etapaDeLote(lote.clase, emb.stockKg, emb.embaladoKg, emb.enSacaKg, fase);
    const precio = e.valorOculto ? null : lote.precioEstimadoKg;
    filas.push({
      ...BASE_FILA,
      id: `lote:${lote.id}`, tipo: 'lote', enGalpon: true, material: lote.nombre, productoId: null, loteId: lote.id,
      categoriaClave: claveCategoriaLote(lote.clase), categoria: nombreCategoriaLote(lote.clase), vista: vistaDeClaseLote(lote.clase),
      clase: lote.clase, fase, etapa, kgPorEtapa: { ...kgPorEtapa, listo: kg3(kgPorEtapa.listo), enProceso: kg3(kgPorEtapa.enProceso), recibido: kg3(kgPorEtapa.recibido) },
      kg: emb.stockKg, embaladoKg: emb.embaladoKg, enSacaKg: emb.enSacaKg,
      precioEstimadoKg: precio,
      valorEstimadoUsd: precio != null ? usd2(Math.max(emb.stockKg, 0) * precio) : null,
      dias: antiguedadEstimada(kgAlm, entradasDe(claveLote(lote.id)), e.hoy),
      porAlmacen: listaAlmacenes(porAlmacen, nombres, e.almacenId),
    });
  }

  const fuera = (
    prefijo: 'transf' | 'desp',
    etapa: 'en_proceso' | 'despachado',
    items: ItemFuera[]
  ) => {
    for (const [clave, acc] of sumarPorClave(items)) {
      if (acc.kg < UMBRAL_KG) continue;
      const almacenes = listaAlmacenes(acc.porAlmacen, nombres, e.almacenId);
      const id = clave.slice(2);
      if (clave.startsWith('l:')) {
        const lote = lotePorId.get(id);
        if (lote) filas.push(filaLoteFuera(prefijo, etapa, lote, acc.kg, almacenes));
      } else {
        filas.push(filaMaterialFuera(prefijo, etapa, metaDe(productos, id), acc.kg, almacenes));
      }
    }
  };
  fuera('transf', 'en_proceso', retirosEnProceso(e.movimientos.transformaciones, e.almacenId));
  fuera('desp', 'despachado', despachosDelPeriodo(e.movimientos.tickets, e.rango, e.almacenId));
  return { filas, avisos: antiguedadAproximada ? [AVISO_ANTIGUEDAD_CON_ALMACEN] : [] };
}

/** Filtros de texto, categoría y vista sobre las filas ya construidas (no recalcula kg). */
export function filtrarFilas(
  filas: readonly FilaDetalleInventario[],
  filtros: { categoria?: string | null; q?: string | null; vista?: VistaInventario | null }
): FilaDetalleInventario[] {
  const q = normalizarTexto(filtros.q);
  return filas.filter(f => {
    if (filtros.vista && f.vista !== filtros.vista) return false;
    if (!coincideCategoria(f, filtros.categoria)) return false;
    return !q || normalizarTexto(f.material).includes(q) || normalizarTexto(f.categoria).includes(q);
  });
}

// ---- detalle: orden, grupos y totales ----------------------------------------------

const porCategoriaYKg = (a: FilaDetalleInventario, b: FilaDetalleInventario) =>
  a.categoria.localeCompare(b.categoria, 'es') || b.kg - a.kg || a.material.localeCompare(b.material, 'es');

export interface DetalleArmado {
  filas: FilaDetalleInventario[];
  grupos: GrupoDetalle[];
  totales: {
    kgEnGalpon: number;
    kgEnTransformacion: number;
    kgDespachado: number;
    valorCostoUsd: number | null;
    valorEstimadoUsd: number | null;
    kgClasificacionesCompraOcultas: number;
    valorClasificacionesCompraOcultasUsd: number | null;
  };
  limite: { maxFilas: number; totalFilas: number; truncado: boolean };
}

const suma = (xs: Iterable<number | null>) => { let s = 0; for (const x of xs) s += x ?? 0; return s; };

/** Ordena, agrupa por categoría y recorta a `maxFilas` (grupos y totales cuentan TODAS las filas). */
export function armarDetalle(
  filas: readonly FilaDetalleInventario[],
  maxFilas: number,
  valorOculto: boolean,
  kgClasificacionesCompraOcultas = 0,
  valorClasificacionesCompraOcultasUsd: number | null = null
): DetalleArmado {
  const ordenadas = [...filas].sort(porCategoriaYKg);
  const grupos = new Map<string, GrupoDetalle>();
  for (const f of ordenadas) {
    const g = grupos.get(f.categoriaClave) ?? {
      categoriaClave: f.categoriaClave, categoria: f.categoria, vista: f.vista, filas: 0, kg: 0,
      valorCostoUsd: valorOculto ? null : 0, valorEstimadoUsd: valorOculto ? null : 0,
    };
    g.filas += 1;
    if (f.enGalpon) g.kg += f.kg;
    if (!valorOculto) {
      g.valorCostoUsd = (g.valorCostoUsd ?? 0) + (f.valorCostoUsd ?? 0);
      g.valorEstimadoUsd = (g.valorEstimadoUsd ?? 0) + (f.valorEstimadoUsd ?? 0);
    }
    grupos.set(f.categoriaClave, g);
  }
  const enGalpon = ordenadas.filter(f => f.enGalpon);
  return {
    filas: ordenadas.slice(0, Math.max(maxFilas, 0)),
    grupos: [...grupos.values()].map(g => ({
      ...g, kg: kg3(g.kg),
      valorCostoUsd: g.valorCostoUsd == null ? null : usd2(g.valorCostoUsd),
      valorEstimadoUsd: g.valorEstimadoUsd == null ? null : usd2(g.valorEstimadoUsd),
    })),
    totales: {
      kgEnGalpon: kg3(suma(enGalpon.map(f => f.kg))),
      kgEnTransformacion: kg3(suma(ordenadas.filter(f => !f.enGalpon && f.etapa === 'en_proceso').map(f => f.kg))),
      kgDespachado: kg3(suma(ordenadas.filter(f => f.etapa === 'despachado').map(f => f.kg))),
      valorCostoUsd: valorOculto ? null : usd2(suma(ordenadas.map(f => f.valorCostoUsd))),
      valorEstimadoUsd: valorOculto ? null : usd2(suma(ordenadas.map(f => f.valorEstimadoUsd))),
      kgClasificacionesCompraOcultas: kg3(kgClasificacionesCompraOcultas),
      valorClasificacionesCompraOcultasUsd: valorOculto ? null : valorClasificacionesCompraOcultasUsd,
    },
    limite: { maxFilas, totalFilas: ordenadas.length, truncado: ordenadas.length > maxFilas },
  };
}

// ---- tarjetas -------------------------------------------------------------------------

type Agregado = Omit<TarjetaVista, 'vista' | 'tarjetas' | 'rendimiento' | 'desgloseLimpieza' | 'desgloseBasura' | 'desgloseFase'> & Pick<TarjetaVista, 'desgloseLimpieza' | 'desgloseBasura' | 'desgloseFase'> & { kgConCosto: number; kgConPrecio: number };

/** Suma las filas en las cifras de una tarjeta (la misma regla para categorías y para vistas). */
function agregarFilas(filas: readonly FilaDetalleInventario[], valorOculto: boolean): Agregado {
  const galpon = filas.filter(f => f.enGalpon);
  const materiales = galpon.filter(f => f.tipo === 'material' && f.kg > 0);
  const lotes = galpon.filter(f => f.tipo === 'lote' && f.kg > 0);
  const conCosto = materiales.filter(f => f.valorCostoUsd != null);
  const conPrecio = lotes.filter(f => f.valorEstimadoUsd != null);
  const valorCosto = suma(conCosto.map(f => f.valorCostoUsd));
  const valorEstimado = suma(conPrecio.map(f => f.valorEstimadoUsd));
  const kgConCosto = suma(conCosto.map(f => f.kg));
  const kgConPrecio = suma(conPrecio.map(f => f.kg));
  const etapas: EtapasBarra = {
    recibidoKg: kg3(suma(filas.map(f => f.kgPorEtapa.recibido))),
    enProcesoKg: kg3(suma(filas.map(f => f.kgPorEtapa.enProceso))),
    listoKg: kg3(suma(filas.map(f => f.kgPorEtapa.listo))),
  };
  const hayMateriales = galpon.some(f => f.tipo === 'material');
  const hayLotes = galpon.some(f => f.tipo === 'lote');
  return {
    kgEnGalpon: kg3(suma(galpon.map(f => f.kg))),
    enTransformacionKg: kg3(suma(filas.filter(f => !f.enGalpon && f.etapa === 'en_proceso').map(f => f.kg))),
    etapas,
    despachadoKg: kg3(suma(filas.filter(f => f.etapa === 'despachado').map(f => f.kg))),
    valorCostoUsd: valorOculto || !hayMateriales ? null : usd2(valorCosto),
    kgSinCosto: valorOculto || !hayMateriales ? null : kg3(suma(materiales.filter(f => f.valorCostoUsd == null).map(f => f.kg))),
    costoPromedioKg: valorOculto || kgConCosto <= 0 ? null : redondear(valorCosto / kgConCosto, 4),
    valorEstimadoUsd: valorOculto || !hayLotes ? null : usd2(valorEstimado),
    kgSinPrecio: valorOculto || !hayLotes ? null : kg3(suma(lotes.filter(f => f.valorEstimadoUsd == null).map(f => f.kg))),
    precioPromedioEstimadoKg: valorOculto || kgConPrecio <= 0 ? null : redondear(valorEstimado / kgConPrecio, 4),
    dias: combinarAntiguedades(galpon.map(f => f.dias)),
    desgloseLimpieza: galpon.some(f => f.tipo === 'material' && esCategoriaConLimpieza(f.categoria)) ? desgloseLimpieza(galpon) : null,
    desgloseBasura: galpon.some(f => f.tipo === 'material' && esCategoriaBasura(f.categoria)) ? desgloseBasura(galpon) : null,
    desgloseFase: galpon.some(f => f.tipo === 'lote' && f.clase === 'trabajo') ? desgloseFase(galpon) : null,
    kgConCosto: kg3(kgConCosto),
    kgConPrecio: kg3(kgConPrecio),
  };
}

function desgloseLimpieza(galpon: readonly FilaDetalleInventario[]) {
  const m = galpon.filter(f => f.tipo === 'material' && esCategoriaConLimpieza(f.categoria));
  const de = (l: FilaDetalleInventario['limpieza']) => kg3(suma(m.filter(f => f.limpieza === l).map(f => f.kg)));
  return { limpioKg: de('limpio'), sucioKg: de('sucio'), sinClasificarKg: de(null) };
}

function desgloseBasura(galpon: readonly FilaDetalleInventario[]) {
  const m = galpon.filter(f => f.tipo === 'material' && esCategoriaBasura(f.categoria));
  const de = (d: FilaDetalleInventario['destinoBasura']) => kg3(suma(m.filter(f => f.destinoBasura === d).map(f => f.kg)));
  return { recuperableKg: de('recuperable'), desechoKg: de('desecho'), sinClasificarKg: de(null) };
}

function desgloseFase(galpon: readonly FilaDetalleInventario[]) {
  const l = galpon.filter(f => f.tipo === 'lote' && f.clase === 'trabajo');
  const de = (fase: FilaDetalleInventario['fase']) => kg3(suma(l.filter(f => f.fase === fase).map(f => f.kg)));
  return { porProcesarKg: de('por_procesar'), procesadoKg: de('procesado'), sinFaseKg: de(null) };
}

/** Separa las clasificaciones de compra PCB (no son inventario principal) del resto. */
export function separarClasificaciones(filas: readonly FilaDetalleInventario[]) {
  const visibles = filas.filter(f => !f.esClasificacionCompra);
  const ocultas = filas.filter(f => f.esClasificacionCompra && f.enGalpon);
  const conValor = ocultas.filter(f => f.valorCostoUsd != null);
  return {
    visibles,
    kgOcultos: kg3(suma(ocultas.map(f => f.kg))),
    /** Valor a costo de las ocultas; null si ninguna trae costo (o el usuario no ve valores). */
    valorOcultoUsd: conValor.length > 0 ? usd2(suma(conValor.map(f => f.valorCostoUsd))) : null,
  };
}

const sinAgregadosInternos = ({ kgConCosto: _c, kgConPrecio: _p, ...resto }: Agregado) => resto;

/**
 * Rendimiento y merma por categoría de transformación ('pcb', 'ferroso_no_ferroso'...) con las
 * transformaciones COMPLETAS del período. Una categoría sin transformaciones no aparece (no se inventa).
 */
export function rendimientoPorCategoria(
  transformaciones: readonly TransformacionMov[],
  rango: RangoFechas
): Map<string, RendimientoExportacion> {
  const acc = new Map<string, { entrada: number; salida: number; n: number }>();
  for (const t of transformaciones) {
    if (t.estado !== 'completa' || t.fecha < rango.desde || t.fecha > rango.hasta) continue;
    const fila = construirFilaMerma({
      id: t.id, numero: t.numero, codigo: null, categoria: t.categoria, fecha: t.fecha, almacenId: t.almacenId,
      productoEntradaId: null, nombreProductoEntrada: null, nombreLoteOrigen: null, entradaDetalle: [],
      pesoNeto: t.pesoNeto, salidas: t.salidas.map(s => ({ pesoNeto: s.pesoNeto })), mermaDetalle: t.merma,
    });
    const a = acc.get(t.categoria) ?? { entrada: 0, salida: 0, n: 0 };
    acc.set(t.categoria, { entrada: a.entrada + fila.kgEntrada, salida: a.salida + fila.kgSalida, n: a.n + 1 });
  }
  return new Map([...acc].map(([k, a]) => [k, armarRendimiento(a.entrada, a.salida, a.n)]));
}

function armarRendimiento(entrada: number, salida: number, n: number): RendimientoExportacion {
  const merma = entrada - salida;
  return {
    rendimientoPct: entrada > 0 ? redondear((salida / entrada) * 100, 2) : 0,
    mermaPct: entrada > 0 ? redondear((merma / entrada) * 100, 2) : 0,
    kgEntrada: kg3(entrada), kgSalida: kg3(salida), kgMerma: kg3(merma), transformaciones: n,
  };
}

export interface ResultadoTarjetas {
  tarjetas: TarjetaInventario[];
  vistas: TarjetaVista[];
  totalKgEnGalpon: number;
}

/**
 * Tarjetas por categoría (y por clase de lote) y por vista. `rendimientos` viene de
 * rendimientoPorCategoria: solo la vista de exportación lo muestra; una categoría de exportación
 * sin transformaciones en el período queda con rendimiento null y sinTransformaciones true.
 */
export function construirTarjetas(
  filas: readonly FilaDetalleInventario[],
  rendimientos: ReadonlyMap<string, RendimientoExportacion>,
  valorOculto: boolean
): ResultadoTarjetas {
  const porClave = new Map<string, FilaDetalleInventario[]>();
  for (const f of filas) porClave.set(f.categoriaClave, [...(porClave.get(f.categoriaClave) ?? []), f]);

  const tarjetas: TarjetaInventario[] = [...porClave.entries()].map(([clave, delGrupo]) => {
    const primera = delGrupo[0];
    const esLotes = primera.tipo === 'lote';
    const esExportacionConTransformacion = primera.vista === 'exportacion' && !esLotes;
    const rendimiento = esExportacionConTransformacion ? rendimientos.get(normalizarTexto(primera.categoria)) ?? null : null;
    return {
      clave, nombre: primera.categoria, vista: primera.vista, tipo: esLotes ? 'lotes' as const : 'categoria' as const,
      ...sinAgregadosInternos(agregarFilas(delGrupo, valorOculto)),
      rendimiento,
      sinTransformaciones: esExportacionConTransformacion && rendimiento == null,
    };
  });
  tarjetas.sort((a, b) => VISTAS.indexOf(a.vista) - VISTAS.indexOf(b.vista) || a.nombre.localeCompare(b.nombre, 'es'));

  const vistas: TarjetaVista[] = VISTAS.map(vista => {
    const delaVista = filas.filter(f => f.vista === vista);
    const rend = tarjetas.filter(t => t.vista === 'exportacion' && vista === 'exportacion' && t.rendimiento).map(t => t.rendimiento as RendimientoExportacion);
    return {
      vista,
      tarjetas: tarjetas.filter(t => t.vista === vista).length,
      ...sinAgregadosInternos(agregarFilas(delaVista, valorOculto)),
      rendimiento: rend.length > 0 ? armarRendimiento(suma(rend.map(r => r.kgEntrada)), suma(rend.map(r => r.kgSalida)), suma(rend.map(r => r.transformaciones))) : null,
    };
  });
  return { tarjetas, vistas, totalKgEnGalpon: kg3(suma(filas.filter(f => f.enGalpon).map(f => f.kg))) };
}
