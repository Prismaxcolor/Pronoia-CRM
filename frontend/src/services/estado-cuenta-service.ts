import { apiFetch, ApiError } from './api-client';

export type TipoEntidad = 'proveedor' | 'cliente';

export interface EntradaEstadoCuenta {
  /** Instante (timestamptz ISO) de registro, para mostrar la hora junto a `fecha`. */
  instante?: string | null;
  fecha: string;
  tipo: 'factura' | 'pago' | 'adelanto' | 'nota_credito' | 'nota_debito' | 'cruce';
  descripcion: string;
  /** Correlativo formateado (C-0001, PG-0007, AD-0003, NC-0004...). */
  referencia: string | null;
  /** Texto libre que el usuario tipeó a mano, aparte del correlativo. */
  referenciaExterna?: string | null;
  cargo: number;
  abono: number;
  /** Solo notas: id para poder anularla. Ausente para facturas/pagos. */
  notaId?: string;
  /** Solo notas: fue anulada (queda en historial; cargo/abono = 0, no afecta el saldo). */
  anulada?: boolean;
  /** Solo notas anuladas: monto original, para mostrarlo tachado. */
  montoAnulado?: number;
  /** Solo notas de débito: ya se liquidó en un pago combinado ("Registrar pago"). */
  pagada?: boolean;
  /** Solo facturas: id para abrir el detalle. Ausente para pagos/notas. */
  facturaId?: string;
  /** Solo pagos/adelantos: id para abrir el comprobante imprimible. Ausente para facturas/notas. */
  pagoId?: string;
  /** Solo cruces: total de facturas saldadas con adelantos/notas, sin mover dinero. */
  montoCruzado?: number;
  /** Solo adelantos: cuánto ya se aplicó a facturas (cruces). */
  adelantoAplicado?: number;
  /** Solo adelantos: lo que sigue disponible para cruzar. */
  adelantoDisponible?: number;
  /** Solo notas: id de la factura de compra a la que está asociada, ya resuelto. */
  facturaAsociadaId?: string | null;
  /** Solo notas: código de esa factura (C-0007). */
  facturaAsociadaCodigo?: string | null;
}

export interface EstadoCuenta {
  entidad: { id: string; tipo: TipoEntidad; nombre: string };
  entradas: EntradaEstadoCuenta[];
  totales: { facturado: number; pagado: number; saldo: number };
}

/** Manda el estado de cuenta (PDF, versión externa) al Telegram de la entidad. Devuelve el mensaje de error si no se pudo. */
export async function enviarEstadoCuentaTelegram(tipo: TipoEntidad, id: string): Promise<{ ok: true } | { error: string }> {
  const base = tipo === 'proveedor' ? '/api/proveedores' : '/api/clientes';
  try {
    await apiFetch<{ ok: true }>(`${base}/${id}/estado-cuenta/enviar-telegram`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'No se pudo enviar el estado de cuenta.' };
  }
}

/**
 * Estado de cuenta de un proveedor o cliente. La única diferencia entre ambos
 * es el endpoint base; la pantalla es la misma.
 */
export async function obtenerEstadoCuenta(
  tipo: TipoEntidad,
  id: string,
  desde?: string,
  hasta?: string
): Promise<EstadoCuenta | null> {
  const base = tipo === 'proveedor' ? '/api/proveedores' : '/api/clientes';
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const qs = params.toString();
  try {
    return await apiFetch<EstadoCuenta>(`${base}/${id}/estado-cuenta${qs ? `?${qs}` : ''}`);
  } catch {
    return null;
  }
}
