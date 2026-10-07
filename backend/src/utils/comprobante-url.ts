/**
 * Validación de URLs de comprobantes: solo imágenes que este mismo sistema subió al bucket
 * público "comprobantes" de Supabase (POST /api/uploads/comprobantes). El body lo controla el
 * cliente y Telegram descarga la URL desde sus servidores, así que no se acepta cualquier https.
 * Solo valida entrada nueva: los comprobantes ya guardados se leen sin pasar por aquí.
 */

const RUTA_BUCKET = '/storage/v1/object/public/comprobantes/';
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
 * ¿`valor` es una URL https exacta de un archivo del bucket de comprobantes?
 * Con `supabaseUrl` exige el mismo host (y puerto) y el prefijo exacto del bucket; sin él
 * (entorno sin configurar) exige solo https y la ruta del bucket.
 */
export function esUrlComprobanteValida(valor: unknown, supabaseUrl: string): boolean {
  if (typeof valor !== 'string' || SECUENCIAS_PROHIBIDAS.test(valor)) return false;
  const url = aUrl(valor);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;

  let prefijoRuta = RUTA_BUCKET;
  if (supabaseUrl) {
    const base = aUrl(supabaseUrl);
    if (!base || url.host !== base.host) return false;
    prefijoRuta = `${base.pathname.replace(/\/+$/, '')}${RUTA_BUCKET}`;
  }
  return url.pathname.startsWith(prefijoRuta) && url.pathname.length > prefijoRuta.length;
}
