import { supabaseAdmin } from '../config/supabase.js';

export type TipoEntidad = 'proveedor' | 'cliente';

export interface EntradaEstadoCuenta {
  /** Fecha ISO (YYYY-MM-DD). */
  fecha: string;
  tipo: 'factura' | 'pago';
  descripcion: string;
  referencia: string | null;
  /** Aumenta el saldo (facturas). */
  cargo: number;
  /** Reduce el saldo (pagos/cobros). */
  abono: number;
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

export interface FacturaCruda { id: string; total: number; descripcion: string | null; fecha: string }
export interface PagoCrudo { monto: number; descripcion: string | null; referencia: string | null; fecha: string }

/**
 * Arma el estado de cuenta a partir de facturas (cargos) y pagos (abonos) ya
 * cargados. Función pura: ordena, suma totales y calcula el saldo.
 */
export function construirEstadoCuenta(
  entidad: { id: string; tipo: TipoEntidad; nombre: string },
  facturas: FacturaCruda[],
  pagos: PagoCrudo[]
): EstadoCuenta {
  const entradas: EntradaEstadoCuenta[] = [];

  for (const f of facturas) {
    entradas.push({
      fecha: soloFecha(f.fecha),
      tipo: 'factura',
      descripcion: f.descripcion ?? 'Factura',
      referencia: f.id.slice(0, 8),
      cargo: Number(f.total),
      abono: 0,
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

  let qFacturas = supabaseAdmin.from(tablaFacturas).select('id, total, descripcion, created_at').eq(columnaEntidad, id);
  if (desde) qFacturas = qFacturas.gte('created_at', desde);
  if (hasta) qFacturas = qFacturas.lte('created_at', `${hasta}T23:59:59`);
  const { data: facturasData } = await qFacturas;
  const facturas: FacturaCruda[] = ((facturasData as Array<{ id: string; total: number; descripcion: string | null; created_at: string }> | null) ?? [])
    .map(f => ({ id: f.id, total: f.total, descripcion: f.descripcion, fecha: f.created_at }));

  let qPagos = supabaseAdmin.from('movimientos').select('id, monto, descripcion, referencia, fecha').eq(columnaEntidad, id).eq('tipo', tipoMovAbono);
  if (desde) qPagos = qPagos.gte('fecha', desde);
  if (hasta) qPagos = qPagos.lte('fecha', hasta);
  const { data: pagosData } = await qPagos;
  const pagos: PagoCrudo[] = ((pagosData as Array<{ monto: number; descripcion: string | null; referencia: string | null; fecha: string }> | null) ?? [])
    .map(p => ({ monto: p.monto, descripcion: p.descripcion, referencia: p.referencia, fecha: p.fecha }));

  return construirEstadoCuenta({ id: entidad.id, tipo: tipoEntidad, nombre: entidad.nombre }, facturas, pagos);
}
