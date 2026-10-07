import { supabaseAdmin } from '../config/supabase.js';
import { formatCodigoTransformacion } from '../utils/codigos.js';
import { leerPaginado } from '../utils/paginacion.js';
import { esErrorFuncionInexistente } from './ticket-principal.js';
import { validarSalidasMixtasPorCategoria } from '../schemas/transformaciones.js';
import { completarAlmacenSalidas } from '../utils/almacen-salida-transformacion.js';
import { almacenPorDefectoSalidas } from './transformacion-almacen-salida-service.js';
import { cargarMermaDetalle, leerMermaDetalle, registrarMermaAlCompletar, validarMermaContraNetos } from './merma-tipificada-service.js';
import {
  resumirMermaPorCategoria,
  resumirMermaPorTipo,
  type DetalleMerma,
  type ResumenMermaCategoria,
  type ResumenMermaPorTipo,
} from '../utils/merma-tipificada.js';
import {
  construirFilaMerma,
  filtrarPorProducto,
  resumirMerma,
  type AgrupacionMerma,
  type FilaMerma,
  type PeriodoMerma,
  type ResumenMerma,
} from '../utils/merma-transformacion.js';
import type {
  CrearTransformacionInput,
  CompletarTransformacionInput,
  CrearTransformacionFerrosoInput,
  CompletarTransformacionFerrosoInput,
  CrearTransformacionPCBInput,
  CompletarTransformacionPCBInput,
  CompletarTransformacionMixtaInput,
  SalidaMixtaInput,
} from '../schemas/transformaciones.js';

interface EntradaDetalleRow {
  producto_id: string;
  peso_kg: number;
  productos?: { nombre: string } | null;
}

interface SalidaDetalleRow {
  id: string;
  producto_id: string | null;
  lote_destino_id: string | null;
  almacen_id: string | null;
  peso_bruto: number;
  tara: number;
  peso_neto: number;
  fotos: string[] | null;
  productos?: { nombre: string } | null;
  lotes?: { nombre: string } | null;
  almacenes?: { nombre: string } | null;
}

interface TransformacionRow {
  id: string;
  numero: number | string | null;
  categoria: string;
  producto_entrada_id: string | null;
  almacen_id: string | null;
  lote_origen_id: string | null;
  peso_bruto: number;
  tara: number;
  peso_neto: number;
  fotos_entrada: string[] | null;
  fecha: string;
  estado: 'bruto' | 'completa';
  notas: string | null;
  registrado_por: string | null;
  completado_por: string | null;
  completado_en: string | null;
  created_at: string;
  productos?: { nombre: string } | null;
  lotes?: { nombre: string } | null;
  transformacion_entrada_detalle?: EntradaDetalleRow[] | null;
  transformacion_salida_detalle?: SalidaDetalleRow[] | null;
}

export interface TransformacionPublica {
  id: string;
  numero: number | null;
  /** Correlativo legible, ej. "TR-0001". */
  codigo: string | null;
  categoria: string;
  productoEntradaId: string | null;
  nombreProductoEntrada: string | null;
  almacenId: string | null;
  loteOrigenId: string | null;
  nombreLoteOrigen: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotosEntrada: string[];
  fecha: string;
  estado: 'bruto' | 'completa';
  notas: string | null;
  registradoPor: string | null;
  completadoPor: string | null;
  completadoEn: string | null;
  createdAt: string;
  /** Merma tipificada (basura, plástico...). Solo viene al leer UNA transformación, no en el listado. */
  mermaDetalle?: DetalleMerma[];
  entradaDetalle: Array<{ productoId: string; nombreProducto: string; pesoKg: number }>;
  salidas: Array<{
    id: string;
    productoId: string | null;
    nombreProducto: string | null;
    loteDestinoId: string | null;
    nombreLoteDestino: string | null;
    almacenId: string | null;
    nombreAlmacen: string | null;
    pesoBruto: number;
    tara: number;
    pesoNeto: number;
    fotos: string[];
    tipoSalida?: 'material' | 'lote' | 'material_a_lote';
  }>;
}

/** material = producto sin lote; lote = lote sin producto; material_a_lote = ambos. */
function derivarTipoSalida(d: Pick<SalidaDetalleRow, 'producto_id' | 'lote_destino_id'>): 'material' | 'lote' | 'material_a_lote' | undefined {
  if (d.producto_id && d.lote_destino_id) return 'material_a_lote';
  if (d.lote_destino_id) return 'lote';
  return d.producto_id ? 'material' : undefined;
}

function toPublico(row: TransformacionRow): TransformacionPublica {
  return {
    id: row.id,
    numero: row.numero != null ? Number(row.numero) : null,
    codigo: row.numero != null ? formatCodigoTransformacion(Number(row.numero)) : null,
    categoria: row.categoria ?? 'ferroso_no_ferroso',
    productoEntradaId: row.producto_entrada_id,
    nombreProductoEntrada: row.productos?.nombre ?? null,
    almacenId: row.almacen_id,
    loteOrigenId: row.lote_origen_id,
    nombreLoteOrigen: row.lotes?.nombre ?? null,
    pesoBruto: Number(row.peso_bruto),
    tara: Number(row.tara),
    pesoNeto: Number(row.peso_neto),
    fotosEntrada: row.fotos_entrada ?? [],
    fecha: row.fecha,
    estado: row.estado,
    notas: row.notas,
    registradoPor: row.registrado_por,
    completadoPor: row.completado_por,
    completadoEn: row.completado_en,
    createdAt: row.created_at,
    entradaDetalle: (row.transformacion_entrada_detalle ?? []).map(d => ({
      productoId: d.producto_id,
      nombreProducto: d.productos?.nombre ?? '—',
      pesoKg: Number(d.peso_kg),
    })),
    salidas: (row.transformacion_salida_detalle ?? []).map(d => ({
      id: d.id,
      productoId: d.producto_id,
      nombreProducto: d.productos?.nombre ?? null,
      loteDestinoId: d.lote_destino_id,
      nombreLoteDestino: d.lotes?.nombre ?? null,
      almacenId: d.almacen_id,
      nombreAlmacen: d.almacenes?.nombre ?? null,
      pesoBruto: Number(d.peso_bruto),
      tara: Number(d.tara),
      pesoNeto: Number(d.peso_neto),
      fotos: d.fotos ?? [],
      tipoSalida: derivarTipoSalida(d),
    })),
  };
}

const SELECT_TRANSFORMACION =
  '*, ' +
  'productos(nombre), ' +
  'lotes(nombre), ' +
  'transformacion_entrada_detalle(producto_id, peso_kg, productos(nombre)), ' +
  'transformacion_salida_detalle(id, producto_id, lote_destino_id, almacen_id, peso_bruto, tara, peso_neto, fotos, productos(nombre), lotes(nombre), almacenes(nombre))';

export async function obtenerTransformacion(id: string): Promise<TransformacionPublica | null> {
  const { data, error } = await supabaseAdmin
    .from('transformaciones')
    .select(SELECT_TRANSFORMACION)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  const publica = toPublico(data as unknown as TransformacionRow);
  return { ...publica, mermaDetalle: await leerMermaDetalle(id) };
}

export interface ListarTransformacionesOpts {
  desde?: string;
  hasta?: string;
  estado?: 'bruto' | 'completa';
  categoria?: string;
}

export async function listarTransformaciones(
  opts: ListarTransformacionesOpts = {}
): Promise<TransformacionPublica[]> {
  // PostgREST corta en 1000 filas: se pagina con orden estable (created_at, id)
  // para que ni el listado ni el reporte de merma se trunquen en silencio.
  const filas = await leerPaginado<TransformacionRow>((desde, hasta) => {
    let query = supabaseAdmin
      .from('transformaciones')
      .select(SELECT_TRANSFORMACION)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (opts.desde) query = query.gte('fecha', opts.desde);
    if (opts.hasta) query = query.lte('fecha', opts.hasta);
    if (opts.estado) query = query.eq('estado', opts.estado);
    if (opts.categoria) query = query.eq('categoria', opts.categoria);

    return query.range(desde, hasta);
  });
  return filas.map(toPublico);
}

export interface ReporteMermaOpts extends ListarTransformacionesOpts {
  almacenId?: string;
  productoId?: string;
  agrupar?: AgrupacionMerma;
}

export interface FilaMermaPublica extends FilaMerma {
  nombreAlmacen: string | null;
}

export interface ReporteMerma {
  agrupar: AgrupacionMerma;
  filas: FilaMermaPublica[];
  periodos: PeriodoMerma[];
  totales: ResumenMerma;
  /** Desglose de la merma del rango por tipo (kg y %) y "sin clasificar". */
  porTipo: ResumenMermaPorTipo;
  /** Lo mismo, separado por categoría de transformación (ferroso_no_ferroso, pcb...). */
  porCategoria: ResumenMermaCategoria[];
}

async function nombresDeAlmacenes(): Promise<Map<string, string>> {
  const { data: almacenes } = await supabaseAdmin.from('almacenes').select('id, nombre');
  return new Map(((almacenes ?? []) as Array<{ id: string; nombre: string }>).map(a => [a.id, a.nombre]));
}

function armarReporteMerma(
  seleccion: readonly TransformacionPublica[],
  mermaPorId: ReadonlyMap<string, DetalleMerma[]>,
  nombres: ReadonlyMap<string, string>,
  agrupar: AgrupacionMerma
): ReporteMerma {
  const filas = seleccion.map(t => construirFilaMerma({ ...t, mermaDetalle: mermaPorId.get(t.id) }));
  const { periodos, totales } = resumirMerma(filas, agrupar);
  return {
    agrupar,
    filas: filas.map(f => ({ ...f, nombreAlmacen: f.almacenId ? nombres.get(f.almacenId) ?? null : null })),
    periodos,
    totales,
    porTipo: resumirMermaPorTipo(filas),
    porCategoria: resumirMermaPorCategoria(filas),
  };
}

const masRecientePrimero = (a: TransformacionPublica, b: TransformacionPublica) =>
  b.fecha.localeCompare(a.fecha) || (b.numero ?? 0) - (a.numero ?? 0);

/** Histórico de merma derivado de las transformaciones completas (sin tabla propia):
 *  merma = neto de entrada - suma del neto de todas las salidas (materiales y/o lotes).
 *  El rango desde/hasta filtra por la fecha de la transformación. */
export async function reporteMerma(opts: ReporteMermaOpts = {}): Promise<ReporteMerma> {
  const agrupar = opts.agrupar ?? 'mes';
  const todas = await listarTransformaciones({
    desde: opts.desde,
    hasta: opts.hasta,
    categoria: opts.categoria,
    estado: 'completa',
  });
  const porAlmacen = opts.almacenId ? todas.filter(t => t.almacenId === opts.almacenId) : todas;
  const seleccion = filtrarPorProducto(porAlmacen, opts.productoId).sort(masRecientePrimero);

  const [nombres, mermaPorId] = await Promise.all([
    nombresDeAlmacenes(),
    cargarMermaDetalle(new Set(seleccion.map(t => t.id))),
  ]);
  return armarReporteMerma(seleccion, mermaPorId, nombres, agrupar);
}

export interface RangoMerma {
  desde: string;
  hasta: string;
}

export interface ReportesMermaPeriodos {
  actual: ReporteMerma;
  previo: ReporteMerma;
  /** Lecturas que fallaron y se reemplazaron por vacío (la cifra afectada no es completa). */
  avisos: string[];
}

/**
 * Merma de un período y del período anterior (contiguo) con UNA sola lectura de transformaciones,
 * de almacenes y del desglose por tipo (en vez de repetirlas por período). Si falla solo el
 * desglose por tipo, los totales siguen siendo válidos: la merma queda "sin clasificar" y se avisa.
 */
export async function reportesMermaDosPeriodos(actual: RangoMerma, previo: RangoMerma): Promise<ReportesMermaPeriodos> {
  const avisos: string[] = [];
  const todas = await listarTransformaciones({ desde: previo.desde, hasta: actual.hasta, estado: 'completa' });
  const ordenadas = [...todas].sort(masRecientePrimero);
  const delRango = (r: RangoMerma) => ordenadas.filter(t => t.fecha >= r.desde && t.fecha <= r.hasta);

  const [nombres, mermaPorId] = await Promise.all([
    nombresDeAlmacenes(),
    cargarMermaDetalle(new Set(ordenadas.map(t => t.id))).catch(() => {
      avisos.push('No se pudo leer el desglose de merma por tipo: la merma aparece como sin clasificar.');
      return new Map<string, DetalleMerma[]>();
    }),
  ]);
  return {
    actual: armarReporteMerma(delRango(actual), mermaPorId, nombres, 'mes'),
    previo: armarReporteMerma(delRango(previo), mermaPorId, nombres, 'mes'),
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Merma tipificada opcional al completar
// ---------------------------------------------------------------------------

const netoDeSalida = (s: { pesoBruto: number; tara: number }) => s.pesoBruto - s.tara;

/** Valida el desglose opcional de merma contra el balance ANTES de completar (así no se
 *  completa una transformación cuyo desglose luego no se podría guardar). null si es válido o no hay. */
async function prevalidarMerma(
  id: string,
  mermaDetalle: CompletarTransformacionFerrosoInput['mermaDetalle'],
  salidas: ReadonlyArray<{ pesoBruto: number; tara: number }>
): Promise<string | null> {
  if (!mermaDetalle || mermaDetalle.length === 0) return null;
  const { data: cab } = await supabaseAdmin.from('transformaciones').select('peso_neto').eq('id', id).maybeSingle();
  if (!cab) return null; // la RPC de completar responde "no encontrada" con su propio mensaje
  return validarMermaContraNetos(Number(cab.peso_neto ?? 0), salidas.map(netoDeSalida), mermaDetalle);
}

/** Legacy: retira de lote-pool. */
export async function crearTransformacion(
  input: CrearTransformacionInput,
  registradoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { data: id, error } = await supabaseAdmin.rpc('crear_transformacion', {
    p_lote_origen_id: input.loteOrigenId,
    p_peso_bruto: input.pesoBruto,
    p_tara: input.tara,
    p_fecha: input.fecha,
    p_notas: input.notas,
    p_registrado_por: registradoPor,
  });

  if (error || !id) return { error: error?.message ?? 'No se pudo registrar la transformación.' };
  const transformacion = await obtenerTransformacion(id as string);
  if (!transformacion) return { error: 'La transformación se creó pero no se pudo leer de vuelta.' };
  return { transformacion };
}

/** Ferroso/No Ferroso: retira producto sin lote de un almacén. */
export async function crearTransformacionFerroso(
  input: CrearTransformacionFerrosoInput,
  registradoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { data: id, error } = await supabaseAdmin.rpc('crear_transformacion_ferroso', {
    p_producto_entrada_id: input.productoEntradaId,
    p_almacen_id: input.almacenId,
    p_peso_bruto: input.pesoBruto,
    p_tara: input.tara,
    p_fecha: input.fecha,
    p_notas: input.notas ?? null,
    p_fotos_entrada: input.fotosEntrada,
    p_registrado_por: registradoPor,
  });

  if (error || !id) return { error: error?.message ?? 'No se pudo registrar la transformación.' };
  const transformacion = await obtenerTransformacion(id as string);
  if (!transformacion) return { error: 'La transformación se creó pero no se pudo leer de vuelta.' };
  return { transformacion };
}

/** Legacy: completa con salidas a lotes. */
export async function completarTransformacion(
  id: string,
  input: CompletarTransformacionInput,
  completadoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { error } = await supabaseAdmin.rpc('completar_transformacion', {
    p_transformacion_id: id,
    p_salidas: input.salidas.map(s => ({
      lote_destino_id: s.loteDestinoId,
      peso_bruto: s.pesoBruto,
      tara: s.tara,
    })),
    p_completado_por: completadoPor,
  });

  if (error) return { error: error.message };
  const transformacion = await obtenerTransformacion(id);
  if (!transformacion) return { error: 'La transformación se completó pero no se pudo leer de vuelta.' };
  return { transformacion };
}

/** Ferroso/No Ferroso: completa con materiales de salida (sin lote). */
export async function completarTransformacionFerroso(
  id: string,
  input: CompletarTransformacionFerrosoInput,
  completadoPor: string
): Promise<{ transformacion: TransformacionPublica; advertencia?: string } | { error: string }> {
  const mermaInvalida = await prevalidarMerma(id, input.mermaDetalle, input.salidas);
  if (mermaInvalida) return { error: mermaInvalida };

  const { error } = await supabaseAdmin.rpc('completar_transformacion_ferroso', {
    p_transformacion_id: id,
    p_salidas: input.salidas.map(s => ({
      producto_id: s.productoId,
      peso_bruto: s.pesoBruto,
      tara: s.tara,
      fotos: s.fotos,
    })),
    p_completado_por: completadoPor,
  });

  if (error) return { error: error.message };
  const { advertencia } = await registrarMermaAlCompletar(id, input.mermaDetalle, completadoPor);
  const transformacion = await obtenerTransformacion(id);
  if (!transformacion) return { error: 'La transformación se completó pero no se pudo leer de vuelta.' };
  return { transformacion, ...(advertencia ? { advertencia } : {}) };
}

export interface BorrarTransformacionResult { ok: boolean; razon?: string; noEncontrado?: boolean }

export async function borrarTransformacion(id: string): Promise<BorrarTransformacionResult> {
  const { data: t } = await supabaseAdmin
    .from('transformaciones').select('id, estado').eq('id', id).maybeSingle();
  if (!t) return { ok: false, noEncontrado: true, razon: 'Transformación no encontrada.' };
  if (t.estado !== 'bruto') {
    return { ok: false, razon: 'Solo se puede cancelar una transformación que aún no se completó.' };
  }

  const { error } = await supabaseAdmin.from('transformaciones').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PCB
// ---------------------------------------------------------------------------

/** PCB: retira peso de un lote de origen. Crea la transformación en estado
 *  'bruto' y reparte el retiro proporcionalmente entre los materiales que
 *  realmente componen el lote (regla de tres, vía crear_transformacion_pcb),
 *  para que el stock del lote origen quede correctamente descontado. */
export async function crearTransformacionPCB(
  input: CrearTransformacionPCBInput,
  registradoPor: string
): Promise<{ transformacion: TransformacionPublica } | { error: string }> {
  const { data, error } = await supabaseAdmin.rpc('crear_transformacion_pcb', {
    p_lote_origen_id: input.loteOrigenId,
    p_peso_bruto: input.pesoBruto,
    p_tara: input.tara,
    p_fecha: input.fecha,
    p_notas: input.notas,
    p_fotos_entrada: input.fotosEntrada,
    p_registrado_por: registradoPor,
    p_almacen_id: input.almacenId,
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar la transformación.' };
  const transformacion = await obtenerTransformacion(data as string);
  if (!transformacion) return { error: 'La transformación se creó pero no se pudo leer.' };
  return { transformacion };
}

/** PCB: completa la transformación repartiendo la salida entre uno o varios
 *  lotes de destino (igual que ferroso/no ferroso permite varios materiales
 *  de salida). La composición de cada destino ya no se recalcula ni se
 *  guarda a mano: se deriva siempre en vivo a partir del stock real por
 *  producto (composicion_lote() en SQL) — ver lote-service.ts. */
export async function completarTransformacionPCB(
  id: string,
  input: CompletarTransformacionPCBInput,
  completadoPor: string
): Promise<{ transformacion: TransformacionPublica; advertencia?: string } | { error: string }> {
  const mermaInvalida = await prevalidarMerma(id, input.mermaDetalle, input.salidas);
  if (mermaInvalida) return { error: mermaInvalida };

  // Las salidas a lote no piden almacén: quedan en el de la transformación (o el predeterminado).
  const conAlmacen = completarAlmacenSalidas(input.salidas, await almacenPorDefectoSalidas(id), () => true);
  if (!conAlmacen.ok) return { error: conAlmacen.error };

  const { error } = await supabaseAdmin.rpc('completar_transformacion_pcb', {
    p_transformacion_id: id,
    p_salidas: conAlmacen.salidas.map(s => ({
      lote_destino_id: s.loteDestinoId,
      almacen_id: s.almacenId,
      peso_bruto: s.pesoBruto,
      tara: s.tara,
      fotos: s.fotos,
    })),
    p_completado_por: completadoPor,
  });

  if (error) return { error: error.message };
  const { advertencia } = await registrarMermaAlCompletar(id, input.mermaDetalle, completadoPor);
  const transformacion = await obtenerTransformacion(id);
  if (!transformacion) return { error: 'La transformación se completó pero no se pudo leer.' };
  return { transformacion, ...(advertencia ? { advertencia } : {}) };
}

// ---------------------------------------------------------------------------
// Salidas mixtas
// ---------------------------------------------------------------------------

export const MENSAJE_MIXTAS_NO_HABILITADAS = 'Las salidas mixtas aún no están habilitadas en la base de datos.';
/** Tolerancia (kg) de redondeo al comparar la suma de salidas con la entrada. */
export const TOLERANCIA_BALANCE_KG = 0.01;

export type ResultadoTransformacion =
  | { transformacion: TransformacionPublica; advertencia?: string }
  | { error: string; status?: number };

/** Suma de netos de las salidas (bruto - tara). */
export function sumarNetosSalidas(salidas: ReadonlyArray<{ pesoBruto: number; tara: number }>): number {
  return salidas.reduce((acc, s) => acc + (s.pesoBruto - s.tara), 0);
}

/** Mensaje de error si las salidas pesan más que la entrada; null si cuadra. */
export function validarBalancePesos(
  netoEntrada: number,
  salidas: ReadonlyArray<{ pesoBruto: number; tara: number }>
): string | null {
  const totalSalidas = sumarNetosSalidas(salidas);
  if (totalSalidas <= netoEntrada + TOLERANCIA_BALANCE_KG) return null;
  return (
    `Las salidas suman ${totalSalidas.toFixed(2)} kg y superan el peso neto de entrada ` +
    `(${netoEntrada.toFixed(2)} kg).`
  );
}

/** En PCB una salida a lote no puede volver al mismo lote de origen. */
export function validarLoteDestinoDistintoDeOrigen(
  loteOrigenId: string | null,
  salidas: readonly SalidaMixtaInput[]
): string | null {
  if (!loteOrigenId) return null;
  const vuelve = salidas.some(s => s.tipo === 'lote' && s.loteDestinoId === loteOrigenId);
  return vuelve ? 'El lote de destino no puede ser el mismo lote de origen.' : null;
}

interface TransformacionCabecera {
  categoria: string;
  estado: string;
  peso_neto: number;
  lote_origen_id: string | null;
}

/** Valida estado, categoría, reglas por tipo, balance y lote origen != destino. */
export function validarCompletarMixta(
  cab: TransformacionCabecera,
  salidas: readonly SalidaMixtaInput[]
): string | null {
  if (cab.estado !== 'bruto') return 'La transformación ya fue completada.';
  const porCategoria = validarSalidasMixtasPorCategoria(cab.categoria, salidas);
  if (porCategoria) return porCategoria;
  const balance = validarBalancePesos(Number(cab.peso_neto), salidas);
  if (balance) return balance;
  return cab.categoria === 'pcb' ? validarLoteDestinoDistintoDeOrigen(cab.lote_origen_id, salidas) : null;
}

function salidaMixtaARpc(s: SalidaMixtaInput) {
  return {
    tipo: s.tipo,
    producto_id: s.productoId ?? null,
    lote_destino_id: s.tipo === 'lote' ? s.loteDestinoId : null,
    almacen_id: s.almacenId ?? null,
    peso_bruto: s.pesoBruto,
    tara: s.tara,
    fotos: s.fotos,
  };
}

/** Completa una transformación con salidas mixtas (material suelto y/o lote
 *  destino) vía completar_transformacion_mixta. Si la función SQL todavía no
 *  existe responde 409 sin tocar nada. */
export async function completarTransformacionMixta(
  id: string,
  input: CompletarTransformacionMixtaInput,
  completadoPor: string
): Promise<ResultadoTransformacion> {
  const { data: cab } = await supabaseAdmin
    .from('transformaciones')
    .select('categoria, estado, peso_neto, lote_origen_id')
    .eq('id', id)
    .maybeSingle();
  if (!cab) return { error: 'Transformación no encontrada.', status: 404 };

  // Las salidas a lote no piden almacén: quedan en el de la transformación (o el predeterminado).
  // En PCB el material suelto también: sale al mismo almacén con el que se inició la transformación.
  const conAlmacen = completarAlmacenSalidas(
    input.salidas,
    await almacenPorDefectoSalidas(id),
    s => s.tipo === 'lote' || cab.categoria === 'pcb'
  );
  if (!conAlmacen.ok) return { error: conAlmacen.error, status: 400 };
  const salidas = conAlmacen.salidas;

  const invalido = validarCompletarMixta(cab as TransformacionCabecera, salidas);
  if (invalido) return { error: invalido, status: 400 };
  const mermaInvalida = await prevalidarMerma(id, input.mermaDetalle, salidas);
  if (mermaInvalida) return { error: mermaInvalida, status: 400 };

  const { error } = await supabaseAdmin.rpc('completar_transformacion_mixta', {
    p_transformacion_id: id,
    p_salidas: salidas.map(salidaMixtaARpc),
    p_completado_por: completadoPor,
  });
  if (error) {
    if (esErrorFuncionInexistente(error)) return { error: MENSAJE_MIXTAS_NO_HABILITADAS, status: 409 };
    return { error: error.message, status: 400 };
  }
  const { advertencia } = await registrarMermaAlCompletar(id, input.mermaDetalle, completadoPor);
  const transformacion = await obtenerTransformacion(id);
  if (!transformacion) return { error: 'La transformación se completó pero no se pudo leer.', status: 500 };
  return { transformacion, ...(advertencia ? { advertencia } : {}) };
}

// ---------------------------------------------------------------------------
// Salidas comunes (configuración)
// ---------------------------------------------------------------------------

export interface SalidaComunPublica {
  id: string;
  productoEntradaId: string;
  productoSalidaId: string;
  nombreProductoSalida: string;
  orden: number;
}

interface SalidaComunRow {
  id: string;
  producto_entrada_id: string;
  producto_salida_id: string;
  orden: number;
  productos?: { nombre: string } | null;
}

export async function obtenerSalidasComunes(
  productoEntradaId?: string
): Promise<SalidaComunPublica[]> {
  let query = supabaseAdmin
    .from('transformacion_salidas_comunes')
    .select('id, producto_entrada_id, producto_salida_id, orden, productos:producto_salida_id(nombre)')
    .order('orden');

  if (productoEntradaId) query = query.eq('producto_entrada_id', productoEntradaId);

  const { data } = await query;
  return ((data as unknown as SalidaComunRow[]) ?? []).map(r => ({
    id: r.id,
    productoEntradaId: r.producto_entrada_id,
    productoSalidaId: r.producto_salida_id,
    nombreProductoSalida: r.productos?.nombre ?? '—',
    orden: r.orden,
  }));
}

/** Reemplaza todas las salidas comunes de un producto de entrada. */
export async function guardarSalidasComunesProducto(
  productoEntradaId: string,
  productosSalidaIds: string[]
): Promise<{ ok: true } | { error: string }> {
  const { error: delErr } = await supabaseAdmin
    .from('transformacion_salidas_comunes')
    .delete()
    .eq('producto_entrada_id', productoEntradaId);

  if (delErr) return { error: delErr.message };

  if (productosSalidaIds.length === 0) return { ok: true };

  const rows = productosSalidaIds.map((id, idx) => ({
    producto_entrada_id: productoEntradaId,
    producto_salida_id: id,
    orden: idx,
  }));

  const { error: insErr } = await supabaseAdmin
    .from('transformacion_salidas_comunes')
    .insert(rows);

  if (insErr) return { error: insErr.message };
  return { ok: true };
}
