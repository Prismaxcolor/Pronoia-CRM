/** Recuerda, por sección del sidebar (ej. "/pesaje"), la última ruta de detalle
 *  visitada dentro de esa sección (ej. "/pesaje/0359b2d8-..."), para que al volver
 *  a esa sección desde el menú el usuario vuelva donde se quedó en vez de a la
 *  lista. Vive en sessionStorage: por pestaña, se pierde al cerrarla. */
const STORAGE_KEY = 'pronoia:ultima-ruta';

export function leerUltimasRutas(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function guardarUltimaRuta(base: string, ruta: string): void {
  try {
    const actuales = leerUltimasRutas();
    if (actuales[base] === ruta) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...actuales, [base]: ruta }));
  } catch {
    // sessionStorage puede fallar (modo privado, cuota) — no crítico, solo se pierde la memoria de navegación.
  }
}

export function limpiarUltimasRutas(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // no crítico
  }
}
