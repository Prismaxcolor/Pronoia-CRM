const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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

export async function obtenerTasaOficial(): Promise<TasaOficial | null> {
  try {
    const resp = await fetch(`${API_URL}/api/tasas/oficial`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function obtenerHistorialTasas(limit = 30): Promise<TasaOficial[]> {
  try {
    const resp = await fetch(`${API_URL}/api/tasas/historial?limit=${limit}`);
    if (!resp.ok) return [];
    return await resp.json();
  } catch {
    return [];
  }
}
