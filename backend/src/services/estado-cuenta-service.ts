import { supabaseAdmin } from '../config/supabase.js';
import {
  formatCodigoPagoProveedor,
  formatCodigoAdelanto,
  formatCodigoNotaCredito,
  formatCodigoNotaDebito,
  formatCodigoCobroCliente,
  formatCodigoAnticipoCliente,
  formatCodigoNotaCreditoCliente,
  formatCodigoNotaDebitoCliente,
} from '../utils/codigos.js';

export type TipoEntidad = 'proveedor' | 'cliente';

/** Duplicado intencional de factura-service.ts (mismo patrón que formatCodigoPesaje). */
function formatCodigo(tipoEntidad: TipoEntidad, numero: number): string {
  return tipoEntidad === 'proveedor'
    ? `C-${String(numero).padStart(4, '0')}`
    : `V-${String(numero).padStart(4, '0')}`;
}

export interface EntradaEstadoCuenta {
  /** Fecha ISO (YYYY-MM-DD). */
  fecha: string;
  tipo: 'factura' | 'pago' | 'adelanto' | 'nota_credito' | 'nota_debito';
  descripcion: string;
  /** Correlativo formateado (C-0001, PG-0007, AD-0003, NC-0004...). */
  referencia: string | null;
  /** Texto libre que el usuario tipeó a mano (ej. "TRF-432"), aparte del correlativo. */
  referenciaExterna?: string | null;
  /** Aumenta el saldo (facturas, notas de débito). */
  cargo: number;
  /** Reduce el saldo (pagos/cobros, notas de crédito). */
  abono: number;
  /** Solo notas: id para poder anularla. Ausente para facturas/pagos. */
  notaId?: string;
  /** Solo facturas: id para abrir el detalle. Ausente para pagos/notas. */
  facturaId?: string;
  /** Solo notas: ya fue reversada con una nota contraria. */
  anulada?: boolean;
  /** Solo notas de débito: ya se liquidó en un pago combinado ("Registrar pago"). */
  pagada?: boolean;
  /** Solo notas: id de la factura de compra a la que está asociada (ajuste ligado a
   *  una factura puntual). Null si es un ajuste general sin factura de por medio. */
  facturaAsociadaId?: string | null;
  /** Solo notas: código de esa factura (C-0007), ya resuelto. */
  facturaAsociadaCodigo?: string | null;
}

export interface EstadoCuenta {
  entidad: { id: string; tipo: TipoEntidad; nombre: string };
  entradas: EntradaEstadoCuenta[];
  totales: { facturado: number; pagado: number; saldo: number };
}

function soloFecha(valor: string): string {
  return valor.slice(0, 10);
}

// ---- núcleo puro (testeable sin BD) ----------------------------------------

export interface FacturaCruda { id: string; total: number; descripcion: string | null; fecha: string; codigo?: string | null }
export interface PagoCrudo {
  id: string;
  monto: number;
  descripcion: string | null;
  /** Texto libre que el usuario tipeó (ej. "TRF-432"), no el correlativo. */
  referencia: string | null;
  fecha: string;
  subtipo?: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
  numero?: number | null;
  grupoId?: string | null;
}
export interface NotaCruda {
  id: string; tipo: 'credito' | 'debito'; monto: number; motivo: string; anulada: boolean; pagada: boolean; fecha: string; numero?: number | null;
  /** Ya resueltos por obtenerEstadoCuenta (segunda query a facturas_compra + Map), no se
   *  vuelven a resolver acá — mismo patrón que FacturaCruda.codigo. */
  facturaAsociadaId?: string | null;
  facturaAsociadaCodigo?: string | null;
}

/** Formatea el correlativo de un movimiento de pago/cobro según entidad y
 *  subtipo: proveedor → PG-/AD-, cliente → CB-/AC- (numeración propia). */
function formatCodigoPago(
  tipoEntidad: TipoEntidad,
  subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null | undefined,
  numero: number | null | undefined
): string | null {
  if (numero == null) return null;
  if (tipoEntidad === 'proveedor') {
    return subtipo === 'adelanto' ? formatCodigoAdelanto(numero) : formatCodigoPagoProveedor(numero);
  }
  return subtipo === 'anticipo' ? formatCodigoAnticipoCliente(numero) : formatCodigoCobroCliente(numero);
}

/** Formatea el correlativo de una nota según entidad: proveedor → NC-/ND-,
 *  cliente → NCV-/NDV- (numeración propia). */
function formatCodigoNota(tipoEntidad: TipoEntidad, tipo: 'credito' | 'debito', numero: number): string {
  if (tipoEntidad === 'proveedor') {
    return tipo === 'credito' ? formatCodigoNotaCredito(numero) : formatCodigoNotaDebito(numero);
  }
  return tipo === 'credito' ? formatCodigoNotaCreditoCliente(numero) : formatCodigoNotaDebitoCliente(numero);
}

/**
 * Colapsa filas de `movimientos` que pertenecen a una misma operación (un
 * pago repartido entre varias bancas, y/o con una porción de adelanto,
 * genera varias filas — Bloque 39) en una sola entrada por documento,
 * sumando el monto. Filas legacy sin `grupoId` (de antes del Bloque 38/39)
 * se tratan cada una como su propio grupo, así no se pierden ni se mezclan
 * pagos históricos que nunca compartieron operación.
 */
export function agruparPagos(rows: PagoCrudo[]): PagoCrudo[] {
  const grupos = new Map<string, PagoCrudo>();

  for (const r of rows) {
    const clave = `${r.grupoId ?? r.id}#${r.subtipo ?? ''}`;
    const existente = grupos.get(clave);
    if (existente) {
      existente.monto = Number(existente.monto) + Number(r.monto);
    } else {
      grupos.set(clave, { ...r, monto: Number(r.monto) });
    }
  }

  return [...grupos.values()];
}

/**
 * Arma el estado de cuenta a partir de facturas (cargos), pagos (abonos) y
 * notas de crédito/débito (ajuste manual) ya cargados. Función pura: ordena,
 * suma totales y calcula el saldo. `pagos` debe venir ya agrupado por
 * operación (ver agruparPagos) — acá 1 elemento = 1 línea del estado de cuenta.
 */
export function construirEstadoCuenta(
  entidad: { id: string; tipo: TipoEntidad; nombre: string },
  facturas: FacturaCruda[],
  pagos: PagoCrudo[],
  notas: NotaCruda[] = []
): EstadoCuenta {
  const entradas: EntradaEstadoCuenta[] = [];

  for (const f of facturas) {
    entradas.push({
      fecha: soloFecha(f.fecha),
      tipo: 'factura',
      descripcion: f.descripcion ?? 'Factura',
      referencia: f.codigo ?? f.id.slice(0, 8),
      cargo: Number(f.total),
      abono: 0,
      facturaId: f.id,
    });
  }
  for (const p of pagos) {
    const codigo = formatCodigoPago(entidad.tipo, p.subtipo, p.numero);
    const esAnticipo = p.subtipo === 'adelanto' || p.subtipo === 'anticipo';
    entradas.push({
      fecha: soloFecha(p.fecha),
      tipo: esAnticipo ? 'adelanto' : 'pago',
      descripcion: p.descripcion ?? (esAnticipo ? 'Adelanto' : 'Pago'),
      referencia: codigo ?? p.referencia,
      referenciaExterna: codigo ? p.referencia : null,
      cargo: 0,
      abono: Number(p.monto),
    });
  }
  // Nota de crédito: descuento a favor de la empresa (proveedor) o del
  // cliente, resta del saldo (abono). Nota de débito: monto a favor de la
  // entidad, suma al saldo (cargo). Una nota anulada sigue sumando/restando
  // junto con su contraria: el efecto neto se cancela solo, sin borrar
  // ninguna de las dos (auditoría).
  for (const n of notas) {
    entradas.push({
      fecha: soloFecha(n.fecha),
      tipo: n.tipo === 'credito' ? 'nota_credito' : 'nota_debito',
      descripcion: n.motivo,
      referencia: n.numero != null ? formatCodigoNota(entidad.tipo, n.tipo, n.numero) : null,
      cargo: n.tipo === 'debito' ? Number(n.monto) : 0,
      abono: n.tipo === 'credito' ? Number(n.monto) : 0,
      notaId: n.id,
      anulada: n.anulada,
      pagada: n.pagada,
      facturaAsociadaId: n.facturaAsociadaId ?? null,
      facturaAsociadaCodigo: n.facturaAsociadaCodigo ?? null,
    });
  }

  entradas.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const facturado = entradas.reduce((s, e) => s + e.cargo, 0);
  const pagado = entradas.reduce((s, e) => s + e.abono, 0);

  return { entidad, entradas, totales: { facturado, pagado, saldo: facturado - pagado } };
}

// ---- acceso a datos --------------------------------------------------------

/**
 * Estado de cuenta de un proveedor o cliente: facturas (cargos) + movimientos de
 * tesorería atribuidos a la entidad (abonos). Devuelve null si no existe.
 */
export async function obtenerEstadoCuenta(
  tipoEntidad: TipoEntidad,
  id: string,
  desde?: string,
  hasta?: string
): Promise<EstadoCuenta | null> {
  const esProveedor = tipoEntidad === 'proveedor';
  const tablaEntidad = esProveedor ? 'proveedores' : 'clientes';
  const tablaFacturas = esProveedor ? 'facturas_compra' : 'facturas_venta';
  const columnaEntidad = esProveedor ? 'proveedor_id' : 'cliente_id';
  const tipoMovAbono = esProveedor ? 'egreso' : 'ingreso';

  const { data: entidad, error: errEnt } = await supabaseAdmin
    .from(tablaEntidad)
    .select('id, nombre')
    .eq('id', id)
    .maybeSingle();
  if (errEnt || !entidad) return null;

  let qFacturas = supabaseAdmin.from(tablaFacturas).select('id, numero, total, descripcion, created_at').eq(columnaEntidad, id);
  if (desde) qFacturas = qFacturas.gte('created_at', desde);
  if (hasta) qFacturas = qFacturas.lte('created_at', `${hasta}T23:59:59`);
  const { data: facturasData } = await qFacturas;
  const facturas: FacturaCruda[] = ((facturasData as Array<{ id: string; numero: number | null; total: number; descripcion: string | null; created_at: string }> | null) ?? [])
    .map(f => ({
      id: f.id,
      total: f.total,
      descripcion: f.descripcion,
      fecha: f.created_at,
      codigo: f.numero != null ? formatCodigo(tipoEntidad, f.numero) : null,
    }));

  let qPagos = supabaseAdmin
    .from('movimientos')
    .select('id, monto, monto_usd, descripcion, referencia, fecha, subtipo, numero, grupo_id')
    .eq(columnaEntidad, id)
    .eq('tipo', tipoMovAbono);
  if (desde) qPagos = qPagos.gte('fecha', desde);
  if (hasta) qPagos = qPagos.lte('fecha', hasta);
  const { data: pagosData } = await qPagos;
  const pagosCrudos: PagoCrudo[] = ((pagosData as Array<{
    id: string; monto: number; monto_usd: number | null; descripcion: string | null;
    referencia: string | null; fecha: string; subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
    numero: number | null; grupo_id: string | null;
  }> | null) ?? [])
    // El estado de cuenta se lleva en USD (facturas_compra/venta.total está en USD).
    // monto_usd es el equivalente correcto cuando el pago salió de una banca en
    // otra moneda (ej. Bs); si no está presente, el movimiento ya estaba en USD.
    .map(p => ({
      id: p.id,
      monto: Number(p.monto_usd ?? p.monto),
      descripcion: p.descripcion,
      referencia: p.referencia,
      fecha: p.fecha,
      subtipo: p.subtipo,
      numero: p.numero,
      grupoId: p.grupo_id,
    }));
  // Un pago repartido entre varias bancas (y/o con porción de adelanto)
  // llega como varias filas de movimientos — se agrupan en una sola línea
  // por documento antes de armar el estado de cuenta (ver agruparPagos).
  const pagos = agruparPagos(pagosCrudos);

  // Notas de crédito/débito: notas_ajuste_proveedor / notas_ajuste_cliente
  // son tablas separadas (numeración propia cada una, Bloque 45), pero se
  // leen con la misma forma acá — solo cambia tabla/columna/tabla-de-facturas.
  const tablaNotas = esProveedor ? 'notas_ajuste_proveedor' : 'notas_ajuste_cliente';

  let qNotas = supabaseAdmin
    .from(tablaNotas)
    .select('id, tipo, monto, motivo, anulada, pagada, fecha, numero, factura_id')
    .eq(columnaEntidad, id);
  if (desde) qNotas = qNotas.gte('fecha', desde);
  if (hasta) qNotas = qNotas.lte('fecha', hasta);
  const { data: notasData } = await qNotas;
  const notasCrudas = (notasData as Array<{
    id: string; tipo: 'credito' | 'debito'; monto: number; motivo: string; anulada: boolean;
    pagada: boolean; fecha: string; numero: number | null; factura_id: string | null;
  }> | null) ?? [];

  // Selects planos, no embedding anidado de PostgREST — mismo estilo que
  // nota-ajuste-service.ts: se resuelve el código de cada factura asociada
  // con una segunda query + Map en vez de select('*, facturas_compra(numero)').
  const facturaIds = [...new Set(notasCrudas.map(n => n.factura_id).filter((x): x is string => x != null))];
  const codigoPorFacturaId = new Map<string, string | null>();
  if (facturaIds.length > 0) {
    const { data: facturasData } = await supabaseAdmin
      .from(tablaFacturas)
      .select('id, numero')
      .in('id', facturaIds);
    for (const f of (facturasData as Array<{ id: string; numero: number | null }> | null) ?? []) {
      codigoPorFacturaId.set(f.id, f.numero != null ? formatCodigo(tipoEntidad, f.numero) : null);
    }
  }

  const notas: NotaCruda[] = notasCrudas.map(n => ({
    id: n.id,
    tipo: n.tipo,
    monto: Number(n.monto),
    motivo: n.motivo,
    anulada: n.anulada,
    pagada: n.pagada,
    fecha: n.fecha,
    numero: n.numero,
    facturaAsociadaId: n.factura_id,
    facturaAsociadaCodigo: n.factura_id ? (codigoPorFacturaId.get(n.factura_id) ?? null) : null,
  }));

  return construirEstadoCuenta({ id: entidad.id, tipo: tipoEntidad, nombre: entidad.nombre }, facturas, pagos, notas);
}
