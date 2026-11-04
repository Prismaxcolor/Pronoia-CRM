/**
 * Validación de URLs de comprobantes: solo imágenes que este mismo sistema subió al bucket
 * público "comprobantes" de Supabase (POST /api/uploads/comprobantes). El body lo controla el
 * cliente y Telegram descarga la URL desde sus servidores, así que no se acepta cualquier https.
 * Solo valida entrada nueva: los comprobantes ya guardados se leen sin pasar por aquí.
 */

/** Secuencias que permiten salirse del prefijo o esconder la ruta real. */
const SECUENCIAS_PROHIBIDAS = /\.\.|%2e|%2f|%5c|[?#\\]/i;

function aUrl(valor: string): URL | null {
  try {
    return new URL(valor);
  } catch {
    return null;
  }
}

/**
 * ¿`valor` es una URL https exacta de un archivo del bucket público `bucket`?
 * Exige el mismo host (y puerto) que `supabaseUrl` y el prefijo exacto del bucket. Sin `supabaseUrl`
 * (entorno sin configurar) NO acepta nada: no hay host contra el cual comparar y aceptar cualquier https
 * permitiría que Telegram descargue una URL arbitraria.
 */
export function esUrlDeBucketValida(valor: unknown, supabaseUrl: string, bucket: string): boolean {
  if (!supabaseUrl || typeof valor !== 'string' || SECUENCIAS_PROHIBIDAS.test(valor)) return false;
  const url = aUrl(valor);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;

  const rutaBucket = `/storage/v1/object/public/${bucket}/`;
  const base = aUrl(supabaseUrl);
  if (!base || url.host !== base.host) return false;
  const prefijoRuta = `${base.pathname.replace(/\/+$/, '')}${rutaBucket}`;
  return url.pathname.startsWith(prefijoRuta) && url.pathname.length > prefijoRuta.length;
}

/** ¿`valor` es una URL de un archivo del bucket de comprobantes? */
export function esUrlComprobanteValida(valor: unknown, supabaseUrl: string): boolean {
  return esUrlDeBucketValida(valor, supabaseUrl, 'comprobantes');
}
