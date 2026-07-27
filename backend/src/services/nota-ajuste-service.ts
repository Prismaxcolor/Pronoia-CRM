import { supabaseAdmin } from '../config/supabase.js';
import type { CrearNotaAjusteInput } from '../schemas/notas-ajuste.js';

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
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('notas_ajuste_proveedor')
    .insert({
      proveedor_id: proveedorId,
      tipo: input.tipo,
      monto: input.monto,
      motivo: input.motivo,
      registrado_por: registradoPor,
    })
    .select('id')
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la nota.' };
  return { id: (data as { id: string }).id };
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
