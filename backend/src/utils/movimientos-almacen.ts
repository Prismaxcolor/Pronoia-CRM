// Atribución de movimientos a UN almacén: lógica pura (sin BD) con las mismas
// reglas que stock_almacen() / stock_lote_por_almacen() en SQL.
//
//   compra / venta        -> almacén del ticket (por lote si destino_tipo = 'lote')
//   traslado saliente     -> origen, desde que se CREA (pendiente o completo)
//   traslado entrante     -> destino, solo al COMPLETARSE y por lo recibido
//   transformación entrada-> almacén de la transformación (ferroso: materiales;
//                            pcb: el lote de origen completo)
//   transformación salida -> almacén de la salida, o el de la transformación si
//                            la salida no lo indica; solo con la transformación completa
//   ajustes de inventario -> su almacén, con signo
// Un ticket 'bruto' (pesaje global por recepcionar) no trae renglones: no aporta nada.
import type { MovimientoAlmacen } from '../services/inventario-almacen-desglose.js';

export interface RangoFechasAlmacen { desde?: string; hasta?: string }

export interface TicketAlmacenFila {
  tipo: 'compra' | 'venta';
  fecha: string | null;
  detalle_tickets_pesaje: Array<{ producto_id: string | null; peso_neto: number | null; destino_tipo: string | null; lote_id: string | null }> | null;
}

export interface TrasladoAlmacenFila {
  almacen_origen_id: string | null;
  almacen_destino_id: string | null;
  estado: string;
  created_at: string | null;
  completado_en: string | null;
  detalle_traslado: Array<{ producto_id: string | null; lote_id: string | null; peso_neto: number | null; peso_recibido: number | null }> | null;
}

export interface TransformacionAlmacenFila {
  categoria: string;
  fecha: string | null;
  lote_origen_id: string | null;
  peso_neto: number | null;
  transformacion_entrada_detalle: Array<{ producto_id: string | null; peso_kg: number | null }> | null;
}

export interface SalidaAlmacenFila {
  producto_id: string | null;
  lote_destino_id: string | null;
  peso_neto: number | null;
  transformaciones: { estado: string | null; fecha: string | null } | null;
}

export interface AjusteAlmacenFila {
  producto_id: string | null;
  lote_id: string | null;
  diferencia: number | null;
  created_at: string | null;
}

export interface DatosMovimientosAlmacen {
  tickets: readonly TicketAlmacenFila[];
  traslados: readonly TrasladoAlmacenFila[];
  transformaciones: readonly TransformacionAlmacenFila[];
  salidas: readonly SalidaAlmacenFila[];
  ajustes: readonly AjusteAlmacenFila[];
}

const ESTADOS_TRASLADO_QUE_DESCUENTAN = new Set(['pendiente', 'completo']);

/** ¿La fecha (YYYY-MM-DD o ISO) cae dentro del rango? Sin fecha, no se filtra. */
export function enRangoFechas(fecha: string | null | undefined, rango: RangoFechasAlmacen): boolean {
  if (!fecha) return true;
  const dia = fecha.slice(0, 10);
  if (rango.desde && dia < rango.desde) return false;
  if (rango.hasta && dia > rango.hasta) return false;
  return true;
}

function movimiento(
  tipo: MovimientoAlmacen['tipo'], productoId: string | null, loteId: string | null, peso: unknown
): MovimientoAlmacen {
  return { tipo, productoId, loteId, peso: Number(peso ?? 0) };
}

function deTickets(tickets: readonly TicketAlmacenFila[], rango: RangoFechasAlmacen): MovimientoAlmacen[] {
  const out: MovimientoAlmacen[] = [];
  for (const t of tickets) {
    if (!enRangoFechas(t.fecha, rango)) continue;
    for (const d of t.detalle_tickets_pesaje ?? []) {
      const aLote = d.destino_tipo === 'lote';
      if (aLote && !d.lote_id) continue;
      out.push(movimiento(t.tipo, d.producto_id, aLote ? d.lote_id : null, d.peso_neto));
    }
  }
  return out;
}

function deTraslados(
  almacenId: string, traslados: readonly TrasladoAlmacenFila[], rango: RangoFechasAlmacen
): MovimientoAlmacen[] {
  const out: MovimientoAlmacen[] = [];
  for (const t of traslados) {
    const sale = t.almacen_origen_id === almacenId
      && ESTADOS_TRASLADO_QUE_DESCUENTAN.has(t.estado) && enRangoFechas(t.created_at, rango);
    const entra = t.almacen_destino_id === almacenId && t.estado === 'completo' && enRangoFechas(t.completado_en, rango);
    for (const d of t.detalle_traslado ?? []) {
      if (sale) out.push(movimiento('traslado_salida', d.producto_id, d.lote_id, d.peso_neto));
      if (entra) out.push(movimiento('traslado_entrada', d.producto_id, d.lote_id, d.peso_recibido));
    }
  }
  return out;
}

function deTransformaciones(
  transformaciones: readonly TransformacionAlmacenFila[], salidas: readonly SalidaAlmacenFila[], rango: RangoFechasAlmacen
): MovimientoAlmacen[] {
  const out: MovimientoAlmacen[] = [];
  for (const t of transformaciones) {
    if (!enRangoFechas(t.fecha, rango)) continue;
    if (t.categoria === 'pcb' && t.lote_origen_id) {
      out.push(movimiento('transf_entrada', null, t.lote_origen_id, t.peso_neto));
    } else if (t.categoria === 'ferroso_no_ferroso') {
      for (const e of t.transformacion_entrada_detalle ?? []) out.push(movimiento('transf_entrada', e.producto_id, null, e.peso_kg));
    }
  }
  for (const s of salidas) {
    if (s.transformaciones?.estado !== 'completa' || !enRangoFechas(s.transformaciones.fecha, rango)) continue;
    out.push(movimiento('transf_salida', s.producto_id, s.lote_destino_id, s.peso_neto));
  }
  return out;
}

function deAjustes(ajustes: readonly AjusteAlmacenFila[], rango: RangoFechasAlmacen): MovimientoAlmacen[] {
  return ajustes
    .filter(a => enRangoFechas(a.created_at, rango))
    .map(a => movimiento('ajuste', a.producto_id, a.lote_id, a.diferencia));
}

/** Todos los movimientos que afectan a `almacenId`, ya normalizados. Los datos
 *  de entrada vienen de consultas que ya filtran por este almacén (ticket,
 *  transformación y ajustes) o por origen/destino (traslados). */
export function construirMovimientosAlmacen(
  almacenId: string, datos: DatosMovimientosAlmacen, rango: RangoFechasAlmacen
): MovimientoAlmacen[] {
  return [
    ...deTickets(datos.tickets, rango),
    ...deTraslados(almacenId, datos.traslados, rango),
    ...deTransformaciones(datos.transformaciones, datos.salidas, rango),
    ...deAjustes(datos.ajustes, rango),
  ];
}
