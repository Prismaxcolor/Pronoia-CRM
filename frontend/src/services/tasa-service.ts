import { obtenerCatalogo } from '../lib/offline/catalogos';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
/** Una tasa de cambio envejece rápido: pasadas 12 h se avisa como obsoleta. */
const MAX_EDAD_TASA_MS = 12 * 60 * 60 * 1000;

export interface TasaOficial {
  id: string;
  monedaOrigen: string;
  monedaDestino: string;
  tasa: number;
  fuente: string;
  fecha: string;
  fromCache?: boolean;
  stale?: boolean;
}

export type FuenteTasaKey = 'bcv' | 'euro' | 'binance';

const RUTA_POR_FUENTE: Record<FuenteTasaKey, string> = {
  bcv: 'oficial',
  euro: 'euro',
  binance: 'binance',
};

export async function obtenerTasa(fuenteKey: FuenteTasaKey): Promise<TasaOficial | null> {
  try {
    const { datos, origen, obsoleto } = await obtenerCatalogo(
      `tasa:${fuenteKey}`,
      async () => {
        const resp = await fetch(`${API_URL}/api/tasas/${RUTA_POR_FUENTE[fuenteKey]}`);
        // Error HTTP: se lanza para NO guardar en caché una respuesta de error;
        // el catch de abajo lo convierte en null como siempre.
        if (!resp.ok) throw Object.assign(new Error(`Tasa no disponible (${resp.status})`), { status: resp.status });
        return (await resp.json()) as TasaOficial;
      },
      { maxEdadMs: MAX_EDAD_TASA_MS },
    );
    // Una tasa guardada se marca como tal: el widget ya sabe mostrar fromCache/stale.
    return origen === 'cache' ? { ...datos, fromCache: true, stale: obsoleto } : datos;
  } catch {
    return null;
  }
}

/** Tasa BCV USD→VES. Se mantiene por compatibilidad con quienes ya la usan
 *  (ej. conversión a bolívares al pagar) — equivale a obtenerTasa('bcv'). */
export async function obtenerTasaOficial(): Promise<TasaOficial | null> {
  return obtenerTasa('bcv');
}

export async function obtenerHistorialTasa(fuenteKey: FuenteTasaKey = 'bcv', limit = 30): Promise<TasaOficial[]> {
  try {
    const resp = await fetch(`${API_URL}/api/tasas/historial?fuenteKey=${fuenteKey}&limit=${limit}`);
    if (!resp.ok) return [];
    return await resp.json();
  } catch {
    return [];
  }
}

/** Historial BCV. Se mantiene por compatibilidad — equivale a
 *  obtenerHistorialTasa('bcv', limit). */
export async function obtenerHistorialTasas(limit = 30): Promise<TasaOficial[]> {
  return obtenerHistorialTasa('bcv', limit);
}
