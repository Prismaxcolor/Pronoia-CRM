/** Alta de un maestro (insert directo) con «una sola fila» por clientRequestId (Fase 4).
 *
 *  Con clave: 1) si ya hay una fila con esa clave se devuelve (no se inserta nada); 2) se inserta con la
 *  clave; 3) si otro intento ganó la carrera (violación 23505 sobre la clave) se devuelve la fila existente.
 *  El índice único parcial client_request_id es la garantía final. Si las columnas aún no existen
 *  (migración sin aplicar) falla cerrado con 503 reintentable: no se inserta sin la clave. */
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { errorIdempotenciaNoDisponible } from './idempotencia-service.js';

type TablaMaestro = 'proveedores' | 'clientes' | 'productos' | 'taras' | 'almacenes' | 'vehiculos';

interface ErrorBd { code: string; message: string }

export interface ResultadoInsercion<T> {
  data: T | null;
  error: ErrorBd | null;
  /** true si la fila ya existía (reintento): no se creó otra. */
  repetida: boolean;
}

export interface OpcionesInsercion {
  clientRequestId?: string;
  capturadoEn?: string;
  /** Columnas a leer (por defecto todas). */
  columnas?: string;
}

const esViolacionUnica = (e: ErrorBd | null): boolean => e?.code === '23505';


async function buscarPorClave<T>(tabla: TablaMaestro, clave: string, columnas: string): Promise<{ fila: T | null; error: ErrorBd | null }> {
  const { data, error } = await supabaseAdmin.from(tabla).select(columnas).eq('client_request_id', clave).maybeSingle();
  return { fila: (data as T | null) ?? null, error };
}

export async function insertarMaestroIdempotente<T>(
  tabla: TablaMaestro,
  fila: Record<string, unknown>,
  opciones: OpcionesInsercion = {},
): Promise<ResultadoInsercion<T>> {
  const columnas = opciones.columnas ?? '*';
  const insertar = async (valores: Record<string, unknown>) => {
    const r = await supabaseAdmin.from(tabla).insert(valores).select(columnas).single();
    return { data: (r.data as T | null) ?? null, error: r.error as ErrorBd | null };
  };
  if (!opciones.clientRequestId) return { ...(await insertar(fila)), repetida: false };

  const clave = opciones.clientRequestId;
  const previa = await buscarPorClave<T>(tabla, clave, columnas);
  if (previa.error && esObjetoInexistente(previa.error)) {
    logger.error({ evento: 'idempotencia_bd_no_habilitada', tabla, mensaje: 'Falta aplicar docs/migration_operaciones_cliente_f4.sql: falla cerrado' });
    throw errorIdempotenciaNoDisponible();
  }
  if (previa.fila) return { data: previa.fila, error: null, repetida: true };

  const nuevo = await insertar({ ...fila, client_request_id: clave, capturado_en: opciones.capturadoEn ?? null });
  if (esViolacionUnica(nuevo.error)) {
    const ganadora = await buscarPorClave<T>(tabla, clave, columnas);
    if (ganadora.fila) return { data: ganadora.fila, error: null, repetida: true };
  }
  return { ...nuevo, repetida: false };
}

/** Campos opcionales que el cliente añade a una alta (ver schemas/cliente-operacion.ts). */
export interface MetaOperacion {
  clientRequestId?: string;
  capturadoEn?: string;
}
