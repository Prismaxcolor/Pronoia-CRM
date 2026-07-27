import { supabaseAdmin } from '../config/supabase.js';
import type { EntidadTelegram } from './telegram-link-service.js';

export type EstadoGuia = 'solicitada' | 'en_tramite' | 'lista' | 'rechazada';

export interface GuiaPublica {
  id: string;
  estado: EstadoGuia;
  urlPdf: string | null;
  numeroGuia: string | null;
  createdAt: string;
  actualizadoEn: string;
}

interface GuiaRow {
  id: string;
  estado: EstadoGuia;
  url_pdf: string | null;
  numero_guia: string | null;
  created_at: string;
  actualizado_en: string;
}

function guiaToPublica(row: GuiaRow): GuiaPublica {
  return {
    id: row.id,
    estado: row.estado,
    urlPdf: row.url_pdf,
    numeroGuia: row.numero_guia,
    createdAt: row.created_at,
    actualizadoEn: row.actualizado_en,
  };
}

/** Las guías las escribe el workflow n8n de permisos gubernamentales (fuera de
 *  este repo) — este servicio solo lee, nunca escribe en guias_corpoez. */
export async function listarGuiasEntidad(entidadTipo: EntidadTelegram, entidadId: string): Promise<GuiaPublica[]> {
  const { data } = await supabaseAdmin
    .from('guias_corpoez')
    .select('*')
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .order('created_at', { ascending: false });

  return ((data as GuiaRow[] | null) ?? []).map(guiaToPublica);
}
