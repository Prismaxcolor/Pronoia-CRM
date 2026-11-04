/** Edición genérica del contenido de una operación rechazada: lista los valores simples (texto y números)
 *  que tiene sentido corregir (pesos, observaciones, vehículo, fecha...) y los cambia sin mutar el original.
 *  Los ids, las URLs y las referencias a fotos no se ofrecen para editar. */

export type RutaCampo = ReadonlyArray<string | number>;

export interface CampoEditable {
  ruta: RutaCampo;
  etiqueta: string;
  valor: string | number;
  tipo: 'texto' | 'numero';
}

const CLAVES_OCULTAS = new Set(['clientRequestId', 'capturadoEn']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esEditable(clave: string, valor: unknown): valor is string | number {
  if (CLAVES_OCULTAS.has(clave) || /(^|[a-z])Ids?$/.test(clave) || clave === 'id') return false;
  if (typeof valor === 'number') return true;
  return typeof valor === 'string' && !UUID.test(valor) && !/^(https?:|local:)/.test(valor);
}

function etiquetaDe(ruta: RutaCampo): string {
  return ruta.map((p, i) => (typeof p === 'number' ? `n.º ${p + 1}` : i === 0 ? p : `· ${p}`)).join(' ');
}

export function camposEditables(payload: unknown, ruta: RutaCampo = []): CampoEditable[] {
  if (Array.isArray(payload)) return payload.flatMap((v, i) => camposEditables(v, [...ruta, i]));
  if (payload && typeof payload === 'object') {
    return Object.entries(payload).flatMap(([clave, valor]) => {
      const sub = [...ruta, clave];
      if (valor && typeof valor === 'object') return camposEditables(valor, sub);
      return esEditable(clave, valor)
        ? [{ ruta: sub, etiqueta: etiquetaDe(sub), valor, tipo: typeof valor === 'number' ? ('numero' as const) : ('texto' as const) }]
        : [];
    });
  }
  return [];
}

/** Copia del payload con `valor` puesto en `ruta`. */
export function aplicarCampo(payload: unknown, ruta: RutaCampo, valor: string | number): unknown {
  if (ruta.length === 0) return valor;
  const [cabeza, ...resto] = ruta;
  if (Array.isArray(payload)) {
    return payload.map((v, i) => (i === cabeza ? aplicarCampo(v, resto, valor) : v));
  }
  const obj = (payload ?? {}) as Record<string, unknown>;
  return { ...obj, [cabeza]: aplicarCampo(obj[cabeza as string], resto, valor) };
}
