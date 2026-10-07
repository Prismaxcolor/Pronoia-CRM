import { supabaseAdmin } from '../config/supabase.js';
import { almacenIdSchema } from '../schemas/inventario.js';
import { leerPaginado } from '../utils/paginacion.js';
import { calcularDesgloseAlmacen, type LineaDesgloseAlmacen, type MovimientoAlmacen } from './inventario-almacen-desglose.js';
import {
  construirMovimientosAlmacen,
  type AjusteAlmacenFila,
  type RangoFechasAlmacen,
  type SalidaAlmacenFila,
  type TicketAlmacenFila,
  type TrasladoAlmacenFila,
  type TransformacionAlmacenFila,
} from '../utils/movimientos-almacen.js';
import { diaNegocio, inicioDiaNegocio, finDiaNegocio } from '../utils/fecha-negocio.js';

export interface ArticuloInventario {
  productoId: string;
  nombre: string;
  /** Destino de inventario de esta fila. 'mpp' y 'lote' son destinos reales
   *  elegidos al pesar (el valor interno 'mpp' viene del modelo de datos,
   *  pero se muestra como "Sin lote" — ver MPP_LABEL); 'sin_movimiento' es
   *  sintético — el producto existe en el catálogo pero nunca se pesó, no
   *  implica que su destino sea "sin lote". */
  destinoTipo: 'mpp' | 'lote' | 'sin_movimiento';
  /** Lote cuando destinoTipo === 'lote'. Null en cualquier otro caso. */
  loteId: string | null;
  /** Etiqueta legible del destino: "Sin lote", "Sin movimiento" o el nombre del lote. */
  destinoLabel: string;
  entradas: number;        // kg que entraron por pesaje de compra
  salidas: number;         // kg que salieron por pesaje de venta
  transformaciones: number; // neto por transformaciones (salidas - entradas)
  ajustes: number;         // neto de ajustes de toma física (culminar_toma_fisica_inventario)
  stock: number;
  /** Solo en la vista por almacén: relación de movimientos que explican el
   *  stock (ver inventario-almacen-desglose.ts). */
  desglose?: DesgloseArticulo;
}

/** stock = compras − ventas + trasladoEntrada − trasladoSalida − transfEntrada + transfSalida + ajustes */
export interface DesgloseArticulo {
  compras: number;
  ventas: number;
  trasladoEntrada: number;
  trasladoSalida: number;
  /** Material consumido por transformaciones. */
  transfEntrada: number;
  /** Material producido por transformaciones. */
  transfSalida: number;
  ajustes: number;
}

export interface GrupoInventario {
  tipoMaterialId: string | null;
  nombreCategoria: string;
  totalKg: number;
  articulos: ArticuloInventario[];
}

export interface FiltrosInventario {
  tipoMaterialId?: string;
  productoId?: string;
  desde?: string;
  hasta?: string;
  /** Si se pasa, el inventario se limita a lo atribuible a este almacén.
   *  Material sin lote se atribuye por el almacén del ticket/transformación/
   *  ajuste; material con lote (PCB), por el almacén ACTUAL del lote — mismo
   *  criterio que usa stock_almacen() en SQL, para que ambas vistas cuadren. */
  almacenId?: string;
}

const SIN_CATEGORIA = 'Sin categoría';
/** Etiqueta del destino 'mpp' (material que nunca se asignó a un lote —
 *  el caso normal para Ferroso/No Ferroso, categorías que no usan lotes).
 *  Antes decía "MPP" — confundía con lotes que por casualidad se llaman
 *  parecido (ej. un lote real llamado "LOTE MPP") y no aplicaba a
 *  categorías que ni siquiera tienen el concepto de lote. */
const MPP_LABEL = 'Sin lote';
/** Catálogo sin ningún pesaje todavía — no implica que su destino sea MPP,
 *  solo que nunca se movió. Ver ArticuloInventario.destinoTipo. */
const SIN_MOVIMIENTO_LABEL = 'Sin movimiento';
/** Prefijo del productoId sintético de una línea de lote sin desglose por
 *  producto (ver AjusteTomaInventario) — exportado porque scripts/verificar-stock.ts
 *  necesita reconocer y excluir estas líneas: no existen en stock_almacen()
 *  (SQL), que solo puede devolver producto_id reales, nunca una fila "lote
 *  sin clasificar". */
export const LOTE_ADJ_CLAVE = '__lote_adj__';
const LOTE_ADJ_CATEGORIA = 'Ajustes de inventario';
export const LOTE_TRANSFORMACION_CLAVE = '__lote_transf__';
const LOTE_TRANSFORMACION_CATEGORIA = 'Recibido por transformación';

// ---- núcleo puro (testeable sin BD) ----------------------------------------

export interface ProductoInventario {
  id: string;
  nombre: string;
  tipoMaterialId: string | null;
  nombreCategoria: string;
}
/** Un movimiento de pesaje sobre un (material, destino). */
export interface MovimientoInventario {
  productoId: string;
  destinoTipo: 'mpp' | 'lote';
  loteId: string | null;
  destinoLabel: string;
  peso: number;
}
/** Un retiro de material hacia una transformación (Bloque 40): cuenta como
 *  salida del (producto, lote_origen) donde se retiró, para que la
 *  composición de un pool se refleje correctamente con el tiempo. A
 *  diferencia de una venta, se acumula en `transformaciones`, no en
 *  `salidas`, para distinguir el motivo en la UI.
 *  Una transformación ferroso/no-ferroso NO tiene lote de origen (retira
 *  directo de MPP) — loteOrigenId es null en ese caso, nunca un lote
 *  inventado. */
export interface RetiroTransformacion {
  productoId: string;
  loteOrigenId: string | null;
  nombreLoteOrigen: string;
  peso: number;
}

/** Un ajuste de inventario generado al culminar una toma física — ya viene
 *  con signo (positivo = sobrante, negativo = faltante), a diferencia de
 *  entradas/salidas que son siempre positivas.
 *  Cuando productoId es null, es un ajuste global de lote (PCB u otro sin
 *  desglose por producto) — se muestra como una línea sintética en inventario.
 *  `motivo` distingue esa línea sintética de un ajuste real de toma física
 *  (motivo por defecto) de material sin clasificar movido por una
 *  transformación — mismo mecanismo de "línea sin desglose por producto",
 *  pero NO es un ajuste manual y no debe etiquetarse como tal. */
export interface AjusteTomaInventario {
  productoId: string | null;
  loteId: string | null;
  nombreLote: string | null;
  diferencia: number;
  motivo?: 'toma_fisica' | 'transformacion';
}

/**
 * Calcula el stock por (material, destino) y lo agrupa por categoría.
 * stock = entradas (pesaje compra) − salidas (pesaje venta) − retiros hacia
 * transformaciones + ajustes de toma física. Las salidas de una
 * transformación (a qué lote fueron a parar) no participan de este cálculo
 * por producto — no tienen producto_id (ver transformacion_salida_detalle) y
 * se consultan aparte por lote (stock_lote_total). Función pura: recibe los
 * datos ya cargados, no toca la BD.
 */
export function construirGruposInventario(
  productos: ProductoInventario[],
  entradas: MovimientoInventario[],
  salidas: MovimientoInventario[],
  retirosTransformacion: RetiroTransformacion[],
  opciones: { incluirSinMovimiento?: boolean } = {},
  ajustesToma: AjusteTomaInventario[] = []
): GrupoInventario[] {
  const meta = new Map<string, ProductoInventario>();
  for (const p of productos) meta.set(p.id, p);

  // Clave de bucket: material + destino (lote_id o 'sin-lote').
  const buckets = new Map<string, ArticuloInventario>();
  const claveBucket = (productoId: string, loteId: string | null) =>
    `${productoId}::${loteId ?? 'sin-lote'}`;

  const obtenerBucket = (
    productoId: string,
    destinoTipo: 'mpp' | 'lote' | 'sin_movimiento',
    loteId: string | null,
    destinoLabel: string
  ): ArticuloInventario => {
    const esLote = destinoTipo === 'lote';
    const k = claveBucket(productoId, esLote ? loteId : null);
    let b = buckets.get(k);
    if (!b) {
      b = {
        productoId,
        nombre: meta.get(productoId)?.nombre ?? '—',
        destinoTipo,
        loteId: esLote ? loteId : null,
        destinoLabel,
        entradas: 0,
        salidas: 0,
        transformaciones: 0,
        ajustes: 0,
        stock: 0,
      };
      buckets.set(k, b);
    }
    return b;
  };

  for (const e of entradas) obtenerBucket(e.productoId, e.destinoTipo, e.loteId, e.destinoLabel).entradas += e.peso;
  for (const s of salidas) obtenerBucket(s.productoId, s.destinoTipo, s.loteId, s.destinoLabel).salidas += s.peso;
  for (const r of retirosTransformacion) {
    // Ferroso/no-ferroso retira directo de MPP (sin lote) — antes esto se
    // etiquetaba igual como destinoTipo 'lote' con un loteId vacío, lo que
    // generaba una fila MPP separada y duplicada frente a la fila MPP real
    // del mismo producto (dos claves de bucket distintas para el mismo
    // "sin lote": null vs '').
    const esLote = r.loteOrigenId !== null;
    obtenerBucket(r.productoId, esLote ? 'lote' : 'mpp', esLote ? r.loteOrigenId : null, r.nombreLoteOrigen).transformaciones -= r.peso;
  }
  for (const a of ajustesToma) {
    if (a.productoId !== null) {
      const destinoTipo = a.loteId ? 'lote' : 'mpp';
      const destinoLabel = a.loteId ? (a.nombreLote ?? 'Lote') : MPP_LABEL;
      obtenerBucket(a.productoId, destinoTipo, a.loteId, destinoLabel).ajustes += a.diferencia;
    } else if (a.loteId) {
      // Línea sintética de lote sin desglose por producto — el nombre y la
      // categoría dependen del motivo real, para no mostrar una
      // transformación como si fuera un ajuste manual (y viceversa).
      const esTransformacion = a.motivo === 'transformacion';
      const prefijo = esTransformacion ? LOTE_TRANSFORMACION_CLAVE : LOTE_ADJ_CLAVE;
      const syntheticId = `${prefijo}${a.loteId}`;
      const k = `${syntheticId}::${a.loteId}`;
      let b = buckets.get(k);
      if (!b) {
        b = {
          productoId: syntheticId,
          nombre: esTransformacion
            ? `${a.nombreLote ?? 'Lote'} — recibido por transformación (sin clasificar)`
            : `${a.nombreLote ?? 'Lote'} — ajuste de inventario`,
          destinoTipo: 'lote',
          loteId: a.loteId,
          destinoLabel: a.nombreLote ?? 'Lote',
          entradas: 0,
          salidas: 0,
          transformaciones: 0,
          ajustes: 0,
          stock: 0,
        };
        buckets.set(k, b);
      }
      b.ajustes += a.diferencia;
    }
  }

  // Productos sin ningún movimiento → fila "Sin movimiento" en cero (para
  // listar el catálogo). No es MPP: MPP es un destino real que se elige al
  // pesar, esto solo significa que el producto nunca se pesó.
  // El inventario por almacén desactiva esto: un almacén no lista todo el
  // catálogo en cero, solo lo que de verdad tuvo movimiento ahí.
  if (opciones.incluirSinMovimiento !== false) {
    const conMovimiento = new Set<string>();
    for (const b of buckets.values()) conMovimiento.add(b.productoId);
    for (const p of productos) {
      if (!conMovimiento.has(p.id)) obtenerBucket(p.id, 'sin_movimiento', null, SIN_MOVIMIENTO_LABEL);
    }
  }

  for (const b of buckets.values()) b.stock = b.entradas - b.salidas + b.transformaciones + b.ajustes;

  const grupos = new Map<string, GrupoInventario>();
  for (const b of buckets.values()) {
    let clave: string;
    let tipoMaterialId: string | null;
    let nombreCategoria: string;
    if (b.productoId.startsWith(LOTE_TRANSFORMACION_CLAVE)) {
      clave = LOTE_TRANSFORMACION_CLAVE;
      tipoMaterialId = null;
      nombreCategoria = LOTE_TRANSFORMACION_CATEGORIA;
    } else if (b.productoId.startsWith(LOTE_ADJ_CLAVE)) {
      clave = LOTE_ADJ_CLAVE;
      tipoMaterialId = null;
      nombreCategoria = LOTE_ADJ_CATEGORIA;
    } else {
      const m = meta.get(b.productoId);
      clave = m?.tipoMaterialId ?? '__sin__';
      tipoMaterialId = m?.tipoMaterialId ?? null;
      nombreCategoria = m?.nombreCategoria ?? SIN_CATEGORIA;
    }
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        tipoMaterialId,
        nombreCategoria,
        totalKg: 0,
        articulos: [],
      });
    }
    const g = grupos.get(clave)!;
    g.articulos.push(b);
    g.totalKg += b.stock;
  }

  for (const g of grupos.values()) {
    g.articulos.sort((a, b) => a.nombre.localeCompare(b.nombre) || a.destinoLabel.localeCompare(b.destinoLabel));
  }
  return Array.from(grupos.values()).sort((a, b) => a.nombreCategoria.localeCompare(b.nombreCategoria));
}

// ---- acceso a datos --------------------------------------------------------

interface ProductoRow {
  id: string;
  nombre: string;
  tipo_material_id: string | null;
  tipos_material?: { nombre: string } | null;
}

interface DetalleTicketRow {
  producto_id: string | null;
  peso_neto: number | null;
  destino_tipo: 'mpp' | 'lote';
  lote_id: string | null;
  lotes?: { nombre: string } | null;
}
interface TicketRow {
  tipo: 'compra' | 'venta';
  fecha: string | null;
  detalle_tickets_pesaje?: DetalleTicketRow[] | null;
}

async function cargarProductos(filtros: FiltrosInventario = {}): Promise<ProductoInventario[]> {
  let qProductos = supabaseAdmin
    .from('productos')
    .select('id, nombre, tipo_material_id, tipos_material(nombre)');
  if (filtros.tipoMaterialId) qProductos = qProductos.eq('tipo_material_id', filtros.tipoMaterialId);
  if (filtros.productoId) qProductos = qProductos.eq('id', filtros.productoId);
  const { data: productosData } = await qProductos;
  return ((productosData as unknown as ProductoRow[]) ?? []).map(p => ({
    id: p.id,
    nombre: p.nombre,
    tipoMaterialId: p.tipo_material_id,
    nombreCategoria: p.tipos_material?.nombre ?? SIN_CATEGORIA,
  }));
}

/** Una fila de transformacion_salida_detalle ya normalizada (camelCase). */
export interface SalidaTransformacionInventario {
  transformacionId: string;
  productoId: string | null;
  loteDestinoId: string | null;
  nombreLote: string | null;
  /** Almacén propio de la salida (puede ser null en datos antiguos). */
  almacenId: string | null;
  /** Almacén de la transformación — respaldo cuando la salida no tiene uno. */
  almacenTransformacionId: string | null;
  estadoTransformacion: string | null;
  fecha: string | null;
  pesoNeto: number;
}

export interface EntradaTransformacionInventario {
  productoId: string | null;
  pesoKg: number;
}

export interface ContextoDistribucionSalidas {
  idsPermitidos: Set<string>;
  almacenId?: string;
  desde?: string;
  hasta?: string;
  loteEnAlmacen: (loteId: string | null) => boolean;
}

export interface ResultadoDistribucionSalidas {
  entradas: MovimientoInventario[];
  /** Porción heredada sin producto conocido, acumulada por lote destino. */
  sinProductoPorLote: Map<string, { nombreLote: string | null; monto: number }>;
}

function fueraDeRango(fecha: string | null, desde?: string, hasta?: string): boolean {
  if (desde && fecha && fecha < desde) return true;
  if (hasta && fecha && fecha > hasta) return true;
  return false;
}

/** Salida A: material suelto (producto, sin lote). Cuenta en el almacén
 *  coalesce(salida.almacen_id, transformacion.almacen_id). */
function entradaMaterialSuelto(
  s: SalidaTransformacionInventario,
  ctx: ContextoDistribucionSalidas
): MovimientoInventario | null {
  if (s.estadoTransformacion !== 'completa' || !s.productoId) return null;
  if (!ctx.idsPermitidos.has(s.productoId)) return null;
  const almacenEfectivo = s.almacenId ?? s.almacenTransformacionId;
  if (ctx.almacenId && almacenEfectivo !== ctx.almacenId) return null;
  return { productoId: s.productoId, destinoTipo: 'mpp', loteId: null, destinoLabel: MPP_LABEL, peso: s.pesoNeto };
}

/** Salida B: lote destino sin producto. Hereda la composición de ENTRADA de
 *  la transformación, proporcional a lo que recibió el destino (misma fórmula
 *  que stock_lote_por_producto() / salida_null_distribuida() en SQL). */
function distribuirHeredada(
  s: SalidaTransformacionInventario,
  entradaRows: EntradaTransformacionInventario[],
  ctx: ContextoDistribucionSalidas,
  out: ResultadoDistribucionSalidas
): void {
  const totalEntrada = entradaRows.reduce((acc, r) => acc + r.pesoKg, 0);
  if (totalEntrada <= 0 || !s.loteDestinoId) return;
  for (const r of entradaRows) {
    if (!r.productoId || !ctx.idsPermitidos.has(r.productoId)) continue;
    out.entradas.push({
      productoId: r.productoId,
      destinoTipo: 'lote',
      loteId: s.loteDestinoId,
      destinoLabel: s.nombreLote ?? 'Lote',
      peso: (s.pesoNeto * r.pesoKg) / totalEntrada,
    });
  }
  const pesoKgSinProducto = entradaRows.filter(r => !r.productoId).reduce((acc, r) => acc + r.pesoKg, 0);
  if (pesoKgSinProducto <= 0) return;
  const monto = (s.pesoNeto * pesoKgSinProducto) / totalEntrada;
  const existing = out.sinProductoPorLote.get(s.loteDestinoId);
  if (existing) existing.monto += monto;
  else out.sinProductoPorLote.set(s.loteDestinoId, { nombreLote: s.nombreLote, monto });
}

/**
 * Reparte las salidas de transformaciones en movimientos de inventario, con la
 * misma semántica que stock_almacen()/stock_lote_por_producto() en SQL:
 *  - A (producto, sin lote): material suelto, cualquier categoría.
 *  - B (lote destino, sin producto): composición heredada de la entrada.
 *  - C (producto y lote destino): composición directa de ese producto en el lote.
 * Función pura: no toca la BD.
 */
export function distribuirSalidasTransformacion(
  salidas: SalidaTransformacionInventario[],
  entradaPorTransformacion: Map<string, EntradaTransformacionInventario[]>,
  ctx: ContextoDistribucionSalidas
): ResultadoDistribucionSalidas {
  const materialSuelto: MovimientoInventario[] = [];
  const out: ResultadoDistribucionSalidas = { entradas: [], sinProductoPorLote: new Map() };

  for (const s of salidas) {
    if (fueraDeRango(s.fecha, ctx.desde, ctx.hasta)) continue;
    if (!s.loteDestinoId) {
      const mov = entradaMaterialSuelto(s, ctx);
      if (mov) materialSuelto.push(mov);
      continue;
    }
    if (!ctx.loteEnAlmacen(s.loteDestinoId)) continue;
    if (s.productoId) {
      if (!ctx.idsPermitidos.has(s.productoId)) continue;
      out.entradas.push({
        productoId: s.productoId,
        destinoTipo: 'lote',
        loteId: s.loteDestinoId,
        destinoLabel: s.nombreLote ?? 'Lote',
        peso: s.pesoNeto,
      });
      continue;
    }
    distribuirHeredada(s, entradaPorTransformacion.get(s.transformacionId) ?? [], ctx, out);
  }
  out.entradas.unshift(...materialSuelto);
  return out;
}

/**
 * Calcula el stock por (material, destino): entradas (pesaje de compra) −
 * salidas (pesaje de venta) ± neto de transformaciones. El peso entra/sale al
 * inventario en el momento del pesaje (ticket), no de la factura.
 *
 * NOTA (14-sep-2026): filtros.almacenId ya NO se usa acá — la ruta
 * (routes/inventario.ts) delega el caso "filtrado por almacén" a
 * obtenerInventarioAlmacen(), que sí soporta que un lote tenga kilos
 * repartidos en varios almacenes a la vez (stock_almacen() en SQL). El
 * `loteEnAlmacen` de acá abajo asumía un único lotes.almacen_id (columna
 * eliminada en migration_lote_stock_por_almacen.sql) — se deja el código
 * porque es inofensivo cuando almacenId siempre llega undefined
 * (`!almacenId` corta antes de tocar la consulta rota), pero no reactivar
 * este camino para filtrar por almacén sin arreglarlo primero.
 */
export async function obtenerInventario(filtros: FiltrosInventario = {}): Promise<GrupoInventario[]> {
  const productos = await cargarProductos(filtros);
  // Solo contamos movimientos de materiales que pasaron el filtro de catálogo.
  const idsPermitidos = new Set(productos.map(p => p.id));
  const almacenId = filtros.almacenId;
  // El caso "con almacenId" ya no pasa por acá (ver nota de la función,
  // arriba) — un lote puede tener kilos en varios almacenes a la vez, así
  // que "el almacén de este lote" dejó de ser una pregunta con una sola
  // respuesta. loteEnAlmacen queda como no-op (siempre true) porque
  // almacenId siempre llega undefined en este camino.
  const loteEnAlmacen = (_loteId: string | null) => !almacenId;

  // Pesaje: entradas (compra) y salidas (venta), con su destino.
  let qTickets = supabaseAdmin
    .from('tickets_pesaje')
    .select('tipo, fecha, almacen_id, detalle_tickets_pesaje(producto_id, peso_neto, destino_tipo, lote_id, lotes(nombre))');
  if (filtros.desde) qTickets = qTickets.gte('fecha', filtros.desde);
  if (filtros.hasta) qTickets = qTickets.lte('fecha', filtros.hasta);
  const { data: ticketsData } = await qTickets;

  const entradas: MovimientoInventario[] = [];
  const salidas: MovimientoInventario[] = [];
  for (const t of (ticketsData as unknown as (TicketRow & { almacen_id: string | null })[]) ?? []) {
    for (const d of t.detalle_tickets_pesaje ?? []) {
      if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
      const enEsteAlmacen = d.destino_tipo === 'lote' ? loteEnAlmacen(d.lote_id) : !almacenId || t.almacen_id === almacenId;
      if (!enEsteAlmacen) continue;
      const mov: MovimientoInventario = {
        productoId: d.producto_id,
        destinoTipo: d.destino_tipo,
        loteId: d.lote_id,
        destinoLabel: d.destino_tipo === 'lote' ? (d.lotes?.nombre ?? 'Lote') : MPP_LABEL,
        peso: Number(d.peso_neto ?? 0),
      };
      if (t.tipo === 'compra') entradas.push(mov);
      else salidas.push(mov);
    }
  }

  // Traslados: solo importan cuando se filtra por almacén (en el negocio
  // completo un traslado no cambia el stock total, solo lo mueve). El origen
  // descuenta desde que el traslado se CREA (el material ya salió
  // físicamente); el destino solo suma cuando el traslado se completó —
  // mismo criterio que stock_almacen(). Sin lote: los traslados todavía no
  // soportan material con lote (ver 2.1 del plan de mejoras).
  if (almacenId) {
    const { data: trasladosData, error: errorTraslados } = await supabaseAdmin
      .from('tickets_traslado')
      .select('almacen_origen_id, almacen_destino_id, estado, created_at, completado_en, detalle_traslado(producto_id, peso_neto, peso_recibido)');
    if (errorTraslados) throw errorTraslados;
    for (const t of (trasladosData as unknown as Array<{
      almacen_origen_id: string | null;
      almacen_destino_id: string | null;
      estado: 'pendiente' | 'completo';
      created_at: string | null;
      completado_en: string | null;
      detalle_traslado?: Array<{ producto_id: string | null; peso_neto: number | null; peso_recibido: number | null }> | null;
    }> | null) ?? []) {
      const esOrigen = t.almacen_origen_id === almacenId;
      const esDestinoCompleto = t.almacen_destino_id === almacenId && t.estado === 'completo';
      if (!esOrigen && !esDestinoCompleto) continue;
      const fecha = (diaNegocio(esDestinoCompleto ? t.completado_en : t.created_at) ?? null);
      if (filtros.desde && fecha && fecha < filtros.desde) continue;
      if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
      for (const d of t.detalle_traslado ?? []) {
        if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
        if (esOrigen) {
          salidas.push({ productoId: d.producto_id, destinoTipo: 'mpp', loteId: null, destinoLabel: MPP_LABEL, peso: Number(d.peso_neto ?? 0) });
        }
        if (esDestinoCompleto) {
          entradas.push({ productoId: d.producto_id, destinoTipo: 'mpp', loteId: null, destinoLabel: MPP_LABEL, peso: Number(d.peso_recibido ?? 0) });
        }
      }
    }
  }

  // Retiros hacia transformaciones (Bloque 40): cuentan como salida del
  // (producto, lote_origen) de esa transformación. Filtrado de fecha en JS,
  // igual que el resto de este archivo, porque el embed no lo soporta.
  const { data: tedData } = await supabaseAdmin
    .from('transformacion_entrada_detalle')
    .select('producto_id, peso_kg, transformaciones(lote_origen_id, fecha, lotes(nombre), almacen_id)');
  const retirosTransformacion: RetiroTransformacion[] = [];
  for (const d of (tedData as unknown as Array<{
    producto_id: string;
    peso_kg: number;
    transformaciones?: { lote_origen_id: string | null; fecha: string | null; lotes?: { nombre: string } | null; almacen_id: string | null } | null;
  }> | null) ?? []) {
    if (!idsPermitidos.has(d.producto_id) || !d.transformaciones) continue;
    const fecha = d.transformaciones.fecha;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    const loteOrigenId = d.transformaciones.lote_origen_id ?? null;
    const enEsteAlmacen = loteOrigenId ? loteEnAlmacen(loteOrigenId) : !almacenId || d.transformaciones.almacen_id === almacenId;
    if (!enEsteAlmacen) continue;
    retirosTransformacion.push({
      productoId: d.producto_id,
      // Para ferroso lote_origen_id es null → bucket sin-lote (MPP)
      loteOrigenId: d.transformaciones.lote_origen_id ?? null,
      nombreLoteOrigen: d.transformaciones.lotes?.nombre ?? MPP_LABEL,
      peso: Number(d.peso_kg),
    });
  }

  // Salidas de transformaciones (cualquier categoría), una sola consulta. Se
  // clasifican en distribuirSalidasTransformacion():
  //  - material suelto (producto sin lote): entra al bucket sin-lote;
  //  - lote destino sin producto: hereda la composición de ENTRADA;
  //  - producto + lote destino: composición directa de ese producto.
  const { data: salidaTransfData } = await supabaseAdmin
    .from('transformacion_salida_detalle')
    .select('transformacion_id, producto_id, lote_destino_id, almacen_id, peso_neto, lotes(nombre), transformaciones(fecha, estado, almacen_id)')
    .or('producto_id.not.is.null,lote_destino_id.not.is.null');

  const { data: entradaPorTransformacionData } = await supabaseAdmin
    .from('transformacion_entrada_detalle')
    .select('transformacion_id, producto_id, peso_kg');

  const entradaPorTransformacion = new Map<string, Array<{ productoId: string | null; pesoKg: number }>>();
  for (const d of (entradaPorTransformacionData as unknown as Array<{
    transformacion_id: string;
    producto_id: string | null;
    peso_kg: number;
  }> | null) ?? []) {
    const arr = entradaPorTransformacion.get(d.transformacion_id) ?? [];
    arr.push({ productoId: d.producto_id, pesoKg: Number(d.peso_kg) });
    entradaPorTransformacion.set(d.transformacion_id, arr);
  }

  const salidasTransformacion: SalidaTransformacionInventario[] = (
    (salidaTransfData as unknown as Array<{
      transformacion_id: string;
      producto_id: string | null;
      lote_destino_id: string | null;
      almacen_id: string | null;
      peso_neto: number;
      lotes?: { nombre: string } | null;
      transformaciones?: { fecha: string | null; estado: string | null; almacen_id: string | null } | null;
    }> | null) ?? []
  ).map(s => ({
    transformacionId: s.transformacion_id,
    productoId: s.producto_id,
    loteDestinoId: s.lote_destino_id,
    nombreLote: s.lotes?.nombre ?? null,
    almacenId: s.almacen_id,
    almacenTransformacionId: s.transformaciones?.almacen_id ?? null,
    estadoTransformacion: s.transformaciones?.estado ?? null,
    fecha: s.transformaciones?.fecha ?? null,
    pesoNeto: Number(s.peso_neto),
  }));

  const distribucion = distribuirSalidasTransformacion(salidasTransformacion, entradaPorTransformacion, {
    idsPermitidos,
    almacenId,
    desde: filtros.desde,
    hasta: filtros.hasta,
    loteEnAlmacen,
  });
  entradas.push(...distribucion.entradas);
  const llegadasSinProductoPorLote = distribucion.sinProductoPorLote;

  // Ajustes de toma física con producto conocido (culminar_toma_fisica_inventario).
  // Filtro de fecha por created_at (RC-8 del plan de consolidación): antes
  // esta consulta ignoraba filtros.desde/hasta mientras el resto de las
  // fuentes sí los aplicaban — con un filtro de fechas puesto, la columna
  // "Ajuste" mezclaba movimientos de otra ventana temporal.
  let qAjustes = supabaseAdmin
    .from('ajustes_inventario')
    .select('producto_id, lote_id, almacen_id, diferencia, created_at, lotes(nombre)')
    .not('producto_id', 'is', null);
  if (filtros.desde) qAjustes = qAjustes.gte('created_at', inicioDiaNegocio(filtros.desde));
  if (filtros.hasta) qAjustes = qAjustes.lte('created_at', finDiaNegocio(filtros.hasta));
  const { data: ajustesData } = await qAjustes;

  const ajustesToma: AjusteTomaInventario[] = [];
  for (const d of (ajustesData as unknown as Array<{
    producto_id: string;
    lote_id: string | null;
    almacen_id: string | null;
    diferencia: number;
    lotes?: { nombre: string } | null;
  }> | null) ?? []) {
    if (!idsPermitidos.has(d.producto_id)) continue;
    const enEsteAlmacen = d.lote_id ? loteEnAlmacen(d.lote_id) : !almacenId || d.almacen_id === almacenId;
    if (!enEsteAlmacen) continue;
    ajustesToma.push({
      productoId: d.producto_id,
      loteId: d.lote_id,
      nombreLote: d.lotes?.nombre ?? null,
      diferencia: Number(d.diferencia),
    });
  }

  // Ajustes de toma física sin producto (lotes PCB contados como un todo).
  // Se muestran como línea sintética de lote para que el inventario cuadre.
  let qAjustesLote = supabaseAdmin
    .from('ajustes_inventario')
    .select('lote_id, diferencia, created_at, lotes(nombre)')
    .is('producto_id', null)
    .not('lote_id', 'is', null);
  if (filtros.desde) qAjustesLote = qAjustesLote.gte('created_at', inicioDiaNegocio(filtros.desde));
  if (filtros.hasta) qAjustesLote = qAjustesLote.lte('created_at', finDiaNegocio(filtros.hasta));
  const { data: ajustesLoteData } = await qAjustesLote;

  // Retiros de transformación sin producto (masa de ajuste de lote retirada a PCB).
  const { data: retirosSinProductoRaw } = await supabaseAdmin
    .from('transformacion_entrada_detalle')
    .select('peso_kg, transformaciones(lote_origen_id, fecha, lotes(nombre))')
    .is('producto_id', null);

  const retirosPorLote = new Map<string, { nombreLote: string | null; monto: number }>();
  for (const r of (retirosSinProductoRaw as unknown as Array<{
    peso_kg: number;
    transformaciones?: { lote_origen_id: string | null; fecha: string | null; lotes?: { nombre: string } | null } | null;
  }> | null) ?? []) {
    const loteId = r.transformaciones?.lote_origen_id;
    if (!loteId) continue;
    const fecha = r.transformaciones?.fecha ?? null;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    if (!loteEnAlmacen(loteId)) continue;
    const existing = retirosPorLote.get(loteId);
    if (existing) existing.monto += Number(r.peso_kg);
    else retirosPorLote.set(loteId, { nombreLote: r.transformaciones?.lotes?.nombre ?? null, monto: Number(r.peso_kg) });
  }

  // Merma de traslados completados (RC-7 del plan): lo que salió de un
  // almacén y llegó de menos al destino es material que ya no existe —
  // antes desaparecía sin dejar rastro en el inventario general (solo se
  // notaba, indirectamente, en la vista por almacén). Se refleja como una
  // salida "sin lote" del producto, fechada por la fecha de recepción del
  // traslado.
  // Solo en la vista global: por almacén, la merma ya queda implícita en el
  // bloque de traslados de arriba (origen pierde el peso_neto completo,
  // destino solo gana el peso_recibido) — sumarla aparte aquí la contaría dos veces.
  if (!almacenId) {
    const { data: trasladosCompletosData } = await supabaseAdmin
      .from('tickets_traslado')
      .select('completado_en, detalle_traslado(producto_id, peso_neto, peso_recibido)')
      .eq('estado', 'completo');
    for (const t of (trasladosCompletosData as unknown as Array<{
      completado_en: string | null;
      detalle_traslado?: Array<{ producto_id: string | null; peso_neto: number | null; peso_recibido: number | null }> | null;
    }> | null) ?? []) {
      const fecha = diaNegocio(t.completado_en);
      if (filtros.desde && fecha && fecha < filtros.desde) continue;
      if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
      for (const d of t.detalle_traslado ?? []) {
        if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
        const merma = Number(d.peso_neto ?? 0) - Number(d.peso_recibido ?? 0);
        if (merma > 0.005) {
          salidas.push({
            productoId: d.producto_id,
            destinoTipo: 'mpp',
            loteId: null,
            destinoLabel: MPP_LABEL,
            peso: merma,
          });
        }
      }
    }
  }

  // Ajuste real de toma física, sin producto (motivo: 'toma_fisica') — se
  // mantiene SEPARADO del movimiento por transformación de abajo para que
  // nunca se muestren mezclados bajo la misma etiqueta: una transformación
  // no es un ajuste manual, aunque ambas terminen siendo "kg de lote sin
  // desglose por producto".
  const ajusteTomaFisicaPorLote = new Map<string, { nombreLote: string | null; neto: number }>();
  for (const a of (ajustesLoteData as unknown as Array<{
    lote_id: string;
    diferencia: number;
    lotes?: { nombre: string } | null;
  }> | null) ?? []) {
    if (!loteEnAlmacen(a.lote_id)) continue;
    const existing = ajusteTomaFisicaPorLote.get(a.lote_id);
    if (existing) {
      existing.neto += Number(a.diferencia);
    } else {
      ajusteTomaFisicaPorLote.set(a.lote_id, { nombreLote: a.lotes?.nombre ?? null, neto: Number(a.diferencia) });
    }
  }
  for (const [loteId, info] of ajusteTomaFisicaPorLote) {
    if (Math.abs(info.neto) > 0.001) {
      ajustesToma.push({ productoId: null, loteId, nombreLote: info.nombreLote, diferencia: info.neto, motivo: 'toma_fisica' });
    }
  }

  // Movimiento neto por transformación, sin producto (motivo: 'transformacion'):
  // lo que salió sin clasificar hacia una transformación (retiro, negativo)
  // menos lo que llegó sin clasificar desde una transformación (llegada,
  // positivo) — mismo lote puede tener ambos con el tiempo.
  const transformacionNetoPorLote = new Map<string, { nombreLote: string | null; neto: number }>();
  for (const [loteId, { nombreLote, monto }] of retirosPorLote) {
    const existing = transformacionNetoPorLote.get(loteId);
    if (existing) existing.neto -= monto;
    else transformacionNetoPorLote.set(loteId, { nombreLote, neto: -monto });
  }
  for (const [loteId, { nombreLote, monto }] of llegadasSinProductoPorLote) {
    const existing = transformacionNetoPorLote.get(loteId);
    if (existing) existing.neto += monto;
    else transformacionNetoPorLote.set(loteId, { nombreLote, neto: monto });
  }
  for (const [loteId, info] of transformacionNetoPorLote) {
    if (Math.abs(info.neto) > 0.001) {
      ajustesToma.push({ productoId: null, loteId, nombreLote: info.nombreLote, diferencia: info.neto, motivo: 'transformacion' });
    }
  }

  return construirGruposInventario(
    productos,
    entradas,
    salidas,
    retirosTransformacion,
    { incluirSinMovimiento: !almacenId },
    ajustesToma
  );
}

const UMBRAL_STOCK_KG = 0.005;
const LOTES_ALMACEN_CATEGORIA = 'Lotes';
const LOTES_ALMACEN_CLAVE_GRUPO = '__lotes_almacen__';

type RangoFechas = RangoFechasAlmacen;

/** Lee de la BD todos los movimientos que afectan a un almacén y los normaliza
 *  (la atribución vive en utils/movimientos-almacen.ts, pura y con pruebas).
 *  Mismas reglas que stock_almacen() / stock_lote_por_almacen(): compra/venta
 *  por el almacén del ticket; traslado saliente desde que se crea (pendiente o
 *  completo) y entrante solo al completarse, por lo recibido; transformación
 *  por el almacén de la salida (o el de la transformación si la salida no lo
 *  indica) y solo si está completa; ajustes por su almacén. */
async function cargarMovimientosAlmacen(almacenId: string, rango: RangoFechas): Promise<MovimientoAlmacen[]> {
  // Defensa en profundidad: almacenId se interpola en un filtro .or() de PostgREST.
  almacenIdSchema.parse(almacenId);
  const columnasSalida = 'producto_id, lote_destino_id, peso_neto';
  const [tickets, traslados, transformaciones, salidasPropias, salidasHeredadas, ajustes] = await Promise.all([
    leerPaginado<TicketAlmacenFila>((d, h) =>
      supabaseAdmin
        .from('tickets_pesaje')
        .select('tipo, fecha, detalle_tickets_pesaje(producto_id, peso_neto, destino_tipo, lote_id)')
        .eq('almacen_id', almacenId)
        .order('id')
        .range(d, h)
    ),
    leerPaginado<TrasladoAlmacenFila>((d, h) =>
      supabaseAdmin
        .from('tickets_traslado')
        .select('almacen_origen_id, almacen_destino_id, estado, created_at, completado_en, detalle_traslado(producto_id, lote_id, peso_neto, peso_recibido)')
        .or(`almacen_origen_id.eq.${almacenId},almacen_destino_id.eq.${almacenId}`)
        .order('id')
        .range(d, h)
    ),
    leerPaginado<TransformacionAlmacenFila>((d, h) =>
      supabaseAdmin
        .from('transformaciones')
        .select('categoria, fecha, lote_origen_id, peso_neto, transformacion_entrada_detalle(producto_id, peso_kg)')
        .eq('almacen_id', almacenId)
        .order('id')
        .range(d, h)
    ),
    // Salidas con almacén propio, y salidas sin almacén cuya transformación es de este almacén.
    leerPaginado<SalidaAlmacenFila>((d, h) =>
      supabaseAdmin
        .from('transformacion_salida_detalle')
        .select(`${columnasSalida}, transformaciones(estado, fecha)`)
        .eq('almacen_id', almacenId)
        .order('id')
        .range(d, h)
    ),
    leerPaginado<SalidaAlmacenFila>((d, h) =>
      supabaseAdmin
        .from('transformacion_salida_detalle')
        .select(`${columnasSalida}, transformaciones!inner(estado, fecha, almacen_id)`)
        .is('almacen_id', null)
        .eq('transformaciones.almacen_id', almacenId)
        .order('id')
        .range(d, h)
    ),
    leerPaginado<AjusteAlmacenFila>((d, h) =>
      supabaseAdmin
        .from('ajustes_inventario')
        .select('producto_id, lote_id, diferencia, created_at')
        .eq('almacen_id', almacenId)
        .order('id')
        .range(d, h)
    ),
  ]);
  return construirMovimientosAlmacen(
    almacenId,
    { tickets, traslados, transformaciones, salidas: [...salidasPropias, ...salidasHeredadas], ajustes },
    rango
  );
}

function aDesglose(l: LineaDesgloseAlmacen): DesgloseArticulo {
  return {
    compras: l.compras,
    ventas: l.ventas,
    trasladoEntrada: l.trasladoEntrada,
    trasladoSalida: l.trasladoSalida,
    transfEntrada: l.transfEntrada,
    transfSalida: l.transfSalida,
    ajustes: l.ajustes,
  };
}

function tieneMovimiento(l: LineaDesgloseAlmacen): boolean {
  return [l.compras, l.ventas, l.trasladoEntrada, l.trasladoSalida, l.transfEntrada, l.transfSalida, l.ajustes]
    .some(kg => Math.abs(kg) >= UMBRAL_STOCK_KG);
}

function articuloDeLinea(l: LineaDesgloseAlmacen, nombre: string, esLote: boolean): ArticuloInventario {
  return {
    productoId: esLote ? `${LOTE_ADJ_CLAVE}${l.loteId}` : (l.productoId as string),
    nombre,
    destinoTipo: esLote ? 'lote' : 'mpp',
    loteId: esLote ? l.loteId : null,
    destinoLabel: esLote ? nombre : MPP_LABEL,
    entradas: l.compras,
    salidas: l.ventas,
    transformaciones: l.transfSalida - l.transfEntrada,
    ajustes: l.ajustes,
    stock: l.stock,
    desglose: aDesglose(l),
  };
}

/**
 * Inventario propio de UN almacén, con el desglose de lo que lo explica:
 * compras, ventas, traslados (entrada/salida), transformaciones (consumo/
 * producción) y ajustes de toma física. Sale de los movimientos reales del
 * almacén (ver cargarMovimientosAlmacen), con las mismas reglas de
 * atribución que stock_almacen()/stock_lote_por_almacen() en SQL, así que la
 * suma de todas las líneas coincide con stock_almacen() más el stock de lote
 * que ningún producto explica.
 *
 * Material sin lote: una fila por producto. Lotes: una fila por lote (sus
 * movimientos no siempre traen producto, p. ej. toma física del lote entero o
 * traslado de lote), con el stock real del lote en este almacén. Se muestra
 * el stock negativo tal cual: el sistema no bloquea ventas por falta de
 * stock, un negativo real debe verse. Un almacén nuevo no lista el catálogo
 * en cero: solo aparecen productos/lotes con algún movimiento en él.
 *
 * Filtros: categoría/producto limitan las filas de producto; un lote solo se
 * muestra si alguno de sus movimientos fue de un producto permitido. desde/
 * hasta acotan los movimientos (el stock pasa a ser el neto de la ventana).
 */
export async function obtenerInventarioAlmacen(
  almacenId: string,
  filtros: Pick<FiltrosInventario, 'tipoMaterialId' | 'productoId' | 'desde' | 'hasta'> = {}
): Promise<GrupoInventario[]> {
  const [productos, movimientos, lotesData] = await Promise.all([
    cargarProductos(filtros),
    cargarMovimientosAlmacen(almacenId, { desde: filtros.desde, hasta: filtros.hasta }),
    supabaseAdmin.from('lotes').select('id, nombre'),
  ]);
  if (lotesData.error) throw lotesData.error;
  const metaPorId = new Map(productos.map(p => [p.id, p]));
  const nombreLote = new Map(((lotesData.data as Array<{ id: string; nombre: string | null }> | null) ?? []).map(l => [l.id, l.nombre]));
  const hayFiltroProducto = Boolean(filtros.tipoMaterialId || filtros.productoId);
  const lotesDeProductoPermitido = new Set(
    movimientos.filter(m => m.loteId && m.productoId && metaPorId.has(m.productoId)).map(m => m.loteId as string)
  );

  const grupos = new Map<string, GrupoInventario>();
  const agregar = (clave: string, tipoMaterialId: string | null, nombreCategoria: string, articulo: ArticuloInventario) => {
    let g = grupos.get(clave);
    if (!g) {
      g = { tipoMaterialId, nombreCategoria, totalKg: 0, articulos: [] };
      grupos.set(clave, g);
    }
    g.articulos.push(articulo);
    g.totalKg += articulo.stock;
  };

  for (const l of calcularDesgloseAlmacen(movimientos)) {
    if (!tieneMovimiento(l)) continue;
    if (l.loteId) {
      if (hayFiltroProducto && !lotesDeProductoPermitido.has(l.loteId)) continue;
      agregar(LOTES_ALMACEN_CLAVE_GRUPO, null, LOTES_ALMACEN_CATEGORIA, articuloDeLinea(l, nombreLote.get(l.loteId) ?? 'Lote', true));
      continue;
    }
    const meta = l.productoId ? metaPorId.get(l.productoId) : undefined;
    if (!meta) continue;
    agregar(meta.tipoMaterialId ?? '__sin__', meta.tipoMaterialId, meta.nombreCategoria, articuloDeLinea(l, meta.nombre, false));
  }

  for (const g of grupos.values()) g.articulos.sort((a, b) => a.nombre.localeCompare(b.nombre));
  return Array.from(grupos.values()).sort((a, b) => a.nombreCategoria.localeCompare(b.nombreCategoria));
}
