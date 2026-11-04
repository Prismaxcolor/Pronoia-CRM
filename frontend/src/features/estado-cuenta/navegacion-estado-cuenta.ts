import { vecinosEnSecuencia, type DestinoVecino, type VecinosDocumento } from '../../lib/navegacion-documentos';
import type { EntradaEstadoCuenta, TipoEntidad } from '../../services/estado-cuenta-service';
import { rutaDetalle } from './estado-cuenta-comun';

/** Filtros con los que se estaba viendo el estado de cuenta al abrir un documento (van en la ruta de vuelta). */
export interface FiltrosVuelta {
  desde?: string;
  hasta?: string;
  tipo?: string;
}

/** Id con el que se identifica el documento de una fila (el mismo que usan las rutas de detalle). */
export const idDocumentoEntrada = (e: EntradaEstadoCuenta): string | undefined => e.facturaId ?? e.notaId ?? e.pagoId;

/** Lee periodo y tipo del estado de cuenta del que viene la persona; sin ruta de vuelta de un estado de cuenta, todo el historial. */
export function filtrosDeVuelta(volverA: string | undefined): FiltrosVuelta {
  if (!volverA || !volverA.includes('/estado-cuenta')) return {};
  const [, consulta = ''] = volverA.split('?');
  const params = new URLSearchParams(consulta);
  return {
    desde: params.get('desde') || undefined,
    hasta: params.get('hasta') || undefined,
    tipo: params.get('tipo') || undefined,
  };
}

/**
 * Documentos vecinos de `idActual` en el estado de cuenta, en el orden en que llegan las entradas (el servidor las
 * entrega por orden de creación). Respeta el filtro por tipo de la pantalla de origen y omite filas sin detalle propio.
 */
export function vecinosEnEstadoCuenta(
  tipo: TipoEntidad,
  entidadId: string,
  entradas: readonly EntradaEstadoCuenta[],
  idActual: string,
  filtroTipo?: string,
  estado?: unknown,
): VecinosDocumento<DestinoVecino> {
  const secuencia: Array<DestinoVecino & { id: string | undefined }> = [];
  for (const e of entradas) {
    if (filtroTipo && e.tipo !== filtroTipo) continue;
    const to = rutaDetalle(tipo, entidadId, e);
    if (to) secuencia.push({ to, state: estado, id: idDocumentoEntrada(e) });
  }
  const v = vecinosEnSecuencia(secuencia, d => d.id === idActual);
  const aDestino = (d: (typeof secuencia)[number] | null): DestinoVecino | null => (d ? { to: d.to, state: d.state } : null);
  return { anterior: aDestino(v.anterior), siguiente: aDestino(v.siguiente), posicion: v.posicion, total: v.total };
}
