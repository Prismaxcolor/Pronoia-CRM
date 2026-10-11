import { supabaseAdmin } from '../config/supabase.js';
import type { ExportacionResumen, KgLoteExportacion, ListadoExportaciones } from '../../../shared/types/packing-list.js';
import { calcularNeto, redondear2, totalNeto } from '../utils/packing-list-calculo.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { logger } from '../utils/logger.js';
import { proyeccionToPublica } from './packing-list-service.js';

export const MENSAJE_EXPORTACIONES_NO_LEIDAS = 'No se pudieron leer las exportaciones. Intenta de nuevo.';

const LIMITE_EXPORTACIONES = 200;
const COLUMNAS_BASE = 'id, contenedor, fecha, cliente_id';
const ITEMS = 'packing_list_items(lote, peso_bruto, peso_paleta)';

interface ItemExportacionRow {
  lote: string | null;
  peso_bruto: number | string;
  peso_paleta: number | string;
}

interface FilaExportacion {
  id: string;
  contenedor: string;
  fecha: string;
  cliente_id: string;
  packing_list_items: ItemExportacionRow[] | null;
  proyeccion?: Parameters<typeof proyeccionToPublica>[0];
  total_real_usd?: number | string | null;
}

export interface OpcionesListadoExportaciones {
  /** facturacion:ver. Sin él la valoración ni se lee de la BD ni se devuelve. */
  puedeVerValores: boolean;
}

const pesos = (i: ItemExportacionRow) => ({ pesoBruto: Number(i.peso_bruto), pesoPaleta: Number(i.peso_paleta) });

/** Kg netos por lote, en orden de aparición. Los ítems sin lote se agrupan bajo la clave ''. */
export function kgPorLoteDeItems(items: readonly ItemExportacionRow[]): KgLoteExportacion[] {
  const acumulado = items.reduce((mapa, i) => {
    const clave = i.lote?.trim() ?? '';
    const { pesoBruto, pesoPaleta } = pesos(i);
    return new Map(mapa).set(clave, redondear2((mapa.get(clave) ?? 0) + calcularNeto(pesoBruto, pesoPaleta)));
  }, new Map<string, number>());
  return [...acumulado].map(([lote, kg]) => ({ lote, kg }));
}

/** Consulta con la valoración y, si la columna aún no existe, sin ella. */
async function leerFilas(conValores: boolean) {
  const consulta = (columnas: string) =>
    supabaseAdmin
      .from('packing_lists')
      .select(`${columnas}, ${ITEMS}`)
      .not('cliente_id', 'is', null)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMITE_EXPORTACIONES);
  if (!conValores) return consulta(COLUMNAS_BASE);
  const conTotal = await consulta(`${COLUMNAS_BASE}, proyeccion, total_real_usd`);
  if (!conTotal.error || !esObjetoInexistente(conTotal.error)) return conTotal;
  const conProyeccion = await consulta(`${COLUMNAS_BASE}, proyeccion`);
  if (!conProyeccion.error || !esObjetoInexistente(conProyeccion.error)) return conProyeccion;
  return consulta(COLUMNAS_BASE);
}

async function nombresDeClientes(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('clientes').select('id, nombre').in('id', [...ids]);
  return new Map(((data ?? []) as Array<{ id: string; nombre: string }>).map(c => [c.id, c.nombre] as const));
}

function aExportacion(f: FilaExportacion, nombres: ReadonlyMap<string, string>, conValores: boolean): ExportacionResumen {
  const items = f.packing_list_items ?? [];
  const base = {
    packingListId: f.id,
    contenedor: f.contenedor,
    fecha: f.fecha,
    clienteId: f.cliente_id,
    clienteNombre: nombres.get(f.cliente_id) ?? null,
    totalNeto: totalNeto(items.map(pesos)),
    kgPorLote: kgPorLoteDeItems(items),
  };
  if (!conValores) return base;
  const total = f.total_real_usd == null ? null : Number(f.total_real_usd);
  return { ...base, proyeccion: proyeccionToPublica(f.proyeccion), totalRealUsd: total };
}

/**
 * Exportaciones = packing lists con cliente internacional vinculado. Si falta la migración del cliente
 * responde vacío con `migracionPendiente` en vez de fallar.
 */
export async function listarExportaciones(opciones: OpcionesListadoExportaciones): Promise<ListadoExportaciones> {
  const { data, error } = await leerFilas(opciones.puedeVerValores);
  if (error) {
    if (esObjetoInexistente(error)) return { exportaciones: [], migracionPendiente: true };
    logger.error({ evento: 'exportaciones_no_leidas', motivo: error.message });
    throw new Error(MENSAJE_EXPORTACIONES_NO_LEIDAS);
  }
  const filas = (data ?? []) as unknown as FilaExportacion[];
  const nombres = await nombresDeClientes([...new Set(filas.map(f => f.cliente_id))]);
  return { exportaciones: filas.map(f => aExportacion(f, nombres, opciones.puedeVerValores)) };
}
