import type { TicketPesaje, Traslado } from '@shared/types/index.js';
import type { FilaLista } from '../../lib/pesaje-lista';
import { esTicketUnido, estaFueraDeTolerancia, estadoDiferencia, kgPesadosTicket, type EstadoDiferencia } from '../../lib/pesaje-kpis';
import { ORDEN_POR_DEFECTO, ordenarListado } from '../../lib/orden-listado';
import { contarMaterialesDistintos, resumenMateriales } from './resumen-materiales';
import { diaNegocio } from '../../lib/fecha-negocio';

/** Registro original detrás de una fila de la lista: un ticket de compra/venta o un traslado entre almacenes. */
export type OrigenFila =
  | { kind: 'pesaje'; ticket: TicketPesaje }
  | { kind: 'traslado'; traslado: Traslado };

export interface FilaTicket extends FilaLista<OrigenFila> {
  /** Entidad (proveedor/cliente) o "Origen → Destino" en traslados; '—' si se desconoce. */
  entidad: string;
  materiales: string;
  /** Peso que muestra la lista: global si está en bruto, neto si está completo. */
  pesoKg: number;
  /** Diferencia de peso en kg; null cuando no aplica (bruto, báscula externa, unido, traslado). */
  difKg: number | null;
  estadoDif: EstadoDiferencia;
  vehiculo: string;
  /** Observaciones del ticket o traslado (texto completo); '' si no hay. */
  observaciones: string;
  /** Código del ticket principal si este ticket está unido a otro. */
  unidoA: string | null;
}

function resumenTraslado(t: Traslado): string {
  const distintos = contarMaterialesDistintos(t.materiales);
  return distintos > 1 ? `${distintos} ítems` : resumenMateriales(t.materiales);
}

export function filaDeTicket(t: TicketPesaje, nombrePorEntidad: ReadonlyMap<string, string>): FilaTicket {
  const estadoDif = estadoDiferencia(t);
  return {
    clave: `t-${t.id}`,
    tipo: t.tipo,
    codigo: t.codigo,
    fecha: t.fecha,
    instante: t.createdAt,
    entidadId: t.entidadId,
    porRecepcionar: t.estado === 'bruto',
    facturado: t.estado === 'bruto' || esTicketUnido(t) ? null : t.facturado,
    difFuera: estaFueraDeTolerancia(t),
    origen: { kind: 'pesaje', ticket: t },
    entidad: t.entidadId ? (nombrePorEntidad.get(t.entidadId) ?? '—') : '—',
    materiales: resumenMateriales(t.materiales),
    pesoKg: kgPesadosTicket(t),
    difKg: estadoDif === 'no_aplica' ? null : t.diferencia,
    estadoDif,
    vehiculo: t.vehiculo?.trim() || '—',
    observaciones: t.observaciones?.trim() ?? '',
    unidoA: t.ticketPrincipalId ? (t.ticketPrincipalCodigo ?? 'otro ticket') : null,
  };
}

export function filaDeTraslado(t: Traslado): FilaTicket {
  const pendiente = t.estado === 'pendiente';
  return {
    clave: `tr-${t.id}`,
    tipo: 'traslado',
    codigo: t.codigo,
    fecha: diaNegocio(t.createdAt) ?? t.createdAt.slice(0, 10),
    instante: t.createdAt,
    entidadId: null,
    porRecepcionar: pendiente,
    facturado: null,
    difFuera: false,
    origen: { kind: 'traslado', traslado: t },
    entidad: `${t.nombreAlmacenOrigen ?? '—'} → ${t.nombreAlmacenDestino ?? '—'}`,
    materiales: resumenTraslado(t),
    pesoKg: pendiente ? t.pesoNetoEnviado : (t.pesoNetoRecibido ?? t.pesoNetoEnviado),
    difKg: null,
    estadoDif: 'no_aplica',
    vehiculo: t.vehiculo?.trim() || '—',
    observaciones: t.observaciones?.trim() ?? '',
    unidoA: null,
  };
}

const leerOrdenable = (f: FilaTicket) => (f.origen.kind === 'pesaje' ? f.origen.ticket : f.origen.traslado);

/** Orden por defecto de siempre: últimos culminados primero (los que aún no se completan, por fecha de creación). */
export function ordenarPorDefecto(filas: readonly FilaTicket[]): FilaTicket[] {
  return ordenarListado([...filas], ORDEN_POR_DEFECTO, leerOrdenable);
}

/** Todas las filas (tickets + traslados) ya en el orden por defecto. */
export function construirFilas(tickets: readonly TicketPesaje[], traslados: readonly Traslado[], nombrePorEntidad: ReadonlyMap<string, string>): FilaTicket[] {
  return ordenarPorDefecto([
    ...tickets.map(t => filaDeTicket(t, nombrePorEntidad)),
    ...traslados.map(filaDeTraslado),
  ]);
}
