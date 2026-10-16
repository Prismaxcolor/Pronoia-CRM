import { obtenerSecreto } from '../config/secretos.js';

/** Clave en configuracion_secreta que enciende o apaga el modo sin conexión.
 *  Valores: 'todos' | 'ninguno' (también si falta: arranca apagado) | lista de ids de usuario separados por coma. */
export const CLAVE_OFFLINE_ACTIVO = 'OFFLINE_ACTIVO';

export type LectorOffline = (clave: string) => Promise<string | undefined>;

/** Decide si el modo sin conexión está activo para un usuario. Lógica pura.
 *  - 'todos' → activo para todos; sin valor → apagado (despliegue gradual: se enciende usuario por usuario)
 *  - 'ninguno' (también 'false', '0', 'no', 'off') → apagado para todos
 *  - cualquier otro texto se interpreta como lista de ids (coma, punto y coma o espacio). */
export function resolverOfflineActivo(valor: string | undefined | null, usuarioId: string): boolean {
  const texto = (valor ?? '').trim().toLowerCase();
  if (texto === 'todos') return true;
  if (texto === '') return false;
  if (['ninguno', 'false', '0', 'no', 'off'].includes(texto)) return false;
  const ids = texto.split(/[\s,;]+/).filter(Boolean);
  return ids.includes(usuarioId.trim().toLowerCase());
}

export interface OfflineConfig {
  activo: boolean;
  /** Hora del servidor (ms epoch): permite al cliente detectar un reloj desfasado. */
  ahoraServidor: number;
}

export async function obtenerOfflineConfig(
  usuarioId: string,
  leer: LectorOffline = obtenerSecreto,
  ahora: () => number = Date.now,
): Promise<OfflineConfig> {
  const valor = await leer(CLAVE_OFFLINE_ACTIVO);
  return { activo: resolverOfflineActivo(valor, usuarioId), ahoraServidor: ahora() };
}
