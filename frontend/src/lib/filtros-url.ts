/** Estado de filtros <-> URL (lógica pura, sin React). El hook `useFiltrosUrl` (hooks/use-filtros-url.ts) la usa con
 *  react-router. Cada pantalla declara un esquema; solo se leen/escriben las claves del esquema y los valores inválidos
 *  se descartan en silencio (una URL pegada a mano nunca rompe la pantalla). Las demás claves de la URL se conservan. */

import { esFechaIso } from './formato';

export type DefCampoFiltro =
  | { tipo: 'texto' }
  | { tipo: 'fecha' }
  /** Solo valores de la lista. */
  | { tipo: 'opcion'; opciones: readonly string[] }
  /** Casilla: en la URL es "1"; el valor es true. */
  | { tipo: 'bandera' };

export interface EsquemaFiltros {
  campos: Readonly<Record<string, DefCampoFiltro>>;
  /** Pares [desde, hasta] que deben venir juntos y en orden; si no, se descartan los dos (como en inventario). */
  rangos?: ReadonlyArray<readonly [string, string]>;
}

export type ValoresFiltros = Record<string, string | boolean | undefined>;

function leerCampo(params: URLSearchParams, clave: string, def: DefCampoFiltro): string | boolean | undefined {
  const bruto = params.get(clave);
  if (bruto === null) return undefined;
  switch (def.tipo) {
    case 'texto': {
      const v = bruto.trim();
      return v ? v : undefined;
    }
    case 'fecha':
      return esFechaIso(bruto) ? bruto : undefined;
    case 'opcion':
      return def.opciones.includes(bruto) ? bruto : undefined;
    case 'bandera':
      return bruto === '1' ? true : undefined;
  }
}

/** Aplica la regla de rangos: sin los dos extremos o con desde > hasta, se descartan ambos. */
function normalizarRangos(valores: ValoresFiltros, rangos: EsquemaFiltros['rangos']): ValoresFiltros {
  if (!rangos) return valores;
  const salida = { ...valores };
  for (const [d, h] of rangos) {
    const desde = salida[d];
    const hasta = salida[h];
    if (typeof desde !== 'string' || typeof hasta !== 'string' || desde > hasta) {
      delete salida[d];
      delete salida[h];
    }
  }
  return salida;
}

/** Lee los filtros válidos de la URL según el esquema. Las claves sin valor válido no aparecen en el resultado. */
export function leerFiltros(params: URLSearchParams, esquema: EsquemaFiltros): ValoresFiltros {
  const valores: ValoresFiltros = {};
  for (const [clave, def] of Object.entries(esquema.campos)) {
    const v = leerCampo(params, clave, def);
    if (v !== undefined) valores[clave] = v;
  }
  return normalizarRangos(valores, esquema.rangos);
}

/** Aplica cambios sobre los parámetros actuales y devuelve unos NUEVOS. Un cambio `undefined`, '' o false borra la
 *  clave. Las claves fuera del esquema (otra pestaña, otro módulo) se conservan. Orden de claves estable. */
export function escribirFiltros(actual: URLSearchParams, esquema: EsquemaFiltros, cambios: ValoresFiltros): URLSearchParams {
  const combinados: ValoresFiltros = { ...leerFiltros(actual, esquema) };
  for (const [clave, v] of Object.entries(cambios)) {
    if (!(clave in esquema.campos)) continue;
    if (v === undefined || v === '' || v === false) delete combinados[clave];
    else combinados[clave] = v;
  }
  const validos = normalizarRangos(combinados, esquema.rangos);
  const salida = new URLSearchParams();
  for (const [clave, valor] of actual.entries()) {
    if (!(clave in esquema.campos)) salida.append(clave, valor);
  }
  for (const clave of Object.keys(esquema.campos)) {
    const v = validos[clave];
    if (v === undefined) continue;
    const def = esquema.campos[clave];
    const texto = def.tipo === 'bandera' ? (v ? '1' : undefined) : typeof v === 'string' ? v : undefined;
    if (texto && leerCampo(new URLSearchParams({ [clave]: texto }), clave, def) !== undefined) salida.set(clave, texto);
  }
  return salida;
}

/** Quita todos los filtros del esquema (conserva el resto de la URL). */
export function limpiarFiltros(actual: URLSearchParams, esquema: EsquemaFiltros): URLSearchParams {
  const cambios: ValoresFiltros = {};
  for (const clave of Object.keys(esquema.campos)) cambios[clave] = undefined;
  return escribirFiltros(actual, esquema, cambios);
}

/** Cuántos filtros del esquema están activos (para el contador de "Más filtros"). */
export function contarFiltrosActivos(valores: ValoresFiltros, claves?: readonly string[]): number {
  const lista = claves ?? Object.keys(valores);
  return lista.filter(c => valores[c] !== undefined && valores[c] !== false).length;
}
