import { supabaseAdmin } from '../config/supabase.js';

/**
 * Almacén por defecto de las salidas a lote de una transformación: el de la
 * transformación y, si no tiene (transformaciones antiguas), el almacén
 * predeterminado activo. null si no hay ninguno de los dos.
 */
export async function almacenPorDefectoSalidas(transformacionId: string): Promise<string | null> {
  const { data: t } = await supabaseAdmin
    .from('transformaciones')
    .select('almacen_id')
    .eq('id', transformacionId)
    .maybeSingle();
  const delaTransformacion = (t?.almacen_id as string | null | undefined) ?? null;
  if (delaTransformacion) return delaTransformacion;

  const { data: predeterminado } = await supabaseAdmin
    .from('almacenes')
    .select('id')
    .eq('es_predeterminado', true)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();
  return (predeterminado?.id as string | undefined) ?? null;
}
