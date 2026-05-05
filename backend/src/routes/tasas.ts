import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

const DOLARAPI_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';
const CACHE_MS = 24 * 60 * 60 * 1000;

interface DolarApiResponse {
  fuente: string;
  nombre: string;
  promedio: number;
  fechaActualizacion: string;
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

/** GET /api/tasas/oficial — devuelve la tasa USD→VES BCV; refresca si pasaron 24h */
router.get('/oficial', async (_req, res) => {
  const { data: ultima } = await supabaseAdmin
    .from('tasas_cambio')
    .select('*')
    .eq('moneda_origen', 'USD')
    .eq('moneda_destino', 'VES')
    .eq('fuente', 'BCV')
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultima) {
    const edad = Date.now() - new Date(ultima.fecha).getTime();
    if (edad < CACHE_MS) {
      res.json({ ...mapTasa(ultima as TasaRow), fromCache: true });
      return;
    }
  }

  try {
    const resp = await fetch(DOLARAPI_URL);
    if (!resp.ok) throw new Error(`dolarapi respondió ${resp.status}`);

    const data = await resp.json() as DolarApiResponse;
    const tasa = data.promedio;
    if (!tasa || tasa <= 0) throw new Error('tasa inválida desde dolarapi');

    const { data: nueva, error } = await supabaseAdmin
      .from('tasas_cambio')
      .insert({
        moneda_origen: 'USD',
        moneda_destino: 'VES',
        tasa,
        fuente: 'BCV',
      })
      .select()
      .single();

    if (error || !nueva) throw new Error(error?.message ?? 'Error al insertar tasa');

    res.json({ ...mapTasa(nueva as TasaRow), fromCache: false });
  } catch (err) {
    if (ultima) {
      res.json({ ...mapTasa(ultima as TasaRow), fromCache: true, stale: true });
      return;
    }
    res.status(503).json({
      error: 'No se pudo obtener tasa de cambio',
      detalle: err instanceof Error ? err.message : 'Error desconocido',
    });
  }
});

/** GET /api/tasas/historial?limit=30 — últimas N tasas BCV USD→VES */
router.get('/historial', async (req, res) => {
  const limite = Math.min(parseInt(req.query.limit as string) || 30, 200);

  const { data, error } = await supabaseAdmin
    .from('tasas_cambio')
    .select('*')
    .eq('moneda_origen', 'USD')
    .eq('moneda_destino', 'VES')
    .eq('fuente', 'BCV')
    .order('fecha', { ascending: false })
    .limit(limite);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json((data ?? []).map(row => mapTasa(row as TasaRow)));
});

export default router;
