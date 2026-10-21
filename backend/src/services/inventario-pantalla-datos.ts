import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado } from '../utils/paginacion.js';
import { logger } from '../utils/logger.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { diaNegocio } from '../utils/fecha-negocio.js';
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

export interface LecturaCompletadoEn {
  /** id de la transformación completa -> día de negocio (YYYY-MM-DD) en que se completó. */
  porId: Map<string, string>;
  /** false = la columna completado_en no existe aún: las salidas se fechan con la fecha de la transformación. */
  disponible: boolean;
}

/** Día en que se completó cada transformación (solo para el saldo a una fecha). Columna inexistente = disponible: false. */
export async function leerCompletadoEnTransformaciones(): Promise<LecturaCompletadoEn> {
  try {
    const filas = await leerPaginado<{ id: string; completado_en: string | null }>((d, h) =>
      supabaseAdmin.from('transformaciones').select('id, completado_en').eq('estado', 'completa').order('id').range(d, h)
    );
    const porId = new Map<string, string>();
    for (const f of filas) {
      const dia = diaNegocio(f.completado_en);
      if (dia) porId.set(f.id, dia);
    }
    return { porId, disponible: true };
  } catch (err) {
    if (!esObjetoInexistente(err as { code?: string; message?: string })) throw err;
    logger.warn({ evento: 'saldo_fecha_sin_completado_en', motivo: (err as Error).message });
    return { porId: new Map(), disponible: false };
  }
}

/** Fecha más temprana de una columna de una tabla (null si no hay filas con valor). Una sola fila: orden ascendente con nulos al final. */
async function fechaMasAntigua(tabla: string, columna: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from(tabla).select(columna).order(columna, { ascending: true }).limit(1);
  if (error) throw error;
  const fila = ((data ?? []) as unknown as Array<Record<string, unknown>>)[0];
  return fila ? dia(fila[columna]) : null;
}

/**
 * Fecha (YYYY-MM-DD) del movimiento más antiguo registrado (tickets, transformaciones o ajustes); null = no hay ninguno.
 * Misma definición que primerRegistro() de la pantalla, pero con 3 consultas de una fila en vez de leer todos los movimientos:
 * sirve al resumen para avisar «sin datos antes de esta fecha» cuando el saldo pedido es anterior al primer registro.
 */
export async function leerPrimerRegistro(): Promise<string | null> {
  const [ticket, transformacion, ajuste] = await Promise.all([
    fechaMasAntigua('tickets_pesaje', 'fecha'),
    fechaMasAntigua('transformaciones', 'fecha'),
    fechaMasAntigua('ajustes_inventario', 'created_at'),
  ]);
  const fechas = [ticket, transformacion, ajuste].filter((f): f is string => f !== null);
  return fechas.length === 0 ? null : fechas.reduce((a, b) => (b < a ? b : a));
}
