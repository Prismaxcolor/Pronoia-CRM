import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { cuentaVisible, TEXTO_CUENTA_RESTRINGIDA, type BancasPermitidas } from '../utils/banca-acceso.js';
import { totalesEstadoCuenta } from '../utils/estado-cuenta-totales.js';
import { leerPaginado, trocear } from '../utils/paginacion.js';
import {
  formatCodigoPagoProveedor,
  formatCodigoAdelanto,
  formatCodigoNotaCredito,
  formatCodigoNotaDebito,
  formatCodigoCobroCliente,
  formatCodigoAnticipoCliente,
  formatCodigoNotaCreditoCliente,
  formatCodigoNotaDebitoCliente,
  formatCodigoCruce,
  formatCodigoCruceCliente,
} from '../utils/codigos.js';
import { diaNegocio, inicioDiaNegocio, finDiaNegocio } from '../utils/fecha-negocio.js';

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
  /** Instante (timestamptz ISO) en que se registró, para mostrar la hora; ausente si no se conoce (cruces). */
  instante?: string | null;
  tipo: 'factura' | 'pago' | 'adelanto' | 'nota_credito' | 'nota_debito' | 'cruce';
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
  /** Solo pagos/adelantos: id para abrir el comprobante imprimible — es el
   *  grupo_id de la operación, o el id del movimiento si es una fila legacy
   *  sin grupo_id (mismo criterio que agruparPagos). Ausente para facturas/notas. */
  pagoId?: string;
  /** Solo notas: fue anulada (queda en historial; cargo/abono = 0, no afecta el saldo). */
  anulada?: boolean;
  /** Solo notas anuladas: monto original, para mostrarlo tachado (cargo/abono van en 0). */
  montoAnulado?: number;
  /** Solo notas de débito: ya se liquidó en un pago combinado ("Registrar pago"). */
  pagada?: boolean;
  /** Solo cruces: total de facturas saldadas con adelantos/notas, sin mover dinero. */
  montoCruzado?: number;
  /** Solo adelantos: cuánto ya se aplicó a facturas (cruces). */
  adelantoAplicado?: number;
  /** Solo adelantos: lo que sigue disponible para cruzar (abono - aplicado). */
  adelantoDisponible?: number;
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
  /** true si los datos de cruces/adelantos aplicados no se pudieron cargar completos (el saldo no depende de ellos). */
  datosCruceIncompletos?: true;
}

function soloFecha(valor: string): string {
  return diaNegocio(valor) ?? valor.slice(0, 10);
}

// ---- núcleo puro (testeable sin BD) ----------------------------------------

export interface FacturaCruda { id: string; total: number; descripcion: string | null; fecha: string; codigo?: string | null }

/** `fecha` de una factura es su created_at (instante): la hora solo aplica si trae parte horaria. */
const instanteSiTrae = (valor: string | null | undefined): string | null => (valor && valor.length > 10 ? valor : null);
export interface PagoCrudo {
  id: string;
  monto: number;
  descripcion: string | null;
  /** Texto libre que el usuario tipeó (ej. "TRF-432"), no el correlativo. */
  referencia: string | null;
  fecha: string;
  /** Instante de registro (movimientos.creado_en). */
  instante?: string | null;
  subtipo?: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
  numero?: number | null;
  grupoId?: string | null;
}
export interface NotaCruda {
  id: string; tipo: 'credito' | 'debito'; monto: number; motivo: string; anulada: boolean; pagada: boolean; fecha: string; numero?: number | null;
  /** Instante de registro (created_at de la nota). */
  instante?: string | null;
  /** Ya resueltos por obtenerEstadoCuenta (segunda query a facturas_compra + Map), no se
   *  vuelven a resolver acá — mismo patrón que FacturaCruda.codigo. */
  facturaAsociadaId?: string | null;
  facturaAsociadaCodigo?: string | null;
}

/** Cruce sin movimiento de dinero (tabla `cruces`): compensa facturas con adelantos y/o notas. */
export interface CruceCrudo {
  grupoId: string;
  numero: number | null;
  fecha: string;
  descripcion: string | null;
  /** Suma de las facturas saldadas por este cruce (USD). */
  montoCruzado: number;
}

/** Datos del cruce de adelantos con facturas, ya cargados por obtenerEstadoCuenta. */
export interface DatosCruce {
  cruces: CruceCrudo[];
  /** Monto ya aplicado de cada adelanto, por su pagoId (grupo_id, o id si es legacy). */
  adelantoAplicadoPorId: Map<string, number>;
  /** true si alguna consulta de cruces/aplicaciones falló: los datos de cruce son parciales. */
  incompleto?: boolean;
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
  notas: NotaCruda[] = [],
  datosCruce: DatosCruce = { cruces: [], adelantoAplicadoPorId: new Map() }
): EstadoCuenta {
  const entradas: EntradaEstadoCuenta[] = [];

  for (const f of facturas) {
    entradas.push({
      fecha: soloFecha(f.fecha),
      instante: instanteSiTrae(f.fecha),
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
    const pagoId = p.grupoId ?? p.id;
    const aplicado = esAnticipo ? Math.round((datosCruce.adelantoAplicadoPorId.get(pagoId) ?? 0) * 100) / 100 : 0;
    entradas.push({
      fecha: soloFecha(p.fecha),
      instante: p.instante ?? null,
      tipo: esAnticipo ? 'adelanto' : 'pago',
      descripcion: p.descripcion ?? (esAnticipo ? 'Adelanto' : 'Pago'),
      referencia: codigo ?? p.referencia,
      referenciaExterna: codigo ? p.referencia : null,
      cargo: 0,
      abono: Number(p.monto),
      pagoId,
      ...(esAnticipo ? { adelantoAplicado: aplicado, adelantoDisponible: Math.max(0, Math.round((Number(p.monto) - aplicado) * 100) / 100) } : {}),
    });
  }
  // Cruce sin movimiento de dinero: no cambia el saldo (cargo/abono = 0) — el
  // adelanto o la nota ya estaban restando y la factura ya estaba sumando;
  // solo se asignan entre sí. Se lista para dejar el historial completo.
  for (const c of datosCruce.cruces) {
    entradas.push({
      fecha: soloFecha(c.fecha),
      tipo: 'cruce',
      descripcion: c.descripcion ?? 'Cruce de facturas con adelantos y notas',
      referencia: c.numero != null ? (entidad.tipo === 'proveedor' ? formatCodigoCruce(c.numero) : formatCodigoCruceCliente(c.numero)) : null,
      cargo: 0,
      abono: 0,
      pagoId: c.grupoId,
      montoCruzado: c.montoCruzado,
    });
  }
  // Nota de crédito: descuento a favor de la empresa (proveedor) o del
  // cliente, resta del saldo (abono). Nota de débito: monto a favor de la
  // entidad, suma al saldo (cargo). Una nota anulada NO afecta el saldo
  // (cargo/abono = 0): se lista con su monto original en montoAnulado para
  // mostrarla tachada; anular no crea ninguna nota contraria.
  for (const n of notas) {
    const vigente = !n.anulada;
    entradas.push({
      fecha: soloFecha(n.fecha),
      instante: n.instante ?? null,
      tipo: n.tipo === 'credito' ? 'nota_credito' : 'nota_debito',
      descripcion: n.motivo,
      referencia: n.numero != null ? formatCodigoNota(entidad.tipo, n.tipo, n.numero) : null,
      cargo: vigente && n.tipo === 'debito' ? Number(n.monto) : 0,
      abono: vigente && n.tipo === 'credito' ? Number(n.monto) : 0,
      ...(vigente ? {} : { montoAnulado: Number(n.monto) }),
      notaId: n.id,
      anulada: n.anulada,
      pagada: n.pagada,
      facturaAsociadaId: n.facturaAsociadaId ?? null,
      facturaAsociadaCodigo: n.facturaAsociadaCodigo ?? null,
    });
  }

  entradas.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Única función de totales (compartida con el frontend): cargos, abonos y saldo en centavos exactos.
  const { totalCargos: facturado, totalAbonos: pagado, saldoFinal: saldo } = totalesEstadoCuenta(entradas);

  return {
    entidad,
    entradas,
    totales: { facturado, pagado, saldo },
    ...(datosCruce.incompleto ? { datosCruceIncompletos: true as const } : {}),
  };
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
  hasta?: string,
  permitidas: BancasPermitidas = null
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

  // Las facturas anuladas (ticket corregido con llave de edición) no son deuda: no entran al estado de cuenta.
  let qFacturas = supabaseAdmin.from(tablaFacturas).select('id, numero, total, descripcion, created_at').eq(columnaEntidad, id).neq('estado', 'anulada');
  if (desde) qFacturas = qFacturas.gte('created_at', inicioDiaNegocio(desde));
  if (hasta) qFacturas = qFacturas.lte('created_at', finDiaNegocio(hasta));
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
    .select('id, monto, monto_usd, descripcion, referencia, fecha, subtipo, numero, grupo_id, creado_en, banca_origen_id')
    .eq(columnaEntidad, id)
    .eq('tipo', tipoMovAbono)
    .eq('anulado', false);
  if (desde) qPagos = qPagos.gte('fecha', desde);
  if (hasta) qPagos = qPagos.lte('fecha', hasta);
  const { data: pagosData } = await qPagos;
  const pagosCrudos: PagoCrudo[] = ((pagosData as Array<{
    id: string; monto: number; monto_usd: number | null; descripcion: string | null;
    referencia: string | null; fecha: string; subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
    numero: number | null; grupo_id: string | null; creado_en?: string | null; banca_origen_id?: string | null;
  }> | null) ?? [])
    // El estado de cuenta se lleva en USD (facturas_compra/venta.total está en USD).
    // monto_usd es el equivalente correcto cuando el pago salió de una banca en
    // otra moneda (ej. Bs); si no está presente, el movimiento ya estaba en USD.
    .map(p => ({
      id: p.id,
      monto: Number(p.monto_usd ?? p.monto),
      descripcion: p.descripcion,
      // Las filas no se filtran por banca (falsearía el saldo de la contraparte): solo se oculta la referencia.
      referencia: cuentaVisible(permitidas, p.banca_origen_id) ? p.referencia : TEXTO_CUENTA_RESTRINGIDA,
      fecha: p.fecha,
      instante: p.creado_en ?? null,
      subtipo: p.subtipo,
      numero: p.numero,
      grupoId: p.grupo_id,
    }));
  // Un pago repartido entre varias bancas (y/o con porción de adelanto)
  // llega como varias filas de movimientos — se agrupan en una sola línea
  // por documento antes de armar el estado de cuenta (ver agruparPagos).
  const pagos = agruparPagos(pagosCrudos);
  const datosCruce = await cargarDatosCruce(esProveedor, id, pagos, desde, hasta);

  // Notas de crédito/débito: notas_ajuste_proveedor / notas_ajuste_cliente
  // son tablas separadas (numeración propia cada una, Bloque 45), pero se
  // leen con la misma forma acá — solo cambia tabla/columna/tabla-de-facturas.
  const tablaNotas = esProveedor ? 'notas_ajuste_proveedor' : 'notas_ajuste_cliente';

  let qNotas = supabaseAdmin
    .from(tablaNotas)
    .select('id, tipo, monto, motivo, anulada, pagada, fecha, numero, factura_id, created_at')
    .eq(columnaEntidad, id);
  if (desde) qNotas = qNotas.gte('fecha', desde);
  if (hasta) qNotas = qNotas.lte('fecha', hasta);
  const { data: notasData } = await qNotas;
  const notasCrudas = (notasData as Array<{
    id: string; tipo: 'credito' | 'debito'; monto: number; motivo: string; anulada: boolean;
    pagada: boolean; fecha: string; numero: number | null; factura_id: string | null; created_at?: string | null;
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
    instante: n.created_at ?? null,
    numero: n.numero,
    facturaAsociadaId: n.factura_id,
    facturaAsociadaCodigo: n.factura_id ? (codigoPorFacturaId.get(n.factura_id) ?? null) : null,
  }));

  return construirEstadoCuenta({ id: entidad.id, tipo: tipoEntidad, nombre: entidad.nombre }, facturas, pagos, notas, datosCruce);
}

/**
 * Cruces sin movimiento de dinero de la entidad (tabla `cruces`) con el total de
 * facturas que saldó cada uno, y cuánto de cada adelanto ya se aplicó a facturas
 * (pago_aplicaciones tipo 'adelanto'). Si falla alguna consulta se degrada a
 * "sin datos de cruce": el saldo del estado de cuenta no depende de esto.
 */
async function cargarDatosCruce(
  esProveedor: boolean,
  entidadId: string,
  pagos: PagoCrudo[],
  desde?: string,
  hasta?: string
): Promise<DatosCruce> {
  const incompleto = (motivo: string, detalle: string): DatosCruce => {
    logger.warn({ evento: 'estado_cuenta.cruce_incompleto', motivo, detalle, entidadId, esProveedor });
    return { cruces: [], adelantoAplicadoPorId: new Map(), incompleto: true };
  };
  const columnaEntidad = esProveedor ? 'proveedor_id' : 'cliente_id';

  let qCruces = supabaseAdmin.from('cruces').select('grupo_id, numero, fecha, descripcion').eq(columnaEntidad, entidadId).eq('anulado', false);
  if (desde) qCruces = qCruces.gte('fecha', desde);
  if (hasta) qCruces = qCruces.lte('fecha', hasta);
  const { data: crucesData, error: errCruces } = await qCruces;
  if (errCruces) return incompleto('cruces', errCruces.message);
  const crucesRows = (crucesData as Array<{ grupo_id: string; numero: number | null; fecha: string; descripcion: string | null }> | null) ?? [];

  const adelantoIds = [...new Set(pagos.filter(p => p.subtipo === 'adelanto' || p.subtipo === 'anticipo').map(p => p.grupoId ?? p.id))];
  const crucesIds = crucesRows.map(c => c.grupo_id);

  try {
    const adelantoAplicadoPorId = await sumarAplicaciones('adelanto', 'item_id', adelantoIds);
    const cruzadoPorGrupo = await sumarAplicaciones('factura', 'grupo_id', crucesIds);
    return {
      cruces: crucesRows.map(c => ({
        grupoId: c.grupo_id,
        numero: c.numero,
        fecha: c.fecha,
        descripcion: c.descripcion,
        montoCruzado: Math.round((cruzadoPorGrupo.get(c.grupo_id) ?? 0) * 100) / 100,
      })),
      adelantoAplicadoPorId,
    };
  } catch (e) {
    return incompleto('pago_aplicaciones', e instanceof Error ? e.message : String(e));
  }
}

/** Suma monto_usd de pago_aplicaciones de un tipo, agrupado por `columnaClave`,
 *  consultando por lotes de ids y paginando. Lanza si alguna consulta falla. */
async function sumarAplicaciones(
  tipo: 'adelanto' | 'factura',
  columnaClave: 'item_id' | 'grupo_id',
  ids: string[]
): Promise<Map<string, number>> {
  const sumas = new Map<string, number>();
  for (const lote of trocear(ids)) {
    const filas = await leerPaginado<Record<string, string | number>>((desde, hasta) =>
      supabaseAdmin
        .from('pago_aplicaciones')
        .select(`id, ${columnaClave}, monto_usd`)
        .eq('tipo', tipo)
        .eq('anulada', false)
        .in(columnaClave, lote)
        .order('id', { ascending: true })
        .range(desde, hasta)
    );
    for (const a of filas) {
      const clave = String(a[columnaClave]);
      sumas.set(clave, (sumas.get(clave) ?? 0) + Number(a.monto_usd));
    }
  }
  return sumas;
}
