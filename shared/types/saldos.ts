/**
 * Saldos de todas las entidades en una sola llamada (pantallas de Proveedores y Clientes).
 *
 *   GET /api/proveedores/saldos -> RespuestaSaldos  (por pagar)
 *   GET /api/clientes/saldos    -> RespuestaSaldos  (por cobrar)
 *
 * Permiso: proveedores:ver / clientes:ver, el mismo que exige hoy GET /:id/estado-cuenta de esa entidad.
 *
 * REGLAS QUE EL FRONTEND DEBE RESPETAR
 *  - `saldo` es la MISMA cifra que `totales.saldo` del estado de cuenta de la entidad (se calcula con la
 *    misma función): facturas no anuladas + notas de débito vigentes - pagos/cobros - adelantos - notas de
 *    crédito vigentes. Positivo = se le debe pagar (proveedor) o nos debe (cliente); negativo = saldo a favor.
 *  - `facturado` incluye las notas de débito vigentes; `pagado` incluye adelantos y notas de crédito vigentes
 *    (igual que `totales` del estado de cuenta).
 *  - Los importes van en USD. Una entidad sin movimientos aparece con todo en 0 y `ultimaOperacion` null.
 *  - Es una foto con caché de ~20 s: `calculadoEn` dice cuándo se calculó.
 *  - Si no se puede calcular completo (error o más de ~8 s) responde 503 con `{ error }`: no hay cifras parciales.
 */
export interface SaldoEntidad {
  entidadId: string;
  nombre: string;
  activo: boolean;
  facturado: number;
  pagado: number;
  saldo: number;
  /** Adelantos/anticipos con saldo sin aplicar a facturas. */
  adelantoDisponible: number;
  /** Suma de notas de crédito vigentes (no anuladas) que aún no se aplicaron a una factura. */
  notasCreditoDisponibles: number;
  /** Fecha (YYYY-MM-DD) del último movimiento, factura o nota vigente; null si no tiene ninguno. */
  ultimaOperacion: string | null;
  /** Facturas emitidas con monto pendiente (> 0). */
  cantidadFacturasPendientes: number;
  /** Días desde la factura pendiente más antigua; null si no hay facturas pendientes. */
  antiguedadMasVieja: number | null;
}

export interface TotalesSaldos {
  facturado: number;
  pagado: number;
  /** Suma neta de todos los saldos (los saldos a favor restan). */
  saldo: number;
  /** Solo en proveedores: suma de los saldos positivos (lo que se debe). */
  porPagar?: number;
  /** Solo en clientes: suma de los saldos positivos (lo que deben). */
  porCobrar?: number;
  /** Suma (en positivo) de los saldos negativos: lo que ya se pagó/cobró de más. */
  aFavor: number;
}

export interface RespuestaSaldos {
  tipo: 'proveedor' | 'cliente';
  saldos: SaldoEntidad[];
  totales: TotalesSaldos;
  /** ISO 8601 del momento del cálculo. */
  calculadoEn: string;
}
