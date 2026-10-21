/** Construcción pura del `version.json` que se publica junto a cada compilación.
 *  Lo usa el plugin de Vite (vite.config.ts) y los tests. Sin dependencias de DOM ni de Node. */

export interface Novedades {
  minima: string;
  notas: string[];
}

export interface VersionJson {
  version: string;
  compiladoEn: string;
  minima?: string;
  notas?: string[];
}

/** Lee `novedades.json` (texto) tolerando archivo ausente, vacío o mal formado. */
export function leerNovedades(texto: string | null): Novedades {
  const vacio: Novedades = { minima: '', notas: [] };
  if (!texto) return vacio;
  try {
    const crudo: unknown = JSON.parse(texto);
    if (!crudo || typeof crudo !== 'object') return vacio;
    const { minima, notas } = crudo as { minima?: unknown; notas?: unknown };
    return {
      minima: typeof minima === 'string' ? minima.trim() : '',
      notas: Array.isArray(notas)
        ? notas.filter((n): n is string => typeof n === 'string').map(n => n.trim()).filter(Boolean)
        : [],
    };
  } catch {
    return vacio;
  }
}

/** Arma el contenido de version.json; `minima` y `notas` se omiten si están vacías. */
export function construirVersionJson(version: string, compiladoEn: string, novedades: Novedades): VersionJson {
  return {
    version,
    compiladoEn,
    ...(novedades.minima ? { minima: novedades.minima } : {}),
    ...(novedades.notas.length > 0 ? { notas: novedades.notas } : {}),
  };
}
