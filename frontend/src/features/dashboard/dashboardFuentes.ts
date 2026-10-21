import { leerGet } from '../../services/lectura-service';
import { obtenerMetricasCompras, type MetricaCompraLinea } from '../../services/metricas-service';
import { listarCitas, type Cita } from '../../services/citas-service';
import { listarSaldosProveedores } from '../../services/saldos-service';
import { obtenerResumenInventario } from '../../services/inventario-resumen-service';
import { rangosSemanales, type BancaMinima, type RangosSemanales, type ResumenTickets, resumirTickets } from '../../lib/dashboard-kpis';
import type { RespuestaSaldos } from '@shared/types/saldos.js';
import type { TicketPesaje, TomaFisicaInventario } from '@shared/types/index.js';

/** Fuentes de datos del Dashboard: SOLO endpoints existentes y de lectura. A diferencia de los servicios que tragan
 *  el error y devuelven [], estas funciones lo propagan, para que cada bloque pueda decir "no se pudo cargar"
 *  en vez de mostrar un 0 falso. */

export interface SemanasKg {
  rangos: RangosSemanales;
  actual: MetricaCompraLinea[];
  anterior: MetricaCompraLinea[];
}

export async function cargarSemanasKg(hoyIso: string): Promise<SemanasKg> {
  const rangos = rangosSemanales(hoyIso);
  const [actual, anterior] = await Promise.all([
    obtenerMetricasCompras(rangos.actual.desde, rangos.actual.hasta),
    obtenerMetricasCompras(rangos.anterior.desde, rangos.anterior.hasta),
  ]);
  return { rangos, actual, anterior };
}

const pedirTickets = (consulta: string) =>
  leerGet<{ tickets: TicketPesaje[] }>(`/api/tickets-pesaje?${consulta}`).then(r => r.tickets);

export async function cargarTickets(ahoraMs: number): Promise<ResumenTickets> {
  const [bruto, noFacturados] = await Promise.all([
    pedirTickets('tipo=compra&estado=bruto'),
    pedirTickets('tipo=compra&estado=completo&soloNoFacturados=true'),
  ]);
  return resumirTickets(bruto, noFacturados, ahoraMs);
}

export const cargarSaldosProveedores = (): Promise<RespuestaSaldos> => listarSaldosProveedores();

export const cargarBancas = (): Promise<BancaMinima[]> =>
  leerGet<{ bancas: BancaMinima[] }>('/api/cochinito/bancas').then(r => r.bancas);

export async function cargarTomasAbiertas(): Promise<Array<{ id: string; codigo: string; almacenNombre: string | null }>> {
  const { tomasFisicas } = await leerGet<{ tomasFisicas: TomaFisicaInventario[] }>('/api/tomas-fisicas');
  return tomasFisicas.filter(t => t.estado === 'abierta').map(t => ({ id: t.id, codigo: t.codigo, almacenNombre: t.almacenNombre }));
}

export interface MermaDashboard { sobreUmbral: boolean; pct: number; umbralPct: number; transformacionesAltas: number }

export async function cargarMerma(): Promise<MermaDashboard> {
  const r = await obtenerResumenInventario();
  if ('error' in r) throw new Error(r.error);
  const m = r.resumen.merma;
  return { sobreUmbral: m.sobreUmbral, pct: m.actual.pctMerma, umbralPct: m.umbralPct, transformacionesAltas: m.transformacionesAltas.length };
}

const MAX_DESPACHOS = 5;

/** Próximas citas de despacho desde hoy (sin canceladas ni completadas), de la más cercana a la más lejana. */
export async function cargarProximosDespachos(hoy: string): Promise<Cita[]> {
  const citas = await listarCitas(hoy);
  return citas
    .filter(c => c.estado !== 'cancelada' && c.estado !== 'completada')
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`))
    .slice(0, MAX_DESPACHOS);
}
