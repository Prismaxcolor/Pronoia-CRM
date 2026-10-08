/** Detección de versión nueva INDEPENDIENTE del service worker.
 *
 *  La PWA instalada casi nunca navega, así que el navegador no revisa si hay un
 *  service worker nuevo. Aquí se consulta `/version.json` (nunca cacheado) y se
 *  compara con la versión compilada dentro de la app que está corriendo.
 *
 *  Regla de `minima` (simple y estable): es una FECHA (ISO o AAAA-MM-DD). Si la
 *  compilación que corre se hizo ANTES de esa fecha, la actualización es
 *  obligatoria. Un valor que no sea fecha válida se ignora (nunca bloquea). */

export interface InfoVersion {
  version: string;
  compiladoEn: string;
  minima?: string;
  notas?: string[];
}

export type EstadoVersion = 'al-dia' | 'hay-nueva' | 'obligatoria';

export const MAX_LINEAS_NOTAS = 3;
export const TIMEOUT_VERSION_MS = 8000;
/** Compilación de desarrollo (vite dev): nunca se compara. */
export const VERSION_DESARROLLO = 'dev';

export const TEXTOS_ACTUALIZACION = {
  titulo: '¡Hay una versión nueva de Pronoia!',
  actualizar: 'Actualizar ahora',
  masTarde: 'Más tarde',
  actualizando: 'Actualizando…',
  tranquilidad: 'Tus datos y pendientes están a salvo',
  esperaEnvio: 'Termina lo que estás enviando; actualizaremos enseguida',
  esperandoEnvio: 'Esperando a que termine el envío…',
  guardando: 'Guardando tu trabajo…',
  guardadoComoBorrador: 'Tu trabajo quedó guardado como borrador; te devolveremos aquí',
  noPudimosGuardar: 'No pudimos guardar tu trabajo; termina y guárdalo antes de actualizar',
  recuperamosBorrador: 'Recuperamos tu borrador',
  yaTienesUltima: 'Ya tienes la última versión ✓',
  seActualizo: 'Pronoia se actualizó ✓',
  sinRed: 'Sin conexión: no se pudo buscar',
  fallo: 'No se pudo actualizar. Cierra la app desde recientes y ábrela de nuevo.',
} as const;

function aMs(fecha: string | undefined): number | null {
  if (!fecha) return null;
  const t = Date.parse(fecha);
  return Number.isNaN(t) ? null : t;
}

/** Valida el JSON recibido; devuelve null si no tiene la forma esperada. */
export function parsearVersionRemota(crudo: unknown): InfoVersion | null {
  if (!crudo || typeof crudo !== 'object') return null;
  const { version, compiladoEn, minima, notas } = crudo as Record<string, unknown>;
  if (typeof version !== 'string' || !version) return null;
  if (typeof compiladoEn !== 'string' || aMs(compiladoEn) === null) return null;
  const notasOk = Array.isArray(notas)
    ? notas.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    : [];
  return {
    version,
    compiladoEn,
    ...(typeof minima === 'string' && minima ? { minima } : {}),
    ...(notasOk.length > 0 ? { notas: notasOk } : {}),
  };
}

/** Compara la compilación que corre con la remota. */
export function evaluarVersion(
  actual: { version: string; compiladoEn: string },
  remota: InfoVersion | null,
): EstadoVersion {
  if (!remota || actual.version === VERSION_DESARROLLO) return 'al-dia';
  if (actual.version === remota.version) return 'al-dia';
  const minimaMs = aMs(remota.minima);
  const actualMs = aMs(actual.compiladoEn);
  if (minimaMs !== null && actualMs !== null && actualMs < minimaMs) return 'obligatoria';
  return 'hay-nueva';
}

/** Máximo 3 notas, sin vacíos. */
export function notasVisibles(notas: readonly string[] | undefined, max = MAX_LINEAS_NOTAS): string[] {
  return (notas ?? []).map(n => n.trim()).filter(Boolean).slice(0, max);
}

/** 'v 07/10/2026 · 03b28c4' (fecha en hora local del dispositivo). */
export function formatearVersion(version: string, compiladoEn: string): string {
  const t = aMs(compiladoEn);
  if (version === VERSION_DESARROLLO || t === null) return `v ${version}`;
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `v ${dd}/${mm}/${d.getFullYear()} · ${version}`;
}

export interface DepsConsulta {
  fetch: (url: string, init: { cache: 'no-store'; signal: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  timeoutMs?: number;
}

/** Pide /version.json; null ante cualquier fallo (sin red, timeout, 404, HTML de respaldo). Nunca lanza. */
export async function consultarVersionRemota(deps: DepsConsulta): Promise<InfoVersion | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), deps.timeoutMs ?? TIMEOUT_VERSION_MS);
  try {
    const res = await deps.fetch('/version.json', { cache: 'no-store', signal: control.signal });
    if (!res.ok) return null;
    return parsearVersionRemota(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/** Una vez por versión: mostrar 'Pronoia se actualizó ✓' si ya había una vista distinta. */
export function debeMostrarSeActualizo(vista: string | null, actual: string): boolean {
  return vista !== null && vista !== actual && actual !== VERSION_DESARROLLO;
}
