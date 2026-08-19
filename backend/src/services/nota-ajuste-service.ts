import { supabaseAdmin } from '../config/supabase.js';
import type { CrearNotaAjusteInput } from '../schemas/notas-ajuste.js';
import { formatCodigoNotaCredito, formatCodigoNotaDebito } from '../utils/codigos.js';

export interface NotaAjusteCruda {
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

/** Notas de ajuste de un proveedor, para plegarlas en su Estado de Cuenta. */
export async function listarNotasAjuste(proveedorId: string): Promise<NotaAjusteCruda[]> {
  const { data, error } = await supabaseAdmin
    .from('notas_ajuste_proveedor')
    .select('id, tipo, monto, motivo, anulada, created_at')
    .eq('proveedor_id', proveedorId)
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

export async function crearNotaAjuste(
  proveedorId: string,
  input: CrearNotaAjusteInput,
  registradoPor: string
): Promise<{ id: string; codigo: string | null } | { error: string }> {
  // La factura asociada es opcional (ajuste general de saldo), pero si viene
  // se valida que pertenezca a este proveedor antes de insertar — mismo
  // patrón defensivo que obtenerNotaAjuste/anularNotaAjuste, para no dejar
  // una nota apuntando a la factura de otro proveedor.
  if (input.facturaId) {
    const { data: factura, error: errFactura } = await supabaseAdmin
      .from('facturas_compra')
      .select('id')
      .eq('id', input.facturaId)
      .eq('proveedor_id', proveedorId)
      .maybeSingle();

    if (errFactura || !factura) {
      return { error: 'La factura no pertenece a este proveedor.' };
    }
  }

  const { data, error } = await supabaseAdmin
    .from('notas_ajuste_proveedor')
    .insert({
      proveedor_id: proveedorId,
      tipo: input.tipo,
      monto: input.monto,
      motivo: input.motivo,
      registrado_por: registradoPor,
      factura_id: input.facturaId ?? null,
    })
    .select('id, tipo, numero')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la nota.' };
  const row = data as { id: string; tipo: 'credito' | 'debito'; numero: number | null };
  const codigo = row.numero != null
    ? (row.tipo === 'credito' ? formatCodigoNotaCredito(row.numero) : formatCodigoNotaDebito(row.numero))
    : null;
  return { id: row.id, codigo };
}

export interface NotaAjusteDetalle {
  id: string;
  numero: number | null;
  /** Correlativo formateado (NC-0004 / ND-0002). Null si aún no tiene numero asignado. */
  codigo: string | null;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  pagada: boolean;
  /** created_at de la nota, sin recortar (la vista de detalle decide el formato). */
  fecha: string;
  proveedorId: string;
  nombreProveedor: string;
  /** Nombre del usuario que la registró, ya resuelto — nunca el uuid crudo. */
  registradoPor: string | null;
  anulaNotaId: string | null;
  /** Factura de compra a la que se asocia la nota (opcional), ya resuelta. Null si es
   *  un ajuste general sin factura de por medio. */
  facturaAsociada: { id: string; codigo: string | null; total: number } | null;
}

interface NotaDetalleRow {
  id: string;
  proveedor_id: string;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  pagada: boolean;
  numero: number | null;
  created_at: string;
  registrado_por: string | null;
  anula_nota_id: string | null;
  factura_id: string | null;
}

/** Duplicado intencional de estado-cuenta-service.ts (mismo patrón que
 *  formatCodigoPesaje) — formatea el correlativo de una factura de compra
 *  para el DTO de factura asociada. */
function formatCodigoFacturaCompra(numero: number): string {
  return `C-${String(numero).padStart(4, '0')}`;
}

/** Arma el DTO de detalle de una nota a partir de la fila cruda y los nombres
 *  (proveedor, usuario) ya resueltos. Función pura, testeable sin BD. */
export function construirNotaAjusteDetalle(
  row: NotaDetalleRow,
  nombreProveedor: string,
  nombreRegistradoPor: string | null,
  facturaAsociada: NotaAjusteDetalle['facturaAsociada'] = null
): NotaAjusteDetalle {
  return {
    id: row.id,
    numero: row.numero,
    codigo: row.numero != null
      ? (row.tipo === 'credito' ? formatCodigoNotaCredito(row.numero) : formatCodigoNotaDebito(row.numero))
      : null,
    tipo: row.tipo,
    monto: Number(row.monto),
    motivo: row.motivo,
    anulada: row.anulada,
    pagada: row.pagada,
    fecha: row.created_at,
    proveedorId: row.proveedor_id,
    nombreProveedor,
    registradoPor: nombreRegistradoPor,
    anulaNotaId: row.anula_nota_id,
    facturaAsociada,
  };
}

/**
 * Detalle completo de una nota para su vista tipo "ticket" (previsualización
 * + impresión, como FacturaDetallePage). Valida que la nota pertenezca al
 * proveedor indicado antes de devolver nada — mismo patrón defensivo que
 * anularNotaAjuste, para no filtrar datos de otro proveedor por id directo.
 */
export async function obtenerNotaAjuste(
  proveedorId: string,
  notaId: string
): Promise<NotaAjusteDetalle | { error: string }> {
  const { data: nota, error: errNota } = await supabaseAdmin
    .from('notas_ajuste_proveedor')
    .select('id, proveedor_id, tipo, monto, motivo, anulada, pagada, numero, created_at, registrado_por, anula_nota_id, factura_id')
    .eq('id', notaId)
    .eq('proveedor_id', proveedorId)
    .maybeSingle();

  if (errNota || !nota) return { error: 'Nota no encontrada para este proveedor.' };

  const row = nota as NotaDetalleRow;

  // Selects planos + .map()/acceso directo en vez de embeddings anidados de
  // PostgREST (select('*, proveedores(nombre)')) — mismo estilo que el resto
  // del archivo.
  const { data: proveedor } = await supabaseAdmin
    .from('proveedores')
    .select('id, nombre')
    .eq('id', row.proveedor_id)
    .maybeSingle();
  const nombreProveedor = (proveedor as { nombre: string } | null)?.nombre ?? '—';

  let nombreRegistradoPor: string | null = null;
  if (row.registrado_por) {
    const { data: usuario } = await supabaseAdmin
      .from('users')
      .select('id, nombre')
      .eq('id', row.registrado_por)
      .maybeSingle();
    nombreRegistradoPor = (usuario as { nombre: string } | null)?.nombre ?? null;
  }

  let facturaAsociada: NotaAjusteDetalle['facturaAsociada'] = null;
  if (row.factura_id) {
    const { data: factura } = await supabaseAdmin
      .from('facturas_compra')
      .select('id, numero, total')
      .eq('id', row.factura_id)
      .maybeSingle();
    const f = factura as { id: string; numero: number | null; total: number } | null;
    if (f) {
      facturaAsociada = {
        id: f.id,
        codigo: f.numero != null ? formatCodigoFacturaCompra(f.numero) : null,
        total: Number(f.total),
      };
    }
  }

  return construirNotaAjusteDetalle(row, nombreProveedor, nombreRegistradoPor, facturaAsociada);
}

/** Anula una nota ya creada: la RPC inserta la nota contraria (nunca se borra). */
export async function anularNotaAjuste(
  proveedorId: string,
  notaId: string,
  motivo: string,
  registradoPor: string
): Promise<{ id: string } | { error: string }> {
  const { data: nota, error: errNota } = await supabaseAdmin
    .from('notas_ajuste_proveedor')
    .select('id')
    .eq('id', notaId)
    .eq('proveedor_id', proveedorId)
    .maybeSingle();

  if (errNota || !nota) return { error: 'Nota no encontrada para este proveedor.' };

  const { data, error } = await supabaseAdmin.rpc('anular_nota_ajuste_proveedor', {
    p_nota_id: notaId,
    p_motivo: motivo,
    p_registrado_por: registradoPor,
  });

  if (error || !data) return { error: error?.message ?? 'No se pudo anular la nota.' };
  return { id: data as string };
}
