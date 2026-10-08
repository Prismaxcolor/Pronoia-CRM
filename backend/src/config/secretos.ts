import { logger } from '../utils/logger.js';

/** Lee un secreto de la tabla; null si no existe. Lanza si la consulta falla. */
export type LectorSecreto = (clave: string) => Promise<string | null>;

export const TTL_SECRETOS_MS = 5 * 60 * 1000;

interface EntradaCache {
  valor: string | undefined;
  expira: number;
}

const cache = new Map<string, EntradaCache>();
let lectorInyectado: LectorSecreto | null = null;
let reloj: () => number = Date.now;

/** Lector real: public.configuracion_secreta vía service_role (import diferido: no toca la
 *  base ni exige variables de Supabase hasta que de verdad se necesita). */
const lectorSupabase: LectorSecreto = async clave => {
  const { supabaseAdmin } = await import('./supabase.js');
  const { data, error } = await supabaseAdmin
    .from('configuracion_secreta')
    .select('valor')
    .eq('clave', clave)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { valor?: string | null } | null)?.valor ?? null;
};

/**
 * Devuelve el secreto `clave`: la variable de entorno manda; si no existe, se lee de
 * configuracion_secreta con caché de 5 min (también cachea los "no existe"). Si la consulta
 * falla devuelve undefined sin lanzar. En NODE_ENV=test solo usa env salvo que se inyecte
 * un lector falso. Nunca registra valores.
 */
export async function obtenerSecreto(clave: string): Promise<string | undefined> {
  const deEnv = process.env[clave];
  if (deEnv) return deEnv;

  const lector = lectorInyectado ?? (process.env.NODE_ENV === 'test' ? null : lectorSupabase);
  if (!lector) return undefined;

  const ahora = reloj();
  const guardado = cache.get(clave);
  if (guardado && guardado.expira > ahora) return guardado.valor;

  try {
    const valor = (await lector(clave)) || undefined;
    cache.set(clave, { valor, expira: ahora + TTL_SECRETOS_MS });
    return valor;
  } catch (err) {
    logger.error({ evento: 'secreto_lectura_error', clave, mensaje: err instanceof Error ? err.message : 'desconocido' });
    return undefined;
  }
}

/** Solo para pruebas: inyecta un lector y/o reloj falsos y vacía la caché. */
export function configurarSecretosParaPruebas(opciones: { lector?: LectorSecreto | null; ahora?: () => number } = {}): void {
  lectorInyectado = opciones.lector ?? null;
  reloj = opciones.ahora ?? Date.now;
  cache.clear();
}
