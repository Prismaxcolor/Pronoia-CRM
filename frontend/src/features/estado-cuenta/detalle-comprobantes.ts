import type { BancaPagoDetalle } from '../../services/pago-detalle-service';

/**
 * ¿Mostrar los comprobantes debajo de cada banca? Solo cuando dos o más cuentas traen los suyos (pago repartido con
 * un comprobante por banca). Con una sola cuenta con fotos (o ninguna) se muestra el bloque único de siempre.
 */
export function comprobantesPorBanca(bancas: readonly Pick<BancaPagoDetalle, 'comprobantes'>[]): boolean {
  return bancas.filter(b => (b.comprobantes?.length ?? 0) > 0).length > 1;
}
