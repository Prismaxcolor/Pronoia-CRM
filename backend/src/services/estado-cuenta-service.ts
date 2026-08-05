import { supabaseAdmin } from '../config/supabase.js';

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
  tipo: 'factura' | 'pago' | 'nota_credito' | 'nota_debito';
  descripcion: string;
  referencia: string | null;
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
export interface PagoCrudo { monto: number; descripcion: string | null; referencia: string | null; fecha: string }
export interface NotaCruda { id: string; tipo: 'credito' | 'debito'; monto: number; motivo: string; anulada: boolean; fecha: string }

/**
 * Arma el estado de cuenta a partir de facturas (cargos), pagos (abonos) y
 * notas de crédito/débito (ajuste manual) ya cargados. Función pura: ordena,
 * suma totales y calcula el saldo.
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
    entradas.push({
      fecha: soloFecha(p.fecha),
      tipo: 'pago',
      descripcion: p.descripcion ?? 'Pago',
      referencia: p.referencia,
      cargo: 0,
      abono: Number(p.monto),
    });
  }
  // Nota de crédito: descuento a favor de la empresa, resta del saldo (abono).
  // Nota de débito: monto a favor del proveedor, suma al saldo (cargo). Una
  // nota anulada sigue sumando/restando junto con su contraria: el efecto neto
  // se cancela solo, sin borrar ninguna de las dos (auditoría).
  for (const n of notas) {
    entradas.push({
      fecha: soloFecha(n.fecha),
      tipo: n.tipo === 'credito' ? 'nota_credito' : 'nota_debito',
      descripcion: n.motivo,
      referencia: null,
      cargo: n.tipo === 'debito' ? Number(n.monto) : 0,
      abono: n.tipo === 'credito' ? Number(n.monto) : 0,
      notaId: n.id,
      anulada: n.anulada,
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

  let qPagos = supabaseAdmin.from('movimientos').select('id, monto, monto_usd, descripcion, referencia, fecha').eq(columnaEntidad, id).eq('tipo', tipoMovAbono);
  if (desde) qPagos = qPagos.gte('fecha', desde);
  if (hasta) qPagos = qPagos.lte('fecha', hasta);
  const { data: pagosData } = await qPagos;
  const pagos: PagoCrudo[] = ((pagosData as Array<{ monto: number; monto_usd: number | null; descripcion: string | null; referencia: string | null; fecha: string }> | null) ?? [])
    // El estado de cuenta se lleva en USD (facturas_compra/venta.total está en USD).
    // monto_usd es el equivalente correcto cuando el pago salió de una banca en
    // otra moneda (ej. Bs); si no está presente, el movimiento ya estaba en USD.
    .map(p => ({ monto: Number(p.monto_usd ?? p.monto), descripcion: p.descripcion, referencia: p.referencia, fecha: p.fecha }));

  // Notas de crédito/débito: solo existen para proveedores (Tarea de notas de ajuste).
  let notas: NotaCruda[] = [];
  if (esProveedor) {
    let qNotas = supabaseAdmin
      .from('notas_ajuste_proveedor')
      .select('id, tipo, monto, motivo, anulada, created_at')
      .eq('proveedor_id', id);
    if (desde) qNotas = qNotas.gte('created_at', desde);
    if (hasta) qNotas = qNotas.lte('created_at', `${hasta}T23:59:59`);
    const { data: notasData } = await qNotas;
    notas = ((notasData as Array<{ id: string; tipo: 'credito' | 'debito'; monto: number; motivo: string; anulada: boolean; created_at: string }> | null) ?? [])
      .map(n => ({ id: n.id, tipo: n.tipo, monto: Number(n.monto), motivo: n.motivo, anulada: n.anulada, fecha: n.created_at }));
  }

  return construirEstadoCuenta({ id: entidad.id, tipo: tipoEntidad, nombre: entidad.nombre }, facturas, pagos, notas);
}
