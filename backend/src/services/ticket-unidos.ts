import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Datos extra del ticket terminado, con lectura/escritura tolerante: el código puede
 * desplegarse antes que las migraciones (ticket_principal_id y notas_completado).
 * Si falta una columna se responde "sin datos" y no se rompe el flujo.
 */

export interface PesajeGlobalUnidoPublico {
  ticketId: string;
  codigo: string;
  fecha: string | null;
  pesajes: Array<{ id: string; peso: number; tara: number; fotos: string[] }>;
}

interface FilaUnida {
  id: string;
  numero: number;
  tipo: 'compra' | 'venta';
  fecha: string | null;
  created_at: string;
  pesajes_globales?: Array<{ id: string; orden: number; peso: number; tara: number; fotos: string[] | null }> | null;
}

/** Normaliza las filas de tickets unidos a la forma pública (ordenadas por creación, pesadas por `orden`). */
export function unidosAPublico(
  filas: readonly FilaUnida[],
  codigo: (numero: number, tipo: 'compra' | 'venta') => string,
): PesajeGlobalUnidoPublico[] {
  return [...filas]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(f => ({
      ticketId: f.id,
      codigo: codigo(Number(f.numero), f.tipo),
      fecha: f.fecha,
      pesajes: [...(f.pesajes_globales ?? [])]
        .sort((a, b) => a.orden - b.orden)
        .map(p => ({ id: p.id, peso: Number(p.peso), tara: Number(p.tara), fotos: p.fotos ?? [] })),
    }));
}

/** Pesajes globales de los tickets unidos al principal `id`. [] si no hay o si la columna no existe. */
export async function pesajesGlobalesDeUnidos(
  id: string,
  codigo: (numero: number, tipo: 'compra' | 'venta') => string,
): Promise<PesajeGlobalUnidoPublico[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('tickets_pesaje')
      .select('id, numero, tipo, fecha, created_at, pesajes_globales(*)')
      .eq('ticket_principal_id', id);
    if (error || !data) return [];
    return unidosAPublico(data as unknown as FilaUnida[], codigo);
  } catch {
    return [];
  }
}

/** Texto de notas listo para guardar: sin espacios sobrantes; null si queda vacío. */
export function normalizarNotas(notas: string | null | undefined): string | null {
  const limpio = (notas ?? '').trim();
  return limpio.length > 0 ? limpio : null;
}

/** Guarda las notas del completado. Tolerante: si la columna aún no existe solo deja un aviso en el log. */
export async function guardarNotasCompletado(id: string, notas: string | null | undefined): Promise<void> {
  const texto = normalizarNotas(notas);
  if (!texto) return;
  const { error } = await supabaseAdmin.from('tickets_pesaje').update({ notas_completado: texto }).eq('id', id);
  if (error) {
    logger.warn({ evento: 'ticket_notas_completado_no_guardadas', ticketId: id, mensaje: error.message });
  }
}
