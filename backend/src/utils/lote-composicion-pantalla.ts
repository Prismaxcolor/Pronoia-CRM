/**
 * Composición de un lote para la pantalla de inventario (solo kilos, sin dinero). Lógica pura, sin base de datos.
 *
 * kgActual sale de las funciones SQL stock_lote_por_producto / stock_lote_almacen_por_producto (misma fuente que
 * el resto del inventario). kgCompradoPeriodo se arma aquí: compras directas al lote dentro del rango más el
 * reparto de las transformaciones completadas que alimentaron al lote.
 *
 * Exactitud: lo comprado directo al lote, lo que una transformación dejó con producto y los ajustes con producto
 * son exactos. Lo que una transformación entrega a un lote SIN producto se reparte en proporción a lo que entró
 * a la transformación (el sistema no guarda qué producto salió a cada lote): eso es aproximado.
 */

/** Por debajo de este saldo (kg) un producto se considera sin existencia. */
export const UMBRAL_KG_COMPOSICION = 0.005;
/** Diferencia mínima (kg) entre el stock del lote y lo clasificado por producto para avisarla. */
export const UMBRAL_SIN_CLASIFICAR_KG = 0.5;

export interface CompraDirectaLote {
  productoId: string;
  pesoKg: number;
  /** Día del ticket (YYYY-MM-DD). */
  fecha: string | null;
  almacenId: string | null;
}

export interface EntradaTransformacionLote {
  productoId: string | null;
  pesoKg: number;
}

export interface SalidaHaciaLote {
  transformacionId: string;
  /** Producto de la salida si se registró; null si el lote recibió sin producto (reparto proporcional). */
  productoId: string | null;
  pesoNeto: number;
  fecha: string | null;
  /** Solo las transformaciones completadas cuentan. */
  completa: boolean;
  /** Almacén efectivo: el de la salida o, si falta, el de la transformación. */
  almacenId: string | null;
  entradas: EntradaTransformacionLote[];
}

export interface RangoComposicion {
  desde?: string;
  hasta?: string;
  almacenId?: string;
}

export interface CompradoPeriodo {
  porProducto: Map<string, number>;
  /** Kilos de transformación repartidos en proporción (aproximados). */
  kgProporcional: number;
  /** Kilos de transformación cuya porción de entrada no tenía producto: no se atribuyen a ninguno. */
  kgSinProducto: number;
}

function dentroDelRango(fecha: string | null, desde?: string, hasta?: string): boolean {
  if (desde && fecha && fecha < desde) return false;
  if (hasta && fecha && fecha > hasta) return false;
  return true;
}

function sumar(mapa: Map<string, number>, clave: string, kg: number): void {
  mapa.set(clave, (mapa.get(clave) ?? 0) + kg);
}

/** Kilos comprados por producto dentro del rango, más el reparto de las transformaciones completadas del rango. */
export function calcularCompradoPeriodo(
  compras: CompraDirectaLote[],
  salidas: SalidaHaciaLote[],
  rango: RangoComposicion
): CompradoPeriodo {
  const porProducto = new Map<string, number>();
  let kgProporcional = 0;
  let kgSinProducto = 0;

  for (const c of compras) {
    if (rango.almacenId && c.almacenId !== rango.almacenId) continue;
    if (!dentroDelRango(c.fecha, rango.desde, rango.hasta)) continue;
    if (c.pesoKg > 0) sumar(porProducto, c.productoId, c.pesoKg);
  }

  for (const s of salidas) {
    if (!s.completa) continue;
    if (rango.almacenId && s.almacenId !== rango.almacenId) continue;
    if (!dentroDelRango(s.fecha, rango.desde, rango.hasta)) continue;
    if (s.pesoNeto <= 0) continue;
    if (s.productoId) {
      sumar(porProducto, s.productoId, s.pesoNeto);
      continue;
    }
    const totalEntrada = s.entradas.reduce((a, e) => a + e.pesoKg, 0);
    if (totalEntrada <= 0) continue;
    kgProporcional += s.pesoNeto;
    for (const e of s.entradas) {
      const parte = (s.pesoNeto * e.pesoKg) / totalEntrada;
      if (e.productoId) sumar(porProducto, e.productoId, parte);
      else kgSinProducto += parte;
    }
  }
  return { porProducto, kgProporcional, kgSinProducto };
}

/** Hay stock que llegó por transformación sin producto (todas las fechas): el stock actual es en parte proporcional. */
export function hayStockHeredado(salidas: SalidaHaciaLote[], almacenId?: string): boolean {
  return salidas.some(
    s => s.completa && !s.productoId && s.pesoNeto > 0 && (!almacenId || s.almacenId === almacenId) &&
      s.entradas.reduce((a, e) => a + e.pesoKg, 0) > 0
  );
}

const redondear = (n: number): number => Math.round(n * 100) / 100;
const kg = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

export interface ItemComposicionEntrada {
  productoId: string;
  producto: string;
  categoria: string;
  kgActual: number;
  kgCompradoPeriodo: number;
}

export interface ArmadoComposicion {
  items: ItemComposicionEntrada[];
  totales: { kgActual: number; kgCompradoPeriodo: number };
  aproximado: boolean;
  nota: string | null;
}

export interface EntradaArmado {
  nombreLote: string;
  stockPorProducto: Array<{ productoId: string; stock: number }>;
  /** Stock total del lote (con o sin producto), para avisar lo que no se puede clasificar. */
  stockTotalKg: number | null;
  productos: Map<string, { nombre: string; categoria: string }>;
  comprado: CompradoPeriodo;
  stockHeredado: boolean;
}

/** Une stock actual y comprado del periodo por producto (nunca inventa productos) y redacta la nota. */
export function armarComposicion(e: EntradaArmado): ArmadoComposicion {
  const actual = new Map<string, number>();
  for (const s of e.stockPorProducto) if (s.stock > UMBRAL_KG_COMPOSICION) sumar(actual, s.productoId, s.stock);

  const ids = new Set<string>([...actual.keys(), ...e.comprado.porProducto.keys()]);
  const items: ItemComposicionEntrada[] = [];
  for (const id of ids) {
    const meta = e.productos.get(id);
    if (!meta) continue;
    items.push({
      productoId: id,
      producto: meta.nombre,
      categoria: meta.categoria,
      kgActual: redondear(actual.get(id) ?? 0),
      kgCompradoPeriodo: redondear(e.comprado.porProducto.get(id) ?? 0),
    });
  }
  items.sort((a, b) => b.kgActual - a.kgActual || b.kgCompradoPeriodo - a.kgCompradoPeriodo || a.producto.localeCompare(b.producto, 'es'));

  const totales = {
    kgActual: redondear(items.reduce((a, i) => a + i.kgActual, 0)),
    kgCompradoPeriodo: redondear(items.reduce((a, i) => a + i.kgCompradoPeriodo, 0)),
  };

  const notas: string[] = [];
  if (e.comprado.kgProporcional > 0) {
    notas.push(
      `Del ${e.nombreLote}, ${kg(e.comprado.kgProporcional)} kg llegaron por transformación; el sistema no guarda qué producto salió a cada lote, así que se reparte en proporción a lo que entró.`
    );
  }
  if (e.stockHeredado) {
    notas.push(`Parte del stock actual del ${e.nombreLote} llegó por transformación y también se reparte en proporción a lo que entró.`);
  }
  if (e.comprado.kgSinProducto > UMBRAL_SIN_CLASIFICAR_KG) {
    notas.push(`${kg(e.comprado.kgSinProducto)} kg de lo que entró a esas transformaciones no tenía producto asignado y no se muestran por producto.`);
  }
  if (e.stockTotalKg != null && e.stockTotalKg - totales.kgActual > UMBRAL_SIN_CLASIFICAR_KG) {
    notas.push(`${kg(e.stockTotalKg - totales.kgActual)} kg del stock del ${e.nombreLote} no tienen producto asignado (suelen venir de conteos de inventario hechos sin detallar el producto), por eso la suma por producto es menor que el stock total.`);
  }

  const aproximado = e.comprado.kgProporcional > 0 || e.stockHeredado;
  return { items, totales, aproximado, nota: notas.length > 0 ? notas.join(' ') : null };
}
