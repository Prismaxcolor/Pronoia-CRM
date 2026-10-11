import { supabaseAdmin } from '../config/supabase.js';
import { ErrorLecturaBd, IDS_POR_CONSULTA, leerPaginado, trocear } from '../utils/paginacion.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { MENSAJE_ERROR_GENERICO } from '../utils/errores-bd.js';
import { bancaPermitida, MENSAJE_SIN_ACCESO_BANCA, type BancasPermitidas } from '../utils/banca-acceso.js';
import { logger } from '../utils/logger.js';
import { resolverSeleccion } from '../utils/categoria-wallet.js';
import {
  construirReporteCategorias, construirReporteCuenta, type MovimientoReporte,
} from '../utils/reporte-wallet.js';
import { listarCategorias, MENSAJE_CATEGORIAS_PENDIENTE, type Categoria, type FalloCategoria } from './categoria-service.js';
import type { FiltroReporteCategorias, FiltroReporteCuenta } from '../schemas/categorias-wallet.js';

/** Los tipos del resultado son los de shared/types/categoria-wallet.ts (ReporteCuenta / ReporteCategorias). */
export type ReporteCuentaResultado = {
  banca: { id: string; nombre: string; moneda: string };
  desde: string;
  hasta: string;
} & ReturnType<typeof construirReporteCuenta>;
export type ReporteCategoriasResultado = ReturnType<typeof construirReporteCategorias>;

const MENSAJE_FALLO_LECTURA = MENSAJE_ERROR_GENERICO;

const COLUMNAS_REPORTE_CATEGORIAS = 'id, tipo, monto, moneda, fecha, banca_origen_id, categoria_id';

type Fila = Record<string, unknown>;
const aNumeroONull = (v: unknown): number | null => (v != null ? Number(v) : null);

function aMovimientoReporte(r: Fila): MovimientoReporte {
  return {
    id: r.id as string,
    tipo: r.tipo as MovimientoReporte['tipo'],
    subtipo: (r.subtipo as MovimientoReporte['subtipo']) ?? null,
    numero: aNumeroONull(r.numero),
    numeroSistema: aNumeroONull(r.numero_sistema),
    monto: Number(r.monto),
    moneda: r.moneda as string,
    montoDestino: aNumeroONull(r.monto_destino),
    fecha: r.fecha as string,
    descripcion: (r.descripcion as string) ?? '',
    referencia: (r.referencia as string) ?? '',
    bancaOrigenId: r.banca_origen_id as string,
    bancaDestinoId: (r.banca_destino_id as string) ?? null,
    categoriaId: (r.categoria_id as string) ?? null,
    anulado: Boolean(r.anulado),
    mesaCambistaId: (r.mesa_cambista_id as string) ?? null,
    mesaEstado: (r.mesa_estado as MovimientoReporte['mesaEstado']) ?? null,
  };
}

/** Fallo de una lectura: 500 genérico (sin filtrar el mensaje de la BD) y registro del detalle. */
function falloDeLectura(e: unknown, contexto: string): FalloCategoria {
  const error = e instanceof ErrorLecturaBd ? e : null;
  logger.error({ evento: 'reporte_wallet_error', contexto, codigoBd: error?.code, mensaje: e instanceof Error ? e.message : String(e) });
  return { error: MENSAJE_FALLO_LECTURA, codigo: 500 };
}

async function nombresDeBancas(ids: readonly string[]): Promise<Map<string, string>> {
  const nombres = new Map<string, string>();
  for (const trozo of trocear([...new Set(ids)], IDS_POR_CONSULTA)) {
    const { data } = await supabaseAdmin.from('bancas').select('id, nombre').in('id', trozo);
    for (const b of (data as Array<{ id: string; nombre: string }> | null) ?? []) nombres.set(b.id, b.nombre);
  }
  return nombres;
}

/** Categorías para etiquetar; si la migración de categorías falta el reporte sale igual, sin ellas. */
async function categoriasOpcionales(): Promise<Categoria[]> {
  const r = await listarCategorias();
  return 'error' in r ? [] : r.categorias;
}

async function leerMovimientosDeCuenta(f: FiltroReporteCuenta): Promise<MovimientoReporte[]> {
  const filas = await leerPaginado<Fila>((desde, hasta) =>
    supabaseAdmin
      .from('movimientos')
      .select('*')
      .or(`banca_origen_id.eq.${f.bancaId},banca_destino_id.eq.${f.bancaId}`)
      .gte('fecha', f.desde)
      .lte('fecha', f.hasta)
      .order('fecha')
      .order('creado_en')
      .order('id')
      .range(desde, hasta));
  return filas.map(aMovimientoReporte);
}

export async function obtenerReporteCuenta(
  f: FiltroReporteCuenta,
  permitidas: BancasPermitidas
): Promise<{ reporte: ReporteCuentaResultado } | FalloCategoria> {
  const { data: banca } = await supabaseAdmin.from('bancas').select('id, nombre, moneda').eq('id', f.bancaId).maybeSingle();
  if (!banca) return { error: 'Cuenta no encontrada.', codigo: 404 };
  if (!bancaPermitida(permitidas, f.bancaId)) return { error: MENSAJE_SIN_ACCESO_BANCA, codigo: 403 };
  try {
    const movimientos = await leerMovimientosDeCuenta(f);
    const otras = movimientos.flatMap(m => [m.bancaOrigenId, m.bancaDestinoId]).filter((x): x is string => !!x);
    const [categorias, nombresBancas] = await Promise.all([categoriasOpcionales(), nombresDeBancas(otras)]);
    const calculo = construirReporteCuenta({ bancaId: f.bancaId, movimientos, categorias, nombresBancas, permitidas });
    const b = banca as { id: string; nombre: string; moneda: string };
    return { reporte: { banca: { id: b.id, nombre: b.nombre, moneda: b.moneda }, desde: f.desde, hasta: f.hasta, ...calculo } };
  } catch (e) {
    return falloDeLectura(e, 'cuenta');
  }
}

async function leerMovimientosParaCategorias(f: FiltroReporteCategorias, seleccion: ReadonlySet<string> | null): Promise<MovimientoReporte[]> {
  const ids = seleccion ? [...seleccion] : null;
  // Con una selección acotada y sin "sin categoría" se pide a la BD solo lo necesario.
  const acotar = ids !== null && !f.sinCategoria && ids.length <= IDS_POR_CONSULTA;
  const filas = await leerPaginado<Fila>((desde, hasta) => {
    let q = supabaseAdmin
      .from('movimientos')
      .select(COLUMNAS_REPORTE_CATEGORIAS)
      .in('tipo', ['ingreso', 'egreso'])
      .eq('anulado', false)
      .gte('fecha', f.desde)
      .lte('fecha', f.hasta);
    if (acotar) q = q.in('categoria_id', ids);
    else if (!f.sinCategoria) q = q.not('categoria_id', 'is', null);
    return q.order('fecha').order('id').range(desde, hasta);
  });
  return filas.map(aMovimientoReporte);
}

export async function obtenerReporteCategorias(
  f: FiltroReporteCategorias,
  permitidas: BancasPermitidas
): Promise<{ reporte: ReporteCategoriasResultado } | FalloCategoria> {
  const lista = await listarCategorias();
  if ('error' in lista) return lista;
  const seleccion = resolverSeleccion(f.categorias, lista.categorias);
  if (seleccion !== null && seleccion.size === 0) return { error: 'Las categorías elegidas no existen.', codigo: 400 };
  try {
    const movimientos = await leerMovimientosParaCategorias(f, seleccion);
    const reporte = construirReporteCategorias({
      movimientos, categorias: lista.categorias, seleccion, incluirSinCategoria: f.sinCategoria, permitidas, desde: f.desde, hasta: f.hasta,
    });
    return { reporte };
  } catch (e) {
    if (e instanceof ErrorLecturaBd && esObjetoInexistente(e)) return { error: MENSAJE_CATEGORIAS_PENDIENTE, codigo: 503 };
    return falloDeLectura(e, 'categorias');
  }
}
