import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

const HORA_MS = 60 * 60 * 1000;

interface DolarApiResponse {
  fuente: string;
  nombre: string;
  promedio: number;
  fechaActualizacion: string;
}

interface UsdtComVeResponse {
  success: boolean;
  data: {
    binance: { buy_rate: number; sell_rate: number };
  };
}

interface TasaRow {
  id: string;
  moneda_origen: string;
  moneda_destino: string;
  tasa: number;
  fuente: string;
  fecha: string;
}

function mapTasa(row: TasaRow) {
  return {
    id: row.id,
    monedaOrigen: row.moneda_origen,
    monedaDestino: row.moneda_destino,
    tasa: Number(row.tasa),
    fuente: row.fuente,
    fecha: row.fecha,
  };
}

async function fetchDolarApi(url: string): Promise<number> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`dolarapi respondió ${resp.status}`);
  const data = await resp.json() as DolarApiResponse;
  if (!data.promedio || data.promedio <= 0) throw new Error('tasa inválida desde dolarapi');
  return data.promedio;
}

/** Configuración de cada tasa soportada: de dónde se obtiene, con qué
 *  nombre/par de monedas se guarda en `tasas_cambio`, y cada cuánto se
 *  refresca contra la API externa (fuera de ese tiempo, se sirve cacheada). */
const FUENTES = {
  bcv: {
    fuente: 'BCV',
    monedaOrigen: 'USD',
    monedaDestino: 'VES',
    cacheMs: 24 * HORA_MS,
    fetchTasa: () => fetchDolarApi('https://ve.dolarapi.com/v1/dolares/oficial'),
  },
  euro: {
    fuente: 'BCV',
    monedaOrigen: 'EUR',
    monedaDestino: 'VES',
    cacheMs: 24 * HORA_MS,
    fetchTasa: () => fetchDolarApi('https://ve.dolarapi.com/v1/euros/oficial'),
  },
  binance: {
    fuente: 'Binance',
    monedaOrigen: 'USD',
    monedaDestino: 'VES',
    // El mercado paralelo se mueve durante el día — cache corto para no
    // quedar muy desactualizado, sin martillar la API externa gratuita.
    cacheMs: HORA_MS / 4,
    fetchTasa: async () => {
      const resp = await fetch('https://www.usdt.com.ve/api/v1/rates/current');
      if (!resp.ok) throw new Error(`usdt.com.ve respondió ${resp.status}`);
      const data = await resp.json() as UsdtComVeResponse;
      const tasa = data?.data?.binance?.sell_rate;
      if (!tasa || tasa <= 0) throw new Error('tasa inválida desde usdt.com.ve');
      return tasa;
    },
  },
} as const;

type FuenteKey = keyof typeof FUENTES;

/** Busca la última tasa cacheada para una fuente y, si está vencida (o no
 *  existe), la refresca contra la API externa configurada. Si el fetch
 *  externo falla, cae a la última cacheada (marcada `stale`) en vez de
 *  romper la UI. */
async function obtenerTasa(key: FuenteKey) {
  const cfg = FUENTES[key];

  const { data: ultima } = await supabaseAdmin
    .from('tasas_cambio')
    .select('*')
    .eq('moneda_origen', cfg.monedaOrigen)
    .eq('moneda_destino', cfg.monedaDestino)
    .eq('fuente', cfg.fuente)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultima) {
    const edad = Date.now() - new Date(ultima.fecha).getTime();
    if (edad < cfg.cacheMs) {
      return { ...mapTasa(ultima as TasaRow), fromCache: true };
    }
  }

  try {
    const tasa = await cfg.fetchTasa();

    const { data: nueva, error } = await supabaseAdmin
      .from('tasas_cambio')
      .insert({
        moneda_origen: cfg.monedaOrigen,
        moneda_destino: cfg.monedaDestino,
        tasa,
        fuente: cfg.fuente,
      })
      .select()
      .single();

    if (error || !nueva) throw new Error(error?.message ?? 'Error al insertar tasa');

    return { ...mapTasa(nueva as TasaRow), fromCache: false };
  } catch (err) {
    if (ultima) {
      return { ...mapTasa(ultima as TasaRow), fromCache: true, stale: true };
    }
    throw err;
  }
}

function registrarRutaTasa(path: string, key: FuenteKey) {
  router.get(path, async (_req, res) => {
    try {
      res.json(await obtenerTasa(key));
    } catch (err) {
      res.status(503).json({
        error: 'No se pudo obtener tasa de cambio',
        detalle: err instanceof Error ? err.message : 'Error desconocido',
      });
    }
  });
}

/** GET /api/tasas/oficial — tasa USD→VES BCV (refresca cada 24h) */
registrarRutaTasa('/oficial', 'bcv');
/** GET /api/tasas/euro — tasa EUR→VES BCV (refresca cada 24h) */
registrarRutaTasa('/euro', 'euro');
/** GET /api/tasas/binance — tasa USD→VES Binance P2P, precio de venta (refresca cada 15min) */
registrarRutaTasa('/binance', 'binance');

/** GET /api/tasas/historial?fuenteKey=bcv|euro|binance&limit=30 */
router.get('/historial', async (req, res) => {
  const limite = Math.min(parseInt(req.query.limit as string) || 30, 200);
  const fuenteKey = (req.query.fuenteKey as string) || 'bcv';
  const cfg = FUENTES[fuenteKey as FuenteKey];

  if (!cfg) {
    res.status(400).json({ error: `fuenteKey inválida: ${fuenteKey}` });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('tasas_cambio')
    .select('*')
    .eq('moneda_origen', cfg.monedaOrigen)
    .eq('moneda_destino', cfg.monedaDestino)
    .eq('fuente', cfg.fuente)
    .order('fecha', { ascending: false })
    .limit(limite);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json((data ?? []).map(row => mapTasa(row as TasaRow)));
});

export default router;
