import { supabaseAdmin } from '../config/supabase.js';
import type { TipoEntidad } from './estado-cuenta-service.js';
import {
  formatCodigoPagoProveedor,
  formatCodigoAdelanto,
  formatCodigoCobroCliente,
  formatCodigoAnticipoCliente,
  formatCodigoCompra,
  formatCodigoVenta,
  formatCodigoNotaDebito,
  formatCodigoNotaCredito,
  formatCodigoNotaDebitoCliente,
  formatCodigoNotaCreditoCliente,
} from '../utils/codigos.js';

type Subtipo = 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
type TipoItemAplicacion = 'factura' | 'nota_debito' | 'nota_credito';

interface AplicacionRow {
  tipo: TipoItemAplicacion;
  item_id: string;
  monto_usd: number;
}

interface MovimientoRow {
  id: string;
  subtipo: Subtipo;
  numero: number | null;
  grupo_id: string | null;
  monto: number;
  moneda: string;
  monto_usd: number | null;
  descripcion: string | null;
  referencia: string | null;
  fecha: string;
  comprobantes: string[] | null;
  registrado_por: string | null;
  banca_origen_id: string | null;
}

export interface BancaPagoDetalle {
  bancaId: string | null;
  bancaNombre: string | null;
  monto: number;
  moneda: string;
  montoUsd: number;
  referencia: string | null;
}

export interface ItemPagoDetalle {
  tipo: TipoItemAplicacion;
  /** Código de control del documento aplicado (C-/V-/ND-/NC-/NDV-/NCV-).
   *  Null si el documento referenciado ya no tiene numero (no debería pasar
   *  en finanzas, pero no bloquea el resto del comprobante). */
  codigo: string | null;
  montoUsd: number;
}

export interface PagoDetalle {
  grupoId: string;
  entidadTipo: TipoEntidad;
  entidadId: string;
  nombreEntidad: string;
  fecha: string;
  descripcion: string | null;
  comprobantes: string[];
  registradoPor: string | null;
  bancas: BancaPagoDetalle[];
  totalUsd: number;
  /** Correlativo del pago/cobro (PG-/CB-), null si esta operación no tuvo esa parte. */
  codigoPago: string | null;
  /** Correlativo del adelanto/anticipo (AD-/AC-), null si esta operación no tuvo esa parte. */
  codigoAdelanto: string | null;
  /** Desglose por factura/nota aplicada, con el monto exacto de cada una
   *  (Bloque 49). Vacío en pagos registrados antes de ese bloque — esa data
   *  nunca se guardó, el comprobante sigue mostrando solo `descripcion`. */
  items: ItemPagoDetalle[];
}

function formatCodigoPago(tipoEntidad: TipoEntidad, subtipo: Subtipo, numero: number | null): string | null {
  if (numero == null) return null;
  if (tipoEntidad === 'proveedor') {
    return subtipo === 'adelanto' ? formatCodigoAdelanto(numero) : formatCodigoPagoProveedor(numero);
  }
  return subtipo === 'anticipo' ? formatCodigoAnticipoCliente(numero) : formatCodigoCobroCliente(numero);
}

/**
 * Detalle completo de un pago/cobro para su comprobante imprimible (vista
 * tipo "ticket", como NotaDetallePage). `grupoId` es el identificador que ya
 * viaja en EntradaEstadoCuenta.pagoId — agrupa todas las filas de
 * `movimientos` de una misma operación (una por banca, más la porción de
 * adelanto/anticipo si la hubo). Valida que pertenezcan a la entidad
 * indicada antes de devolver nada — mismo patrón defensivo que
 * obtenerNotaAjuste, para no filtrar el pago de otra entidad por id directo.
 */
export async function obtenerPagoDetalle(
  tipoEntidad: TipoEntidad,
  entidadId: string,
  grupoId: string
): Promise<PagoDetalle | { error: string }> {
  // grupoId se interpola en un filtro .or() crudo más abajo — se valida el
  // formato antes para no dejar que un route param arbitrario reescriba la
  // expresión del filtro PostgREST.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(grupoId)) return { error: 'Pago no encontrado para esta entidad.' };

  const esProveedor = tipoEntidad === 'proveedor';
  const columnaEntidad = esProveedor ? 'proveedor_id' : 'cliente_id';
  const tipoMov = esProveedor ? 'egreso' : 'ingreso';

  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .select('id, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion, referencia, fecha, comprobantes, registrado_por, banca_origen_id')
    .eq(columnaEntidad, entidadId)
    .eq('tipo', tipoMov)
    .or(`grupo_id.eq.${grupoId},id.eq.${grupoId}`);

  if (error) return { error: 'No se pudo cargar el pago.' };
  const filas = (data as MovimientoRow[] | null) ?? [];
  // Filas legacy sin grupo_id se agrupan por su propio id (mismo criterio que
  // agruparPagos en estado-cuenta-service) — con el .or() de arriba puede
  // colarse una fila de otro grupo cuyo grupo_id coincidiera con este id por
  // casualidad; en la práctica son uuid random, el riesgo es nulo.
  const propias = filas.filter(f => (f.grupo_id ?? f.id) === grupoId);
  if (propias.length === 0) return { error: 'Pago no encontrado para esta entidad.' };

  // Selects planos + Map, no embeddings anidados de PostgREST — mismo estilo
  // que nota-ajuste-service.ts.
  const [{ data: entidadData }] = await Promise.all([
    supabaseAdmin.from(esProveedor ? 'proveedores' : 'clientes').select('id, nombre').eq('id', entidadId).maybeSingle(),
  ]);
  const nombreEntidad = (entidadData as { nombre: string } | null)?.nombre ?? '—';

  const bancaIds = [...new Set(propias.map(f => f.banca_origen_id).filter((x): x is string => x != null))];
  const nombrePorBancaId = new Map<string, string>();
  if (bancaIds.length > 0) {
    const { data: bancasData } = await supabaseAdmin.from('bancas').select('id, nombre').in('id', bancaIds);
    for (const b of (bancasData as Array<{ id: string; nombre: string }> | null) ?? []) {
      nombrePorBancaId.set(b.id, b.nombre);
    }
  }

  let nombreRegistradoPor: string | null = null;
  const registradoPorId = propias.find(f => f.registrado_por)?.registrado_por ?? null;
  if (registradoPorId) {
    const { data: usuario } = await supabaseAdmin.from('users').select('id, nombre').eq('id', registradoPorId).maybeSingle();
    nombreRegistradoPor = (usuario as { nombre: string } | null)?.nombre ?? null;
  }

  const filaPago = propias.find(f => f.subtipo === 'pago' || f.subtipo === 'cobro') ?? null;
  const filaAdelanto = propias.find(f => f.subtipo === 'adelanto' || f.subtipo === 'anticipo') ?? null;
  const filaComprobante = propias.find(f => f.comprobantes && f.comprobantes.length > 0) ?? null;
  const filaDescripcion = propias.find(f => f.descripcion) ?? propias[0];

  // Desglose por ítem (Bloque 49) — grupo_id ya viene validado contra esta
  // entidad arriba (mismo id que agrupa las filas de `propias`), así que no
  // hace falta revalidar pertenencia acá.
  const { data: aplicacionesData } = await supabaseAdmin
    .from('pago_aplicaciones')
    .select('tipo, item_id, monto_usd')
    .eq('grupo_id', grupoId)
    .order('created_at', { ascending: true });
  const aplicaciones = (aplicacionesData as AplicacionRow[] | null) ?? [];

  const facturaIds = aplicaciones.filter(a => a.tipo === 'factura').map(a => a.item_id);
  const notaIds = aplicaciones.filter(a => a.tipo !== 'factura').map(a => a.item_id);

  const codigoPorFacturaId = new Map<string, string>();
  if (facturaIds.length > 0) {
    const tablaFactura = esProveedor ? 'facturas_compra' : 'facturas_venta';
    const { data: facturasData } = await supabaseAdmin.from(tablaFactura).select('id, numero').in('id', facturaIds);
    for (const f of (facturasData as Array<{ id: string; numero: number | null }> | null) ?? []) {
      if (f.numero == null) continue;
      codigoPorFacturaId.set(f.id, esProveedor ? formatCodigoCompra(f.numero) : formatCodigoVenta(f.numero));
    }
  }

  const codigoPorNotaId = new Map<string, string>();
  if (notaIds.length > 0) {
    const tablaNota = esProveedor ? 'notas_ajuste_proveedor' : 'notas_ajuste_cliente';
    const { data: notasData } = await supabaseAdmin.from(tablaNota).select('id, tipo, numero').in('id', notaIds);
    for (const n of (notasData as Array<{ id: string; tipo: 'credito' | 'debito'; numero: number | null }> | null) ?? []) {
      if (n.numero == null) continue;
      const codigo = esProveedor
        ? (n.tipo === 'credito' ? formatCodigoNotaCredito(n.numero) : formatCodigoNotaDebito(n.numero))
        : (n.tipo === 'credito' ? formatCodigoNotaCreditoCliente(n.numero) : formatCodigoNotaDebitoCliente(n.numero));
      codigoPorNotaId.set(n.id, codigo);
    }
  }

  const items: ItemPagoDetalle[] = aplicaciones.map(a => ({
    tipo: a.tipo,
    codigo: a.tipo === 'factura' ? (codigoPorFacturaId.get(a.item_id) ?? null) : (codigoPorNotaId.get(a.item_id) ?? null),
    montoUsd: Number(a.monto_usd),
  }));

  return {
    grupoId,
    entidadTipo: tipoEntidad,
    entidadId,
    nombreEntidad,
    fecha: propias[0].fecha.slice(0, 10),
    descripcion: filaDescripcion.descripcion,
    comprobantes: filaComprobante?.comprobantes ?? [],
    registradoPor: nombreRegistradoPor,
    bancas: propias.map(f => ({
      bancaId: f.banca_origen_id,
      bancaNombre: f.banca_origen_id ? (nombrePorBancaId.get(f.banca_origen_id) ?? null) : null,
      monto: Number(f.monto),
      moneda: f.moneda,
      montoUsd: Number(f.monto_usd ?? f.monto),
      referencia: f.referencia,
    })),
    totalUsd: propias.reduce((s, f) => s + Number(f.monto_usd ?? f.monto), 0),
    codigoPago: filaPago ? formatCodigoPago(tipoEntidad, filaPago.subtipo, filaPago.numero) : null,
    codigoAdelanto: filaAdelanto ? formatCodigoPago(tipoEntidad, filaAdelanto.subtipo, filaAdelanto.numero) : null,
    items,
  };
}
