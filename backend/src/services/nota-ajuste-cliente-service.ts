import { supabaseAdmin } from '../config/supabase.js';
import type { CrearNotaAjusteInput } from '../schemas/notas-ajuste.js';
import { formatCodigoNotaCreditoCliente, formatCodigoNotaDebitoCliente } from '../utils/codigos.js';
import { notificarNota } from './telegram-eventos-service.js';
import { anularNotaAutorizada, type ResultadoAnulacionNota } from './nota-anulacion-autorizada.js';
import type { ActorEdicion } from './edicion-autorizada-service.js';
import type { ErrorTransaccion } from '../utils/transaccion-edicion.js';

/** Espejo de nota-ajuste-service.ts para clientes (Bloque 45) — misma forma,
 *  tabla y RPC propias (notas_ajuste_cliente / anular_nota_ajuste_cliente,
 *  numeración separada de la de proveedor). Se mantiene como archivo
 *  aparte en vez de generalizar nota-ajuste-service.ts con un parámetro de
 *  tipo: ese archivo ya está probado en producción con proveedores reales,
 *  duplicar evita el riesgo de tocar ese camino al agregar el de cliente. */

export interface NotaAjusteClienteCruda {
  id: string;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  fecha: string;
}

interface NotaRow {
  id: string;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  created_at: string;
}

/** Notas de ajuste de un cliente, para plegarlas en su Estado de Cuenta. */
export async function listarNotasAjusteCliente(clienteId: string): Promise<NotaAjusteClienteCruda[]> {
  const { data, error } = await supabaseAdmin
    .from('notas_ajuste_cliente')
    .select('id, tipo, monto, motivo, anulada, created_at')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as NotaRow[]).map(r => ({
    id: r.id,
    tipo: r.tipo,
    monto: Number(r.monto),
    motivo: r.motivo,
    anulada: r.anulada,
    fecha: r.created_at,
  }));
}

export async function crearNotaAjusteCliente(
  clienteId: string,
  input: CrearNotaAjusteInput,
  registradoPor: string
): Promise<{ id: string; codigo: string | null } | { error: string }> {
  if (input.facturaId) {
    const { data: factura, error: errFactura } = await supabaseAdmin
      .from('facturas_venta')
      .select('id, estado')
      .eq('id', input.facturaId)
      .eq('cliente_id', clienteId)
      .maybeSingle();

    if (errFactura || !factura) {
      return { error: 'La factura no pertenece a este cliente.' };
    }
    if ((factura as { estado?: string }).estado === 'anulada') {
      return { error: 'No se puede crear una nota sobre una factura anulada.' };
    }
  }

  const insertRow: Record<string, unknown> = {
    cliente_id: clienteId,
    tipo: input.tipo,
    monto: input.monto,
    motivo: input.motivo,
    registrado_por: registradoPor,
    factura_id: input.facturaId ?? null,
  };
  if (input.fecha) insertRow.fecha = input.fecha;

  const { data, error } = await supabaseAdmin
    .from('notas_ajuste_cliente')
    .insert(insertRow)
    .select('id, tipo, numero')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la nota.' };
  const row = data as { id: string; tipo: 'credito' | 'debito'; numero: number | null };
  const codigo = row.numero != null
    ? (row.tipo === 'credito' ? formatCodigoNotaCreditoCliente(row.numero) : formatCodigoNotaDebitoCliente(row.numero))
    : null;
  // Telegram (fire-and-forget): la nota (PDF) al cliente si está vinculado.
  notificarNota('cliente', clienteId, () => obtenerNotaAjusteCliente(clienteId, row.id), 'creada');
  return { id: row.id, codigo };
}

export interface NotaAjusteClienteDetalle {
  id: string;
  numero: number | null;
  /** Correlativo formateado (NCV-0004 / NDV-0002). Null si aún no tiene numero asignado. */
  codigo: string | null;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  pagada: boolean;
  fecha: string;
  clienteId: string;
  nombreCliente: string;
  registradoPor: string | null;
  /** Instante (timestamptz) en que se registró la nota; null si la fila no lo trae. */
  registradoEn: string | null;
  anulaNotaId: string | null;
  /** Datos de la anulación (solo si anulada): cuándo, quién (nombre ya resuelto) y por qué. */
  anuladaAt: string | null;
  anuladaPor: string | null;
  anuladaMotivo: string | null;
  facturaAsociada: { id: string; codigo: string | null; total: number } | null;
}

interface NotaDetalleRow {
  id: string;
  cliente_id: string;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  pagada: boolean;
  numero: number | null;
  fecha: string;
  registrado_por: string | null;
  created_at?: string | null;
  anula_nota_id: string | null;
  factura_id: string | null;
  anulada_at?: string | null;
  anulada_por?: string | null;
  anulada_motivo?: string | null;
}

/** Duplicado intencional de nota-ajuste-service.ts / estado-cuenta-service.ts
 *  (mismo patrón que formatCodigoPesaje) — formatea el correlativo de una
 *  factura de venta para el DTO de factura asociada. */
function formatCodigoFacturaVenta(numero: number): string {
  return `V-${String(numero).padStart(4, '0')}`;
}

export function construirNotaAjusteClienteDetalle(
  row: NotaDetalleRow,
  nombreCliente: string,
  nombreRegistradoPor: string | null,
  facturaAsociada: NotaAjusteClienteDetalle['facturaAsociada'] = null,
  nombreAnuladaPor: string | null = null
): NotaAjusteClienteDetalle {
  return {
    id: row.id,
    numero: row.numero,
    codigo: row.numero != null
      ? (row.tipo === 'credito' ? formatCodigoNotaCreditoCliente(row.numero) : formatCodigoNotaDebitoCliente(row.numero))
      : null,
    tipo: row.tipo,
    monto: Number(row.monto),
    motivo: row.motivo,
    anulada: row.anulada,
    pagada: row.pagada,
    fecha: row.fecha,
    clienteId: row.cliente_id,
    nombreCliente,
    registradoPor: nombreRegistradoPor,
    registradoEn: row.created_at ?? null,
    anulaNotaId: row.anula_nota_id,
    anuladaAt: row.anulada ? (row.anulada_at ?? null) : null,
    anuladaPor: row.anulada ? nombreAnuladaPor : null,
    anuladaMotivo: row.anulada ? (row.anulada_motivo ?? null) : null,
    facturaAsociada,
  };
}

export async function obtenerNotaAjusteCliente(
  clienteId: string,
  notaId: string
): Promise<NotaAjusteClienteDetalle | { error: string }> {
  const { data: nota, error: errNota } = await supabaseAdmin
    .from('notas_ajuste_cliente')
    .select('id, cliente_id, tipo, monto, motivo, anulada, pagada, numero, fecha, created_at, registrado_por, anula_nota_id, factura_id, anulada_at, anulada_por, anulada_motivo')
    .eq('id', notaId)
    .eq('cliente_id', clienteId)
    .maybeSingle();

  if (errNota || !nota) return { error: 'Nota no encontrada para este cliente.' };

  const row = nota as NotaDetalleRow;

  const { data: cliente } = await supabaseAdmin
    .from('clientes')
    .select('id, nombre')
    .eq('id', row.cliente_id)
    .maybeSingle();
  const nombreCliente = (cliente as { nombre: string } | null)?.nombre ?? '—';

  let nombreRegistradoPor: string | null = null;
  if (row.registrado_por) {
    const { data: usuario } = await supabaseAdmin
      .from('users')
      .select('id, nombre')
      .eq('id', row.registrado_por)
      .maybeSingle();
    nombreRegistradoPor = (usuario as { nombre: string } | null)?.nombre ?? null;
  }

  let nombreAnuladaPor: string | null = null;
  if (row.anulada && row.anulada_por) {
    const { data: usuario } = await supabaseAdmin
      .from('users')
      .select('id, nombre')
      .eq('id', row.anulada_por)
      .maybeSingle();
    nombreAnuladaPor = (usuario as { nombre: string } | null)?.nombre ?? null;
  }

  let facturaAsociada: NotaAjusteClienteDetalle['facturaAsociada'] = null;
  if (row.factura_id) {
    const { data: factura } = await supabaseAdmin
      .from('facturas_venta')
      .select('id, numero, total')
      .eq('id', row.factura_id)
      .maybeSingle();
    const f = factura as { id: string; numero: number | null; total: number } | null;
    if (f) {
      facturaAsociada = {
        id: f.id,
        codigo: f.numero != null ? formatCodigoFacturaVenta(f.numero) : null,
        total: Number(f.total),
      };
    }
  }

  return construirNotaAjusteClienteDetalle(row, nombreCliente, nombreRegistradoPor, facturaAsociada, nombreAnuladaPor);
}

/** Anula una nota: la RPC solo la marca anulada (con fecha, usuario y motivo). No crea
 *  ninguna nota contraria y la nota anulada deja de afectar el estado de cuenta. Devuelve
 *  el id de la misma nota. La RPC rechaza notas ya anuladas o ya aplicadas a un cobro. */
export async function anularNotaAjusteCliente(
  clienteId: string,
  notaId: string,
  motivo: string,
  registradoPor: string
): Promise<{ id: string } | { error: string }> {
  const { data: nota, error: errNota } = await supabaseAdmin
    .from('notas_ajuste_cliente')
    .select('id')
    .eq('id', notaId)
    .eq('cliente_id', clienteId)
    .maybeSingle();

  if (errNota || !nota) return { error: 'Nota no encontrada para este cliente.' };

  const { data, error } = await supabaseAdmin.rpc('anular_nota_ajuste_cliente', {
    p_nota_id: notaId,
    p_motivo: motivo,
    p_registrado_por: registradoPor,
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo anular la nota.' };
  notificarNota('cliente', clienteId, () => obtenerNotaAjusteCliente(clienteId, notaId), 'anulada');
  return { id: data as string };
}

/** Anular una nota exige llave de edición (o superadmin): autoriza, anula y deja el rastro en el historial. */
export function anularNotaAjusteClienteConLlave(
  clienteId: string,
  notaId: string,
  motivo: string,
  actor: ActorEdicion
): Promise<ResultadoAnulacionNota | ErrorTransaccion> {
  return anularNotaAutorizada({
    tipo: 'nota_ajuste_cliente',
    notaId,
    motivo,
    actor,
    anular: () => anularNotaAjusteCliente(clienteId, notaId, motivo, actor.userId),
  });
}
