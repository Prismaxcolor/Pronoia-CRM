/** ¿El usuario sigue activo en la BD? Con caché en memoria de 30 s por usuario.
 *
 *  El JWT vive 7 días: sin esta comprobación un usuario desactivado (incluido un superadmin)
 *  conservaría acceso hasta que expire el token. La caché evita una consulta por petición; se
 *  invalida al desactivar/reactivar/borrar en esta instancia. En otras instancias (serverless) un
 *  cambio tarda como máximo TTL_USUARIO_ACTIVO_MS en notarse. */
import { supabaseAdmin } from '../config/supabase.js';

export const TTL_USUARIO_ACTIVO_MS = 30_000;
const MAX_ENTRADAS = 1000;

interface Entrada { activo: boolean; rol: string | null; expiraEn: number }
const cache = new Map<string, Entrada>();

export class ErrorVerificarUsuario extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorVerificarUsuario';
  }
}

export interface EstadoUsuario { activo: boolean; rol: string | null }

/** Estado real en la BD (activo + rol), con caché de 30 s. Lanza ErrorVerificarUsuario si la BD falla (no se cachea). */
export async function estadoUsuario(id: string, ahora: number = Date.now()): Promise<EstadoUsuario> {
  const previa = cache.get(id);
  if (previa && previa.expiraEn > ahora) return { activo: previa.activo, rol: previa.rol };

  const { data, error } = await supabaseAdmin.from('users').select('activo, rol').eq('id', id).maybeSingle();
  if (error) throw new ErrorVerificarUsuario(error.message);

  const activo = Boolean(data?.activo);
  const rol = data?.rol ? String(data.rol) : null;
  if (cache.size >= MAX_ENTRADAS) cache.clear();
  cache.set(id, { activo, rol, expiraEn: ahora + TTL_USUARIO_ACTIVO_MS });
  return { activo, rol };
}

/** true = activo; false = inexistente o desactivado. Lanza ErrorVerificarUsuario si la BD falla (no se cachea). */
export async function usuarioEstaActivo(id: string, ahora: number = Date.now()): Promise<boolean> {
  return (await estadoUsuario(id, ahora)).activo;
}

export function invalidarUsuarioActivo(id: string): void {
  cache.delete(id);
}

export function vaciarCacheUsuarioActivo(): void {
  cache.clear();
}
