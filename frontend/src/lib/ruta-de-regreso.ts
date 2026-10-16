const CLAVE = 'pronoia:ruta-de-regreso';
/** Solo se recuerdan destinos que llegan por enlace externo (p. ej. el botón de Telegram). */
const PREFIJOS_RECORDABLES = ['/aprobar-llave/'];

/** Guarda la ruta a la que volver tras iniciar sesión (solo rutas permitidas, nunca URLs externas). */
export function recordarRutaDeRegreso(ruta: string): void {
  if (!PREFIJOS_RECORDABLES.some(p => ruta.startsWith(p))) return;
  try { sessionStorage.setItem(CLAVE, ruta); } catch { /* sin sessionStorage: se vuelve al inicio */ }
}

/** Devuelve y borra la ruta guardada (null si no hay). */
export function consumirRutaDeRegreso(): string | null {
  try {
    const ruta = sessionStorage.getItem(CLAVE);
    sessionStorage.removeItem(CLAVE);
    return ruta && PREFIJOS_RECORDABLES.some(p => ruta.startsWith(p)) ? ruta : null;
  } catch {
    return null;
  }
}
