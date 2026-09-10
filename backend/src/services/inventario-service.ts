import { supabaseAdmin } from '../config/supabase.js';

export interface ArticuloInventario {
  productoId: string;
  nombre: string;
  /** Destino de inventario de esta fila. 'mpp' y 'lote' son destinos reales
   *  elegidos al pesar; 'sin_movimiento' es sintético — el producto existe
   *  en el catálogo pero nunca se pesó, no implica que su destino sea MPP. */
  destinoTipo: 'mpp' | 'lote' | 'sin_movimiento';
  /** Lote cuando destinoTipo === 'lote'. Null en cualquier otro caso. */
  loteId: string | null;
  /** Etiqueta legible del destino: "MPP", "Sin movimiento" o el nombre del lote. */
  destinoLabel: string;
  entradas: number;        // kg que entraron por pesaje de compra
  salidas: number;         // kg que salieron por pesaje de venta
  transformaciones: number; // neto por transformaciones (salidas - entradas)
  ajustes: number;         // neto de ajustes de toma física (culminar_toma_fisica_inventario)
  stock: number;
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
}

const SIN_CATEGORIA = 'Sin categoría';
const MPP_LABEL = 'MPP';
/** Catálogo sin ningún pesaje todavía — no implica que su destino sea MPP,
 *  solo que nunca se movió. Ver ArticuloInventario.destinoTipo. */
const SIN_MOVIMIENTO_LABEL = 'Sin movimiento';
const LOTE_ADJ_CLAVE = '__lote_adj__';
const LOTE_ADJ_CATEGORIA = 'Ajustes de inventario';
const LOTE_TRANSFORMACION_CLAVE = '__lote_transf__';
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

/**
 * Calcula el stock por (material, destino): entradas (pesaje de compra) −
 * salidas (pesaje de venta) ± neto de transformaciones. El peso entra/sale al
 * inventario en el momento del pesaje (ticket), no de la factura.
 */
export async function obtenerInventario(filtros: FiltrosInventario = {}): Promise<GrupoInventario[]> {
  const productos = await cargarProductos(filtros);
  // Solo contamos movimientos de materiales que pasaron el filtro de catálogo.
  const idsPermitidos = new Set(productos.map(p => p.id));

  // Pesaje: entradas (compra) y salidas (venta), con su destino.
  let qTickets = supabaseAdmin
    .from('tickets_pesaje')
    .select('tipo, fecha, detalle_tickets_pesaje(producto_id, peso_neto, destino_tipo, lote_id, lotes(nombre))');
  if (filtros.desde) qTickets = qTickets.gte('fecha', filtros.desde);
  if (filtros.hasta) qTickets = qTickets.lte('fecha', filtros.hasta);
  const { data: ticketsData } = await qTickets;

  const entradas: MovimientoInventario[] = [];
  const salidas: MovimientoInventario[] = [];
  for (const t of (ticketsData as unknown as TicketRow[]) ?? []) {
    for (const d of t.detalle_tickets_pesaje ?? []) {
      if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
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

  // Retiros hacia transformaciones (Bloque 40): cuentan como salida del
  // (producto, lote_origen) de esa transformación. Filtrado de fecha en JS,
  // igual que el resto de este archivo, porque el embed no lo soporta.
  const { data: tedData } = await supabaseAdmin
    .from('transformacion_entrada_detalle')
    .select('producto_id, peso_kg, transformaciones(lote_origen_id, fecha, lotes(nombre))');
  const retirosTransformacion: RetiroTransformacion[] = [];
  for (const d of (tedData as unknown as Array<{
    producto_id: string;
    peso_kg: number;
    transformaciones?: { lote_origen_id: string | null; fecha: string | null; lotes?: { nombre: string } | null } | null;
  }> | null) ?? []) {
    if (!idsPermitidos.has(d.producto_id) || !d.transformaciones) continue;
    const fecha = d.transformaciones.fecha;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    retirosTransformacion.push({
      productoId: d.producto_id,
      // Para ferroso lote_origen_id es null → bucket sin-lote (MPP)
      loteOrigenId: d.transformaciones.lote_origen_id ?? null,
      nombreLoteOrigen: d.transformaciones.lotes?.nombre ?? 'MPP',
      peso: Number(d.peso_kg),
    });
  }

  // Salidas de transformaciones ferroso: materiales que volvieron al inventario
  // después de la transformación (sin lote, van al bucket sin-lote/MPP).
  const { data: salidaFerrosoData } = await supabaseAdmin
    .from('transformacion_salida_detalle')
    .select('producto_id, peso_neto, transformaciones!inner(fecha, categoria, estado)')
    .not('producto_id', 'is', null)
    .eq('transformaciones.categoria', 'ferroso_no_ferroso')
    .eq('transformaciones.estado', 'completa');

  for (const d of (salidaFerrosoData as unknown as Array<{
    producto_id: string;
    peso_neto: number;
    transformaciones?: { fecha: string | null } | null;
  }> | null) ?? []) {
    if (!idsPermitidos.has(d.producto_id)) continue;
    const fecha = d.transformaciones?.fecha ?? null;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    entradas.push({
      productoId: d.producto_id,
      destinoTipo: 'mpp',
      loteId: null,
      destinoLabel: MPP_LABEL,
      peso: Number(d.peso_neto ?? 0),
    });
  }

  // Llegadas a lotes destino por transformación PCB/legacy: el material que
  // salió de una transformación hacia un lote destino hereda la composición
  // de ENTRADA de esa misma transformación, repartida proporcionalmente
  // según cuánto recibió cada destino — misma fórmula que
  // stock_lote_por_producto() en SQL (ver
  // docs/migration_fix_composicion_lote_destino_transformacion.sql). Se
  // duplica aquí, igual que ya se hace arriba para la salida ferroso, porque
  // este archivo recalcula el inventario en JS en vez de reusar la función
  // SQL. Sin este bloque, un lote que recibió material de una transformación
  // se veía con menos kg en /inventario que en /transformaciones o /lotes.
  const { data: salidaLoteData } = await supabaseAdmin
    .from('transformacion_salida_detalle')
    .select('transformacion_id, lote_destino_id, peso_neto, lotes(nombre), transformaciones(fecha)')
    .not('lote_destino_id', 'is', null);

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

  for (const s of (salidaLoteData as unknown as Array<{
    transformacion_id: string;
    lote_destino_id: string;
    peso_neto: number;
    lotes?: { nombre: string } | null;
    transformaciones?: { fecha: string | null } | null;
  }> | null) ?? []) {
    const fecha = s.transformaciones?.fecha ?? null;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    const entradaRows = entradaPorTransformacion.get(s.transformacion_id) ?? [];
    const totalEntrada = entradaRows.reduce((acc, r) => acc + r.pesoKg, 0);
    if (totalEntrada <= 0) continue;
    for (const r of entradaRows) {
      if (!r.productoId || !idsPermitidos.has(r.productoId)) continue;
      entradas.push({
        productoId: r.productoId,
        destinoTipo: 'lote',
        loteId: s.lote_destino_id,
        destinoLabel: s.lotes?.nombre ?? 'Lote',
        peso: (Number(s.peso_neto) * r.pesoKg) / totalEntrada,
      });
    }
  }

  // Llegadas SIN CLASIFICAR (producto_id null) a un lote destino por
  // transformación — misma fórmula que salida_null_distribuida() en SQL.
  // Si el lote origen no tenía composición conocida por producto (ej. un
  // lote "MPP" cuyo stock viene solo de ajustes/toma física), la porción
  // heredada no puede entrar a ningún producto real — no hay a cuál — así
  // que se acumula por lote, igual que ya se hace abajo con los ajustes de
  // toma física sin producto. Sin esto, esos kg simplemente desaparecían
  // del inventario tras completar la transformación: se descontaban del
  // origen pero no aparecían en ningún lado del destino.
  const llegadasSinProductoPorLote = new Map<string, { nombreLote: string | null; monto: number }>();
  for (const s of (salidaLoteData as unknown as Array<{
    transformacion_id: string;
    lote_destino_id: string;
    peso_neto: number;
    lotes?: { nombre: string } | null;
    transformaciones?: { fecha: string | null } | null;
  }> | null) ?? []) {
    const fecha = s.transformaciones?.fecha ?? null;
    if (filtros.desde && fecha && fecha < filtros.desde) continue;
    if (filtros.hasta && fecha && fecha > filtros.hasta) continue;
    const entradaRows = entradaPorTransformacion.get(s.transformacion_id) ?? [];
    const totalEntrada = entradaRows.reduce((acc, r) => acc + r.pesoKg, 0);
    if (totalEntrada <= 0) continue;
    const pesoKgSinProducto = entradaRows.filter(r => !r.productoId).reduce((acc, r) => acc + r.pesoKg, 0);
    if (pesoKgSinProducto <= 0) continue;
    const monto = (Number(s.peso_neto) * pesoKgSinProducto) / totalEntrada;
    const existing = llegadasSinProductoPorLote.get(s.lote_destino_id);
    if (existing) existing.monto += monto;
    else llegadasSinProductoPorLote.set(s.lote_destino_id, { nombreLote: s.lotes?.nombre ?? null, monto });
  }

  // Ajustes de toma física con producto conocido (culminar_toma_fisica_inventario).
  const { data: ajustesData } = await supabaseAdmin
    .from('ajustes_inventario')
    .select('producto_id, lote_id, diferencia, lotes(nombre)')
    .not('producto_id', 'is', null);

  const ajustesToma: AjusteTomaInventario[] = [];
  for (const d of (ajustesData as unknown as Array<{
    producto_id: string;
    lote_id: string | null;
    diferencia: number;
    lotes?: { nombre: string } | null;
  }> | null) ?? []) {
    if (!idsPermitidos.has(d.producto_id)) continue;
    ajustesToma.push({
      productoId: d.producto_id,
      loteId: d.lote_id,
      nombreLote: d.lotes?.nombre ?? null,
      diferencia: Number(d.diferencia),
    });
  }

  // Ajustes de toma física sin producto (lotes PCB contados como un todo).
  // Se muestran como línea sintética de lote para que el inventario cuadre.
  const { data: ajustesLoteData } = await supabaseAdmin
    .from('ajustes_inventario')
    .select('lote_id, diferencia, lotes(nombre)')
    .is('producto_id', null)
    .not('lote_id', 'is', null);

  // Retiros de transformación sin producto (masa de ajuste de lote retirada a PCB).
  const { data: retirosSinProducto } = await supabaseAdmin
    .from('transformacion_entrada_detalle')
    .select('peso_kg, transformaciones(lote_origen_id, lotes(nombre))')
    .is('producto_id', null);

  const retirosPorLote = new Map<string, { nombreLote: string | null; monto: number }>();
  for (const r of (retirosSinProducto as unknown as Array<{
    peso_kg: number;
    transformaciones?: { lote_origen_id: string | null; lotes?: { nombre: string } | null } | null;
  }> | null) ?? []) {
    const loteId = r.transformaciones?.lote_origen_id;
    if (!loteId) continue;
    const existing = retirosPorLote.get(loteId);
    if (existing) existing.monto += Number(r.peso_kg);
    else retirosPorLote.set(loteId, { nombreLote: r.transformaciones?.lotes?.nombre ?? null, monto: Number(r.peso_kg) });
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

  return construirGruposInventario(productos, entradas, salidas, retirosTransformacion, {}, ajustesToma);
}

interface TrasladoDetalleRow {
  producto_id: string | null;
  peso_neto: number | null;
  peso_recibido: number | null;
}
interface TrasladoConDetalleRow {
  detalle_traslado?: TrasladoDetalleRow[] | null;
}

/**
 * Inventario propio de UN almacén: compras/ventas cuyo ticket quedó
 * apuntando a este almacén (almacen_id) + traslados completados de/hacia él.
 * A diferencia del inventario general:
 *  - Colapsa MPP/lote — todo movimiento entra como destino 'mpp' (D-3 del
 *    plan: lo pedido es categoría → producto, no cruzarlo con destino).
 *  - No incluye transformaciones (D-4: no tienen almacén, atribuirlas al
 *    predeterminado se movería solo si cambia la estrella).
 *  - No lista productos sin movimiento (incluirSinMovimiento: false): un
 *    almacén nuevo no debe mostrar todo el catálogo del negocio en cero.
 */
export async function obtenerInventarioAlmacen(almacenId: string): Promise<GrupoInventario[]> {
  const productos = await cargarProductos();
  const idsPermitidos = new Set(productos.map(p => p.id));

  const entradas: MovimientoInventario[] = [];
  const salidas: MovimientoInventario[] = [];
  const comoMovimiento = (productoId: string, peso: number): MovimientoInventario => ({
    productoId,
    destinoTipo: 'mpp',
    loteId: null,
    destinoLabel: MPP_LABEL,
    peso,
  });

  const { data: ticketsData } = await supabaseAdmin
    .from('tickets_pesaje')
    .select('tipo, detalle_tickets_pesaje(producto_id, peso_neto)')
    .eq('almacen_id', almacenId);
  for (const t of (ticketsData as unknown as TicketRow[]) ?? []) {
    for (const d of t.detalle_tickets_pesaje ?? []) {
      if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
      const mov = comoMovimiento(d.producto_id, Number(d.peso_neto ?? 0));
      if (t.tipo === 'compra') entradas.push(mov);
      else salidas.push(mov);
    }
  }

  const { data: recibidosData } = await supabaseAdmin
    .from('tickets_traslado')
    .select('detalle_traslado(producto_id, peso_recibido)')
    .eq('almacen_destino_id', almacenId)
    .eq('estado', 'completo');
  for (const t of (recibidosData as unknown as TrasladoConDetalleRow[]) ?? []) {
    for (const d of t.detalle_traslado ?? []) {
      if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
      entradas.push(comoMovimiento(d.producto_id, Number(d.peso_recibido ?? 0)));
    }
  }

  const { data: enviadosData } = await supabaseAdmin
    .from('tickets_traslado')
    .select('detalle_traslado(producto_id, peso_neto)')
    .eq('almacen_origen_id', almacenId)
    .eq('estado', 'completo');
  for (const t of (enviadosData as unknown as TrasladoConDetalleRow[]) ?? []) {
    for (const d of t.detalle_traslado ?? []) {
      if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
      salidas.push(comoMovimiento(d.producto_id, Number(d.peso_neto ?? 0)));
    }
  }

  // Retiros ferroso de este almacén (input de transformación) → salen del stock.
  const { data: retirosFData } = await supabaseAdmin
    .from('transformacion_entrada_detalle')
    .select('producto_id, peso_kg, transformaciones!inner(almacen_id, categoria)')
    .not('producto_id', 'is', null)
    .eq('transformaciones.categoria', 'ferroso_no_ferroso')
    .eq('transformaciones.almacen_id', almacenId);
  for (const d of (retirosFData as unknown as Array<{
    producto_id: string;
    peso_kg: number;
  }> | null) ?? []) {
    if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
    salidas.push(comoMovimiento(d.producto_id, Number(d.peso_kg)));
  }

  // Outputs ferroso de este almacén (salida completa de transformación) → entran al stock.
  const { data: outputsFData } = await supabaseAdmin
    .from('transformacion_salida_detalle')
    .select('producto_id, peso_neto, transformaciones!inner(almacen_id, categoria, estado)')
    .not('producto_id', 'is', null)
    .eq('transformaciones.categoria', 'ferroso_no_ferroso')
    .eq('transformaciones.estado', 'completa')
    .eq('transformaciones.almacen_id', almacenId);
  for (const d of (outputsFData as unknown as Array<{
    producto_id: string;
    peso_neto: number;
  }> | null) ?? []) {
    if (!d.producto_id || !idsPermitidos.has(d.producto_id)) continue;
    entradas.push(comoMovimiento(d.producto_id, Number(d.peso_neto ?? 0)));
  }

  // Ajustes de toma física de este almacén, sin lote (mismo criterio que
  // stock_almacen() en SQL: almacen_id = este almacén, lote_id is null).
  // Faltaba por completo aquí — esta vista es la única de las tres
  // (general, por lote, por almacén) que no los tenía en cuenta, así que un
  // producto con un ajuste real podía mostrar stock negativo o incorrecto
  // solo en /almacenes aunque /inventario y stock_almacen() ya estuvieran bien.
  const { data: ajustesAlmacenData } = await supabaseAdmin
    .from('ajustes_inventario')
    .select('producto_id, diferencia')
    .eq('almacen_id', almacenId)
    .is('lote_id', null)
    .not('producto_id', 'is', null);
  for (const d of (ajustesAlmacenData as unknown as Array<{
    producto_id: string;
    diferencia: number;
  }> | null) ?? []) {
    if (!idsPermitidos.has(d.producto_id)) continue;
    const diferencia = Number(d.diferencia);
    if (diferencia > 0) entradas.push(comoMovimiento(d.producto_id, diferencia));
    else if (diferencia < 0) salidas.push(comoMovimiento(d.producto_id, -diferencia));
  }

  return construirGruposInventario(productos, entradas, salidas, [], { incluirSinMovimiento: false });
}
