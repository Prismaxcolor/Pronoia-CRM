import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado } from '../utils/paginacion.js';
import { logger } from '../utils/logger.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { esLimpiezaMaterial } from '../utils/inventario-vistas.js';
import { tipoMermaParaDetalle, type DetalleMerma } from '../utils/merma-tipificada.js';
import type {
  AjusteMov,
  EmbalajeContenedor,
  ProductoMeta,
  TicketMov,
  TransformacionMov,
} from '../utils/movimientos-pantalla.js';

/**
 * Lecturas con fecha de la pantalla nueva de inventario (solo lectura, paginadas con orden estable).
 * Cada una es UNA consulta con joins embebidos (sin llamadas RPC por lote). El stock NO se lee aquí:
 * sale de obtenerInventarioAlmacen, igual que el resumen.
 */

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dia = (v: unknown): string | null => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);

interface ProductoFila {
  id: string;
  nombre: string;
  tipo_material_id: string | null;
  tipos_material: { nombre: string } | null;
  estado_limpieza?: string | null;
}

const COLUMNAS_PRODUCTO = 'id, nombre, tipo_material_id, tipos_material(nombre)';

const leerProductosCon = (columnas: string) =>
  leerPaginado<ProductoFila>((d, h) => supabaseAdmin.from('productos').select(columnas).order('id').range(d, h));

/** Productos con su estado de limpieza. Si la columna estado_limpieza aún no existe (migración pendiente), se lee sin ella. */
export async function leerProductos(): Promise<ProductoMeta[]> {
  let filas: ProductoFila[];
  try {
    filas = await leerProductosCon(`${COLUMNAS_PRODUCTO}, estado_limpieza`);
  } catch (err) {
    if (!esObjetoInexistente(err as { code?: string; message?: string })) throw err;
    logger.warn({ evento: 'pantalla_inventario_sin_estado_limpieza', motivo: (err as Error).message });
    filas = await leerProductosCon(COLUMNAS_PRODUCTO);
  }
  return filas.map(p => ({
    id: p.id, nombre: p.nombre, tipoMaterialId: p.tipo_material_id, categoria: p.tipos_material?.nombre ?? 'Sin categoría',
    estadoLimpieza: esLimpiezaMaterial(p.estado_limpieza) ? p.estado_limpieza : null,
  }));
}

export async function leerTickets(): Promise<TicketMov[]> {
  const filas = await leerPaginado<{
    tipo: 'compra' | 'venta';
    fecha: string | null;
    almacen_id: string | null;
    detalle_tickets_pesaje: Array<{ producto_id: string | null; peso_neto: number | string | null; destino_tipo: string | null; lote_id: string | null }> | null;
  }>((d, h) =>
    supabaseAdmin
      .from('tickets_pesaje')
      .select('tipo, fecha, almacen_id, detalle_tickets_pesaje(producto_id, peso_neto, destino_tipo, lote_id)')
      .order('id')
      .range(d, h)
  );
  return filas.map(t => ({
    tipo: t.tipo,
    fecha: dia(t.fecha),
    almacenId: t.almacen_id,
    detalle: (t.detalle_tickets_pesaje ?? []).map(x => ({
      productoId: x.producto_id,
      pesoNeto: num(x.peso_neto),
      loteId: x.destino_tipo === 'lote' ? x.lote_id : null,
    })),
  }));
}

interface TransformacionFila {
  id: string;
  numero: number | string | null;
  categoria: string | null;
  estado: 'bruto' | 'completa';
  fecha: string;
  almacen_id: string | null;
  lote_origen_id: string | null;
  peso_neto: number | string | null;
  transformacion_entrada_detalle: Array<{ producto_id: string | null; peso_kg: number | string | null }> | null;
  transformacion_salida_detalle: Array<{ producto_id: string | null; lote_destino_id: string | null; peso_neto: number | string | null }> | null;
  transformacion_merma_detalle?: Array<{ tipo: string; peso_kg: number | string | null }> | null;
}

const COLUMNAS_TRANSFORMACION =
  'id, numero, categoria, estado, fecha, almacen_id, lote_origen_id, peso_neto, ' +
  'transformacion_entrada_detalle(producto_id, peso_kg), ' +
  'transformacion_salida_detalle(producto_id, lote_destino_id, peso_neto)';

export interface LecturaTransformaciones {
  transformaciones: TransformacionMov[];
  /** La tabla de merma por tipo aún no existe: la merma sale "sin clasificar". */
  sinMermaTipificada: boolean;
}

function leerTransformacionesCon(columnas: string): Promise<TransformacionFila[]> {
  return leerPaginado<TransformacionFila>((d, h) =>
    supabaseAdmin.from('transformaciones').select(columnas).order('id').range(d, h)
  );
}

/** Transformaciones con entradas, salidas y merma tipificada en UNA consulta (todas, para el historial). */
export async function leerTransformaciones(): Promise<LecturaTransformaciones> {
  let filas: TransformacionFila[];
  let sinMermaTipificada = false;
  try {
    filas = await leerTransformacionesCon(`${COLUMNAS_TRANSFORMACION}, transformacion_merma_detalle(tipo, peso_kg)`);
  } catch (err) {
    // La tabla de merma por tipo es de la migración de la Fase 1: si falta, se lee sin ella (con aviso).
    if (!esObjetoInexistente(err as { code?: string; message?: string }) && !/relationship|schema cache/i.test(String((err as Error)?.message))) throw err;
    logger.warn({ evento: 'pantalla_inventario_sin_merma_tipificada', motivo: (err as Error).message });
    filas = await leerTransformacionesCon(COLUMNAS_TRANSFORMACION);
    sinMermaTipificada = true;
  }
  return {
    sinMermaTipificada,
    transformaciones: filas.map(t => ({
      id: t.id,
      numero: t.numero != null ? Number(t.numero) : null,
      categoria: t.categoria ?? 'ferroso_no_ferroso',
      estado: t.estado,
      fecha: String(t.fecha).slice(0, 10),
      almacenId: t.almacen_id,
      loteOrigenId: t.lote_origen_id,
      pesoNeto: num(t.peso_neto),
      entradas: (t.transformacion_entrada_detalle ?? []).map(e => ({ productoId: e.producto_id, pesoKg: num(e.peso_kg) })),
      salidas: (t.transformacion_salida_detalle ?? []).map(s => ({ productoId: s.producto_id, loteDestinoId: s.lote_destino_id, pesoNeto: num(s.peso_neto) })),
      merma: (t.transformacion_merma_detalle ?? []).flatMap((m): DetalleMerma[] => {
        const tipo = tipoMermaParaDetalle(m.tipo);
        return tipo ? [{ tipo, pesoKg: num(m.peso_kg) }] : [];
      }),
    })),
  };
}

export async function leerAjustes(): Promise<AjusteMov[]> {
  const filas = await leerPaginado<{
    producto_id: string | null;
    lote_id: string | null;
    almacen_id: string | null;
    diferencia: number | string | null;
    created_at: string | null;
  }>((d, h) =>
    supabaseAdmin.from('ajustes_inventario').select('producto_id, lote_id, almacen_id, diferencia, created_at').order('id').range(d, h)
  );
  return filas.flatMap(a => {
    const fecha = dia(a.created_at);
    return fecha ? [{ productoId: a.producto_id, loteId: a.lote_id, almacenId: a.almacen_id, diferencia: num(a.diferencia), fecha }] : [];
  });
}

/** Embalajes vigentes con su contenedor. Tabla aún inexistente = []; cualquier otro fallo se propaga. */
export async function leerEmbalajesConContenedor(): Promise<EmbalajeContenedor[]> {
  try {
    const filas = await leerPaginado<{ lote_id: string; peso_kg: number | string; contenedor: string | null }>((d, h) =>
      supabaseAdmin.from('lote_embalajes').select('lote_id, peso_kg, contenedor').eq('anulado', false).order('id').range(d, h)
    );
    return filas.map(f => ({ loteId: f.lote_id, pesoKg: num(f.peso_kg), contenedor: f.contenedor }));
  } catch (err) {
    if (esObjetoInexistente(err as { code?: string; message?: string })) return [];
    throw err;
  }
}
