import { supabaseAdmin } from '../config/supabase.js';
import type { CrearLoteInput, ActualizarLoteInput } from '../schemas/lotes.js';
import type { ComposicionPCBItem, ClaseLote, EmbaladoLote } from '../../../shared/types/lote.js';
import { registrarAuditoria } from './auditoria-service.js';
import { ADVERTENCIA_AUDITORIA, cargarEmbalajesVigentes, nombresDeUsuarios } from './lote-embalaje-service.js';
import { mensajeDeErrorBd } from '../utils/errores-bd.js';
import { logger } from '../utils/logger.js';
import { construirUpdateClasificacion, leerClasificacion } from '../utils/lote-clasificacion.js';
import { resumirEmbalado, resumirEmbaladoPorAlmacen, type EmbalajeParaResumen } from '../utils/embalaje-lote.js';
import { esObjetoInexistente, MENSAJE_INVENTARIO_NO_HABILITADO } from '../utils/migracion-pendiente.js';

interface LoteRow {
  id: string;
  nombre: string;
  activo: boolean;
  fotos: string[];
  created_at: string;
  /** Columnas de migration_inventario_rediseno_fase1.sql: ausentes hasta aplicarla. */
  clase?: string | null;
  precio_estimado_kg?: number | string | null;
  precio_estimado_actualizado_en?: string | null;
  precio_estimado_actualizado_por?: string | null;
}

export interface StockLoteAlmacen {
  almacenId: string;
  almacenNombre: string;
  stockKg: number;
  /** Composición de ESTE lote EN ESTE almacén — no es la misma que en otro
   *  almacén: cada uno acumula sus propias compras/transformaciones/
   *  traslados recibidos por separado (ver composicion_lote_almacen() en
   *  docs/migration_lote_composicion_por_almacen.sql). */
  composicion: ComposicionPCBItem[];
}

export interface LotePublico {
  id: string;
  nombre: string;
  activo: boolean;
  clase: ClaseLote;
  /** USD/kg aproximado de VENTA cargado a mano; null = sin precio. */
  precioEstimadoKg: number | null;
  precioEstimadoActualizadoEn: string | null;
  precioEstimadoActualizadoPorNombre: string | null;
  /** Embalado por kilos (parte embalada / parte en saca). */
  embalado: EmbaladoLote;
  /** Un lote ya no vive en un solo almacén: puede tener porciones repartidas
   *  entre varios (ver docs/migration_lote_stock_por_almacen.sql). Este
   *  desglose es 100% derivado de compras/traslados/transformaciones/ajustes,
   *  nunca un campo editable a mano. */
  stockPorAlmacen: StockLoteAlmacen[];
  fotos: string[];
  composicion: ComposicionPCBItem[];
  createdAt: string;
  stockKg: number;
}

interface ExtrasLote {
  embalajes: readonly EmbalajeParaResumen[];
  nombres: ReadonlyMap<string, string>;
}

const SIN_EXTRAS: ExtrasLote = { embalajes: [], nombres: new Map() };

/** Embalado de cada almacén (recortado a su stock) pegado al desglose por almacén. */
function conEmbaladoPorAlmacen(stockPorAlmacen: StockLoteAlmacen[], embalajes: readonly EmbalajeParaResumen[]): StockLoteAlmacen[] {
  const porAlmacen = resumirEmbaladoPorAlmacen(stockPorAlmacen, embalajes);
  return stockPorAlmacen.map(s => {
    const r = porAlmacen.find(a => a.almacenId === s.almacenId);
    return r ? { ...s, embaladoKg: r.embaladoKg, enSacaKg: r.enSacaKg } : s;
  });
}

function toPublico(
  row: LoteRow,
  stockKg = 0,
  composicion: ComposicionPCBItem[] = [],
  stockPorAlmacen: StockLoteAlmacen[] = [],
  extras: ExtrasLote = SIN_EXTRAS
): LotePublico {
  const clasificacion = leerClasificacion(row);
  return {
    id: row.id,
    nombre: row.nombre,
    activo: row.activo,
    clase: clasificacion.clase,
    precioEstimadoKg: clasificacion.precioEstimadoKg,
    precioEstimadoActualizadoEn: row.precio_estimado_actualizado_en ?? null,
    precioEstimadoActualizadoPorNombre: row.precio_estimado_actualizado_por
      ? extras.nombres.get(row.precio_estimado_actualizado_por) ?? null
      : null,
    embalado: resumirEmbalado(stockKg, extras.embalajes),
    stockPorAlmacen: conEmbaladoPorAlmacen(stockPorAlmacen, extras.embalajes),
    fotos: row.fotos ?? [],
    composicion,
    createdAt: row.created_at,
    stockKg,
  };
}

interface ComposicionLoteRow {
  producto_nombre: string;
  porcentaje: number;
}

/** Composición de un lote — SIEMPRE calculada a partir de lo realmente
 *  pesado por producto dentro del lote (regla de tres), nunca declarada a
 *  mano: si entraron 250kg de A y 250kg de B, el sistema ya sabe que es
 *  50%/50%, no hace falta que nadie lo configure. */
async function composicionPorLote(ids: string[]): Promise<Map<string, ComposicionPCBItem[]>> {
  const entradas = await Promise.all(
    ids.map(async id => {
      const { data } = await supabaseAdmin.rpc('composicion_lote', { p_lote_id: id });
      const items: ComposicionPCBItem[] = ((data as ComposicionLoteRow[] | null) ?? []).map(r => ({
        item: r.producto_nombre,
        porcentaje: Number(r.porcentaje),
      }));
      return [id, items] as const;
    })
  );
  return new Map(entradas);
}

/** Postgres lanza 23505 al violar el índice único de nombre. */
function esNombreDuplicado(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** stock_lote_total() por lote (Bloque 40) — la cantidad de lotes es chica
 *  (decenas, no miles), así que N llamadas RPC en paralelo es más simple que
 *  mantener un balance corriente. */
async function stockPorLote(ids: string[]): Promise<Map<string, number>> {
  const entradas = await Promise.all(
    ids.map(async id => {
      const { data } = await supabaseAdmin.rpc('stock_lote_total', { p_lote_id: id });
      return [id, Number(data ?? 0)] as const;
    })
  );
  return new Map(entradas);
}

interface StockLoteAlmacenRow {
  almacen_id: string;
  stock: number;
}

interface ComposicionLoteAlmacenRow {
  producto_nombre: string;
  porcentaje: number;
}

/** composicion_lote_almacen() para un (lote, almacén) puntual — la
 *  composición REAL de ese lote en ESE almacén, no la mezcla global. */
async function composicionDeLoteEnAlmacen(loteId: string, almacenId: string): Promise<ComposicionPCBItem[]> {
  const { data } = await supabaseAdmin.rpc('composicion_lote_almacen', {
    p_lote_id: loteId,
    p_almacen_id: almacenId,
  });
  return ((data as ComposicionLoteAlmacenRow[] | null) ?? []).map(r => ({
    item: r.producto_nombre,
    porcentaje: Number(r.porcentaje),
  }));
}

/** stock_lote_por_almacen() por lote — desglose de en qué almacén(es) vive
 *  cada lote hoy, con la composición propia de cada uno (ver
 *  docs/migration_lote_composicion_por_almacen.sql). La cantidad de pares
 *  (lote, almacén) con stock real es chica (decenas), así que N llamadas
 *  RPC en paralelo es más simple que traer todo en una sola consulta. */
async function stockPorAlmacenPorLote(ids: string[]): Promise<Map<string, StockLoteAlmacen[]>> {
  const { data: almacenes } = await supabaseAdmin.from('almacenes').select('id, nombre');
  const nombrePorAlmacen = new Map((almacenes ?? []).map(a => [a.id as string, a.nombre as string]));

  const entradas = await Promise.all(
    ids.map(async id => {
      const { data } = await supabaseAdmin.rpc('stock_lote_por_almacen', { p_lote_id: id });
      const filas = ((data as StockLoteAlmacenRow[] | null) ?? []).filter(r => Math.abs(Number(r.stock)) > 0.01);
      const items: StockLoteAlmacen[] = await Promise.all(
        filas.map(async r => ({
          almacenId: r.almacen_id,
          almacenNombre: nombrePorAlmacen.get(r.almacen_id) ?? '—',
          stockKg: Number(r.stock),
          composicion: await composicionDeLoteEnAlmacen(id, r.almacen_id),
        }))
      );
      return [id, items] as const;
    })
  );
  return new Map(entradas);
}

export async function listarLotes(): Promise<LotePublico[]> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  const rows = data as LoteRow[];
  const ids = rows.map(r => r.id);
  const [stocks, composiciones, stocksPorAlmacen, embalajes, nombres] = await Promise.all([
    stockPorLote(ids),
    composicionPorLote(ids),
    stockPorAlmacenPorLote(ids),
    cargarEmbalajesVigentes(),
    nombresDeUsuarios(rows.map(r => r.precio_estimado_actualizado_por ?? null)),
  ]);
  return rows.map(r =>
    toPublico(r, stocks.get(r.id) ?? 0, composiciones.get(r.id) ?? [], stocksPorAlmacen.get(r.id) ?? [], {
      embalajes: embalajes.filter(e => e.loteId === r.id),
      nombres,
    })
  );
}

export async function crearLote(
  input: CrearLoteInput
): Promise<{ lote: LotePublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('lotes')
    .insert({ nombre: input.nombre, fotos: input.fotos ?? [] })
    .select('*')
    .single();

  if (error || !data) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe un lote con ese nombre.' };
    return { error: mensajeDeErrorBd(error, 'No se pudo crear el lote.') };
  }
  // Recién creado: sin stock ni composición todavía — el almacén se deriva
  // recién cuando entre el primer material (compra o transformación).
  return { lote: toPublico(data as LoteRow) };
}

/** Quién edita (para sellar el precio estimado y registrar la auditoría). */
export interface ActorLote {
  userId: string;
  email?: string;
}

/** Lo que el backend responde cuando la BD aún no tiene las columnas de clase/precio. */
export const MENSAJE_CLASIFICACION_NO_HABILITADA = MENSAJE_INVENTARIO_NO_HABILITADO;

export async function actualizarLote(
  id: string,
  cambios: ActualizarLoteInput,
  actor?: ActorLote
): Promise<{ lote: LotePublico; advertencia?: string } | { error: string }> {
  const update: Record<string, unknown> = {};
  const advertencias: string[] = [];
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.activo !== undefined) update.activo = cambios.activo;
  if (cambios.fotos !== undefined) update.fotos = cambios.fotos;

  let cambiosClasificacion: ReturnType<typeof construirUpdateClasificacion>['cambios'] = {};
  if (cambios.clase !== undefined || cambios.precioEstimadoKg !== undefined) {
    const { data: previoRow } = await supabaseAdmin.from('lotes').select('*').eq('id', id).maybeSingle();
    if (!previoRow) return { error: 'Lote no encontrado.' };
    const clasificacion = construirUpdateClasificacion(
      leerClasificacion(previoRow as LoteRow),
      { clase: cambios.clase, precioEstimadoKg: cambios.precioEstimadoKg },
      actor?.userId ?? null,
      new Date()
    );
    Object.assign(update, clasificacion.update);
    cambiosClasificacion = clasificacion.cambios;
  }
  // Nada que escribir (p. ej. se envió el mismo precio que ya tenía): devuelve el lote tal cual.
  if (Object.keys(update).length === 0) {
    const { data: actual } = await supabaseAdmin.from('lotes').select('*').eq('id', id).maybeSingle();
    if (!actual) return { error: 'Lote no encontrado.' };
    return conAdvertencias(await armarLotePublico(actual as LoteRow), advertencias);
  }

  const { data, error } = await supabaseAdmin
    .from('lotes')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    if (esNombreDuplicado(error)) return { error: 'Ya existe un lote con ese nombre.' };
    if (esObjetoInexistente(error)) return { error: MENSAJE_CLASIFICACION_NO_HABILITADA };
    return { error: mensajeDeErrorBd(error, 'No se pudo actualizar el lote.') };
  }
  if (!data) return { error: 'Lote no encontrado.' };

  if (actor && Object.keys(cambiosClasificacion).length > 0) {
    const auditada = await registrarAuditoria({
      entidadTipo: 'lote',
      entidadId: id,
      accion: 'clasificacion',
      usuarioId: actor.userId,
      usuarioEmail: actor.email,
      cambios: cambiosClasificacion,
    });
    if (!auditada) advertencias.push(ADVERTENCIA_AUDITORIA);
  }
  return conAdvertencias(await armarLotePublico(data as LoteRow), advertencias);
}

function conAdvertencias(r: { lote: LotePublico; advertencia?: string }, advertencias: readonly string[]) {
  const todas = [...advertencias, ...(r.advertencia ? [r.advertencia] : [])];
  return todas.length > 0 ? { lote: r.lote, advertencia: todas.join(' ') } : { lote: r.lote };
}

/** A diferencia de crearLote() (stock siempre 0 recién creado), un lote editado puede ya tener
 *  stock, composición y embalajes reales: hay que leerlos. */
async function armarLotePublico(row: LoteRow): Promise<{ lote: LotePublico; advertencia?: string }> {
  const id = row.id;
  // Ya se guardó el cambio: si los embalajes no se pueden leer, se devuelve el lote igual pero SE AVISA
  // (no se muestra un embalado en 0 como si fuera real).
  let falloEmbalajes = false;
  const [stocks, composiciones, stocksPorAlmacen, embalajes, nombres] = await Promise.all([
    stockPorLote([id]),
    composicionPorLote([id]),
    stockPorAlmacenPorLote([id]),
    cargarEmbalajesVigentes().catch(err => {
      falloEmbalajes = true;
      logger.warn({ evento: 'lote_embalajes_no_leidos_tras_guardar', loteId: id, motivo: err instanceof Error ? err.message : String(err) });
      return [];
    }),
    nombresDeUsuarios([row.precio_estimado_actualizado_por ?? null]),
  ]);
  const lote = toPublico(row, stocks.get(id) ?? 0, composiciones.get(id) ?? [], stocksPorAlmacen.get(id) ?? [], {
    embalajes: embalajes.filter(e => e.loteId === id),
    nombres,
  });
  return falloEmbalajes
    ? { lote, advertencia: 'El cambio se guardó, pero no se pudieron leer los embalajes: el embalado que se muestra no es confiable. Recarga la página.' }
    : { lote };
}
