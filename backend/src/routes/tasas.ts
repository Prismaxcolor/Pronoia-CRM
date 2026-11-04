import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { tasaOficialVigente } from '../utils/tasa-vigencia.js';
import { logger } from '../utils/logger.js';
import { exigirCronSecret } from '../middlewares/exigir-cron-secret.js';
import { cronLimiter, tasasPublicasLimiter } from '../middlewares/rate-limit.js';
import { esTasaCreible, UMBRAL_VARIACION_TASA } from '../utils/tasa-cordura.js';

const router = Router();

const HORA_MS = 60 * 60 * 1000;
/** Tope de espera a las APIs externas de tasas (antes no había: una API colgada colgaba la petición). */
const FETCH_TASA_TIMEOUT_MS = 8_000;

/** La tasa nueva varía más del umbral respecto a la última guardada: no se guarda. */
export class TasaFueraDeRangoError extends Error {}

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
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TASA_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`dolarapi respondió ${resp.status}`);
  const data = await resp.json() as DolarApiResponse;
  if (!data.promedio || data.promedio <= 0) throw new Error('tasa inválida desde dolarapi');
  return data.promedio;
}

/** Configuración de cada tasa soportada: de dónde se obtiene, con qué
 *  nombre/par de monedas se guarda en `tasas_cambio`, y cuándo se
 *  refresca contra la API externa (mientras sea vigente, se sirve cacheada). */
const FUENTES = {
  bcv: {
    fuente: 'BCV',
    monedaOrigen: 'USD',
    monedaDestino: 'VES',
    esVigente: tasaOficialVigente,
    fetchTasa: () => fetchDolarApi('https://ve.dolarapi.com/v1/dolares/oficial'),
  },
  euro: {
    fuente: 'BCV',
    monedaOrigen: 'EUR',
    monedaDestino: 'VES',
    esVigente: tasaOficialVigente,
    fetchTasa: () => fetchDolarApi('https://ve.dolarapi.com/v1/euros/oficial'),
  },
  binance: {
    fuente: 'Binance',
    monedaOrigen: 'USD',
    monedaDestino: 'VES',
    // El mercado paralelo se mueve durante el día — cache corto para no
    // quedar muy desactualizado, sin martillar la API externa gratuita.
    esVigente: (capturadaEn: Date, ahora: Date) =>
      ahora.getTime() - capturadaEn.getTime() < HORA_MS / 4,
    fetchTasa: async () => {
      const resp = await fetch('https://www.usdt.com.ve/api/v1/rates/current', {
        signal: AbortSignal.timeout(FETCH_TASA_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`usdt.com.ve respondió ${resp.status}`);
      const data = await resp.json() as UsdtComVeResponse;
      const tasa = data?.data?.binance?.sell_rate;
      if (!tasa || tasa <= 0) throw new Error('tasa inválida desde usdt.com.ve');
      return tasa;
    },
  },
} as const;

type FuenteKey = keyof typeof FUENTES;

type ConfigFuente = (typeof FUENTES)[FuenteKey];

async function buscarUltimaTasa(cfg: ConfigFuente): Promise<TasaRow | null> {
  const { data } = await supabaseAdmin
    .from('tasas_cambio')
    .select('*')
    .eq('moneda_origen', cfg.monedaOrigen)
    .eq('moneda_destino', cfg.monedaDestino)
    .eq('fuente', cfg.fuente)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TasaRow | null) ?? null;
}

/** Consulta la fuente externa y guarda la captura en `tasas_cambio`. Lanza si falla o si la tasa nueva
 *  no es creíble frente a `ultima` (variación mayor a UMBRAL_VARIACION_TASA): en ese caso no se guarda. */
async function capturarYGuardarTasa(cfg: ConfigFuente, ultima: TasaRow | null): Promise<TasaRow> {
  const tasa = await cfg.fetchTasa();
  const referencia = ultima ? { tasa: Number(ultima.tasa), capturadaEn: new Date(ultima.fecha) } : null;
  if (!esTasaCreible(tasa, referencia)) {
    logger.warn({
      evento: 'tasas_rechazada_fuera_de_rango',
      fuente: cfg.fuente,
      par: `${cfg.monedaOrigen}/${cfg.monedaDestino}`,
      nueva: tasa,
      anterior: referencia?.tasa ?? null,
      umbral: UMBRAL_VARIACION_TASA,
    });
    throw new TasaFueraDeRangoError('La tasa recibida varía demasiado respecto a la anterior; se conserva la anterior');
  }
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
  return nueva as TasaRow;
}

/** Busca la última tasa cacheada para una fuente y, si está vencida (o no
 *  existe), la refresca contra la API externa configurada. Si el fetch
 *  externo falla, cae a la última cacheada (marcada `stale`) en vez de
 *  romper la UI. */
async function obtenerTasa(key: FuenteKey) {
  const cfg = FUENTES[key];
  const ultima = await buscarUltimaTasa(cfg);

  if (ultima && cfg.esVigente(new Date(ultima.fecha), new Date())) {
    return { ...mapTasa(ultima), fromCache: true };
  }

  try {
    return { ...mapTasa(await capturarYGuardarTasa(cfg, ultima)), fromCache: false };
  } catch (err) {
    if (ultima) return { ...mapTasa(ultima), fromCache: true, stale: true };
    throw err;
  }
}

export type ResultadoRefresco = 'actualizada' | 'ya_vigente' | 'rechazada' | 'error';

/** Fuerza la captura de una tasa oficial. Idempotente: si ya hay una captura
 *  vigente (posterior al último corte de las 7:00 Caracas) no consulta ni inserta. */
async function refrescarTasaOficial(key: 'bcv' | 'euro', ahora: Date): Promise<ResultadoRefresco> {
  const cfg = FUENTES[key];
  try {
    const ultima = await buscarUltimaTasa(cfg);
    if (ultima && cfg.esVigente(new Date(ultima.fecha), ahora)) return 'ya_vigente';
    await capturarYGuardarTasa(cfg, ultima);
    return 'actualizada';
  } catch (err) {
    if (err instanceof TasaFueraDeRangoError) return 'rechazada';
    logger.error({ evento: 'tasas_refresco_error', tasa: key, mensaje: err instanceof Error ? err.message : 'desconocido' });
    return 'error';
  }
}

/** Refresca BCV y Euro (cada una por separado: si una falla la otra se guarda igual). */
export async function refrescarTasasOficiales(ahora: Date = new Date()): Promise<Record<'bcv' | 'euro', ResultadoRefresco>> {
  const [bcv, euro] = await Promise.all([refrescarTasaOficial('bcv', ahora), refrescarTasaOficial('euro', ahora)]);
  return { bcv, euro };
}

function registrarRutaTasa(path: string, key: FuenteKey) {
  router.get(path, tasasPublicasLimiter, async (_req, res) => {
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

/** GET /api/tasas/oficial — tasa USD→VES BCV (se actualiza a las 7:00 AM Caracas) */
registrarRutaTasa('/oficial', 'bcv');
/** GET /api/tasas/euro — tasa EUR→VES BCV (se actualiza a las 7:00 AM Caracas) */
registrarRutaTasa('/euro', 'euro');
/** GET /api/tasas/binance — tasa USD→VES Binance P2P, precio de venta (refresca cada 15min) */
registrarRutaTasa('/binance', 'binance');

/** GET|POST /api/tasas/refrescar-oficiales — captura programada de BCV y Euro (Vercel Cron, 11:00 UTC = 7:00 Caracas).
 *  Sin sesión de usuario: protegida por CRON_SECRET (Authorization: Bearer). */
router.all('/refrescar-oficiales', cronLimiter, exigirCronSecret, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  const resultados = await refrescarTasasOficiales();
  const fallo = Object.values(resultados).some(r => r === 'error' || r === 'rechazada');
  res.status(fallo ? 502 : 200).json(fallo
    ? { error: 'No se pudo actualizar alguna tasa oficial', resultados }
    : { resultados });
});

/** GET /api/tasas/historial?fuenteKey=bcv|euro|binance&limit=30 */
router.get('/historial', tasasPublicasLimiter, async (req, res) => {
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
