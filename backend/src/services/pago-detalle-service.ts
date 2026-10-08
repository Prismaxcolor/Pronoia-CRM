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
  formatCodigoCruce,
  formatCodigoCruceCliente,
} from '../utils/codigos.js';
import { cuentaVisible, TEXTO_CUENTA_RESTRINGIDA, type BancasPermitidas } from '../utils/banca-acceso.js';
import { resumenComprobante, type FacturaComprobante, type FilaComprobante } from '../utils/comprobante-resumen.js';

type Subtipo = 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
type TipoItemAplicacion = 'factura' | 'nota_debito' | 'nota_credito' | 'adelanto';

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
  creado_en?: string | null;
  anulado?: boolean | null;
  anulado_at?: string | null;
  anulado_por?: string | null;
  anulado_motivo?: string | null;
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
  /** Id del documento aplicado (factura, nota o grupo del adelanto): lo necesita la edición contable. */
  id: string;
  tipo: TipoItemAplicacion;
  /** Código de control del documento aplicado (C-/V-/ND-/NC-/NDV-/NCV-).
   *  Null si el documento referenciado ya no tiene numero (no debería pasar
   *  en finanzas, pero no bloquea el resto del comprobante). Para un adelanto
   *  es el AD-/AC- del adelanto que se aplicó. */
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
  /** Instante (timestamptz) en que se registró el pago/cobro; null en cruces o si la fila no lo trae. */
  registradoEn?: string | null;
  bancas: BancaPagoDetalle[];
  totalUsd: number;
  /** Correlativo del pago/cobro (PG-/CB-), null si esta operación no tuvo esa parte. */
  codigoPago: string | null;
  /** Correlativo del adelanto/anticipo (AD-/AC-), null si esta operación no tuvo esa parte. */
  codigoAdelanto: string | null;
  /** Correlativo del cruce (CR-/CRV-) cuando la operación no movió dinero: solo
   *  compensó facturas con adelantos/notas. Null en pagos/cobros con efectivo. */
  codigoCruce: string | null;
  /** Desglose por factura/nota aplicada, con el monto exacto de cada una
   *  (Bloque 49). Vacío en pagos registrados antes de ese bloque — esa data
   *  nunca se guardó, el comprobante sigue mostrando solo `descripcion`. */
  items: ItemPagoDetalle[];
  /** Resumen en el orden del comprobante: total de las facturas, adelantos / N/C / N/D aplicados,
   *  saldo pendiente y, al final, lo pagado. Calculado aquí (utils/comprobante-resumen.ts); los
   *  clientes solo lo dibujan. */
  resumen: FilaComprobante[];
  /** true si la operación fue anulada (la fila nunca se borra; sus saldos ya no cuentan). */
  anulado: boolean;
  anuladoMotivo: string | null;
  /** Instante (timestamptz) de la anulación. */
  anuladoEn: string | null;
  /** Nombre de quien anuló. */
  anuladoPor: string | null;
}

/** Datos de anulación de un grupo (movimientos o cruce), con el nombre de quien anuló. */
async function datosAnulacion(
  anulado: boolean, motivo: string | null | undefined, instante: string | null | undefined, porId: string | null | undefined
): Promise<Pick<PagoDetalle, 'anulado' | 'anuladoMotivo' | 'anuladoEn' | 'anuladoPor'>> {
  if (!anulado) return { anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null };
  let nombre: string | null = null;
  if (porId) {
    const { data } = await supabaseAdmin.from('users').select('nombre').eq('id', porId).maybeSingle();
    nombre = (data as { nombre: string } | null)?.nombre ?? null;
  }
  return { anulado: true, anuladoMotivo: motivo ?? null, anuladoEn: instante ?? null, anuladoPor: nombre };
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
 *
 * `permitidas` (bancas del usuario que consulta; null = sin restricción, el valor por defecto para
 * usos internos como auditoría o Telegram): las filas NO se quitan, para no falsear totales, pero el
 * nombre, la referencia y los comprobantes de cuentas sin acceso se ocultan ('Cuenta restringida').
 */
export async function obtenerPagoDetalle(
  tipoEntidad: TipoEntidad,
  entidadId: string,
  grupoId: string,
  permitidas: BancasPermitidas = null
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
    .select('id, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion, referencia, fecha, comprobantes, registrado_por, banca_origen_id, creado_en, anulado, anulado_at, anulado_por, anulado_motivo')
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
  if (propias.length === 0) return obtenerCruceDetalle(tipoEntidad, entidadId, grupoId);

  // Selects planos + Map, no embeddings anidados de PostgREST — mismo estilo
  // que nota-ajuste-service.ts.
  const [{ data: entidadData }] = await Promise.all([
    supabaseAdmin.from(esProveedor ? 'proveedores' : 'clientes').select('id, nombre').eq('id', entidadId).maybeSingle(),
  ]);
  const nombreEntidad = (entidadData as { nombre: string } | null)?.nombre ?? '—';

  const visible = (f: MovimientoRow): boolean => cuentaVisible(permitidas, f.banca_origen_id);
  const bancaIds = [...new Set(propias.filter(visible).map(f => f.banca_origen_id).filter((x): x is string => x != null))];
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
  const filaComprobante = propias.find(f => visible(f) && f.comprobantes && f.comprobantes.length > 0) ?? null;
  const filaDescripcion = propias.find(f => f.descripcion) ?? propias[0];

  const { items, facturas } = await cargarItems(tipoEntidad, entidadId, grupoId);
  const totalUsd = propias.reduce((s, f) => s + Number(f.monto_usd ?? f.monto), 0);
  const filaAnulada = propias.find(f => f.anulado) ?? null;
  const anulacion = await datosAnulacion(propias.every(f => f.anulado), filaAnulada?.anulado_motivo, filaAnulada?.anulado_at, filaAnulada?.anulado_por);

  return {
    grupoId,
    entidadTipo: tipoEntidad,
    entidadId,
    nombreEntidad,
    fecha: propias[0].fecha.slice(0, 10),
    descripcion: filaDescripcion.descripcion,
    comprobantes: filaComprobante?.comprobantes ?? [],
    registradoPor: nombreRegistradoPor,
    registradoEn: propias.map(f => f.creado_en).filter((x): x is string => !!x).sort()[0] ?? null,
    bancas: propias.map(f => aBancaPagoDetalle(f, visible(f), nombrePorBancaId)),
    totalUsd,
    codigoPago: filaPago ? formatCodigoPago(tipoEntidad, filaPago.subtipo, filaPago.numero) : null,
    codigoAdelanto: filaAdelanto ? formatCodigoPago(tipoEntidad, filaAdelanto.subtipo, filaAdelanto.numero) : null,
    codigoCruce: null,
    items,
    resumen: resumenComprobante(items, totalUsd, esProveedor, facturas),
    ...anulacion,
  };
}

function aBancaPagoDetalle(f: MovimientoRow, visible: boolean, nombrePorBancaId: ReadonlyMap<string, string>): BancaPagoDetalle {
  return {
    bancaId: visible ? f.banca_origen_id : null,
    bancaNombre: !visible ? TEXTO_CUENTA_RESTRINGIDA : f.banca_origen_id ? (nombrePorBancaId.get(f.banca_origen_id) ?? null) : null,
    monto: Number(f.monto),
    moneda: f.moneda,
    montoUsd: Number(f.monto_usd ?? f.monto),
    referencia: visible ? f.referencia : TEXTO_CUENTA_RESTRINGIDA,
  };
}

/**
 * Desglose por ítem (Bloque 49) de una operación: facturas, notas y adelantos
 * aplicados con su monto exacto. `grupoId` ya viene validado contra la entidad
 * por quien llama (pertenece a sus movimientos o a su cruce).
 */
async function cargarItems(
  tipoEntidad: TipoEntidad,
  entidadId: string,
  grupoId: string
): Promise<{ items: ItemPagoDetalle[]; facturas: FacturaComprobante[] }> {
  const esProveedor = tipoEntidad === 'proveedor';

  const { data: aplicacionesData } = await supabaseAdmin
    .from('pago_aplicaciones')
    .select('tipo, item_id, monto_usd')
    .eq('grupo_id', grupoId)
    .order('created_at', { ascending: true });
  const aplicaciones = (aplicacionesData as AplicacionRow[] | null) ?? [];

  const facturaIds = aplicaciones.filter(a => a.tipo === 'factura').map(a => a.item_id);
  const notaIds = aplicaciones.filter(a => a.tipo === 'nota_debito' || a.tipo === 'nota_credito').map(a => a.item_id);
  const adelantoIds = aplicaciones.filter(a => a.tipo === 'adelanto').map(a => a.item_id);

  const codigoPorFacturaId = new Map<string, string>();
  const facturas: FacturaComprobante[] = [];
  if (facturaIds.length > 0) {
    const tablaFactura = esProveedor ? 'facturas_compra' : 'facturas_venta';
    const { data: facturasData } = await supabaseAdmin
      .from(tablaFactura)
      .select('id, numero, total, monto_pagado')
      .in('id', [...new Set(facturaIds)]);
    type FilaFactura = { id: string; numero: number | null; total: number | null; monto_pagado: number | null };
    for (const f of (facturasData as FilaFactura[] | null) ?? []) {
      facturas.push({ total: Number(f.total ?? 0), montoPagado: Number(f.monto_pagado ?? 0) });
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

  // El item_id de un adelanto es el grupo_id de su operación (o el id del
  // movimiento si es legacy sin grupo): se busca el AD-/AC- por cualquiera de los dos.
  const codigoPorAdelantoId = new Map<string, string>();
  if (adelantoIds.length > 0) {
    const columnaEntidad = esProveedor ? 'proveedor_id' : 'cliente_id';
    const subtipoAdelanto = esProveedor ? 'adelanto' : 'anticipo';
    const lista = adelantoIds.join(',');
    const { data: adelantosData } = await supabaseAdmin
      .from('movimientos')
      .select('id, grupo_id, numero')
      .eq(columnaEntidad, entidadId)
      .eq('subtipo', subtipoAdelanto)
      .or(`grupo_id.in.(${lista}),id.in.(${lista})`);
    for (const m of (adelantosData as Array<{ id: string; grupo_id: string | null; numero: number | null }> | null) ?? []) {
      if (m.numero == null) continue;
      codigoPorAdelantoId.set(m.grupo_id ?? m.id, formatCodigoPago(tipoEntidad, subtipoAdelanto, m.numero) ?? '');
    }
  }

  const items = aplicaciones.map(a => ({
    id: a.item_id,
    tipo: a.tipo,
    codigo: (a.tipo === 'factura' ? codigoPorFacturaId : a.tipo === 'adelanto' ? codigoPorAdelantoId : codigoPorNotaId).get(a.item_id) ?? null,
    montoUsd: Number(a.monto_usd),
  }));
  return { items, facturas };
}

/**
 * Comprobante de un cruce sin movimiento de dinero (tabla `cruces`): no hay
 * filas en `movimientos`, el documento es la compensación de facturas con
 * adelantos y notas. Valida pertenencia a la entidad, igual que un pago.
 */
async function obtenerCruceDetalle(
  tipoEntidad: TipoEntidad,
  entidadId: string,
  grupoId: string,
  permitidas: BancasPermitidas = null
): Promise<PagoDetalle | { error: string }> {
  const esProveedor = tipoEntidad === 'proveedor';

  const { data } = await supabaseAdmin
    .from('cruces')
    .select('grupo_id, numero, fecha, descripcion, registrado_por, created_at, anulado, anulado_at, anulado_por, anulado_motivo')
    .eq('grupo_id', grupoId)
    .eq(esProveedor ? 'proveedor_id' : 'cliente_id', entidadId)
    .maybeSingle();
  const cruce = data as { grupo_id: string; numero: number; fecha: string; descripcion: string | null; registrado_por: string | null; created_at?: string | null; anulado?: boolean | null; anulado_at?: string | null; anulado_por?: string | null; anulado_motivo?: string | null } | null;
  if (!cruce) return { error: 'Pago no encontrado para esta entidad.' };

  const [{ data: entidadData }, { data: usuario }, { items, facturas }] = await Promise.all([
    supabaseAdmin.from(esProveedor ? 'proveedores' : 'clientes').select('id, nombre').eq('id', entidadId).maybeSingle(),
    cruce.registrado_por
      ? supabaseAdmin.from('users').select('id, nombre').eq('id', cruce.registrado_por).maybeSingle()
      : Promise.resolve({ data: null }),
    cargarItems(tipoEntidad, entidadId, grupoId),
  ]);

  return {
    grupoId,
    entidadTipo: tipoEntidad,
    entidadId,
    nombreEntidad: (entidadData as { nombre: string } | null)?.nombre ?? '—',
    fecha: cruce.fecha.slice(0, 10),
    descripcion: cruce.descripcion,
    comprobantes: [],
    registradoPor: (usuario as { nombre: string } | null)?.nombre ?? null,
    registradoEn: cruce.created_at ?? null,
    bancas: [],
    totalUsd: 0,
    codigoPago: null,
    codigoAdelanto: null,
    codigoCruce: esProveedor ? formatCodigoCruce(cruce.numero) : formatCodigoCruceCliente(cruce.numero),
    items,
    resumen: resumenComprobante(items, 0, esProveedor, facturas),
    ...(await datosAnulacion(Boolean(cruce.anulado), cruce.anulado_motivo, cruce.anulado_at, cruce.anulado_por)),
  };
}
