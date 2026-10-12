import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const db = vi.hoisted(() => ({
  ultima: new Map<string, { fecha: string } | null>(),
  inserts: [] as Array<{ moneda_origen: string }>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      let origen = '';
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: (c: string, v: string) => { if (c === 'moneda_origen') origen = v; return b; },
        maybeSingle: async () => ({ data: db.ultima.get(origen) ?? null, error: null }),
        insert: (fila: { moneda_origen: string }) => {
          db.inserts.push(fila);
          return { select: () => ({ single: async () => ({ data: { id: 'x', ...fila, tasa: 1, fuente: 'BCV', fecha: new Date().toISOString() }, error: null }) }) };
        },
      };
      return b;
    },
  },
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: router } = await import('../src/routes/tasas.js');

const realFetch = globalThis.fetch;
const SECRETO = 'secreto-largo-de-prueba';
let servidor: Server;
let base = '';
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const app = express();
  app.use('/api/tasas', router);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

const llamar = (auth?: string) =>
  realFetch(`${base}/api/tasas/refrescar-oficiales`, { headers: auth ? { Authorization: auth } : {} });

beforeEach(() => {
  db.ultima.clear();
  db.inserts.length = 0;
  process.env.CRON_SECRET = SECRETO;
  fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({ promedio: 36.5 }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.unstubAllGlobals();
});

// `llamar` usa el fetch real (servidor local); el global stubeado solo simula dolarapi.
describe('POST/GET /api/tasas/refrescar-oficiales', () => {
  it('responde 503 si CRON_SECRET no está configurado (falla cerrado)', async () => {
    delete process.env.CRON_SECRET;
    const r = await llamar(`Bearer ${SECRETO}`);
    expect(r.status).toBe(503);
    expect(db.inserts).toHaveLength(0);
  });

  it('responde 401 sin cabecera o con secreto incorrecto', async () => {
    expect((await llamar()).status).toBe(401);
    expect((await llamar('Bearer otro-secreto')).status).toBe(401);
    expect((await llamar(SECRETO)).status).toBe(401);
    expect(db.inserts).toHaveLength(0);
  });

  it('con secreto correcto guarda BCV y Euro', async () => {
    const r = await llamar(`Bearer ${SECRETO}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ resultados: { bcv: 'actualizada', euro: 'actualizada' } });
    expect(db.inserts.map(i => i.moneda_origen).sort()).toEqual(['EUR', 'USD']);
  });

  it('es idempotente: no duplica si ya hay captura posterior al último corte de las 7:00', async () => {
    const reciente = new Date().toISOString();
    db.ultima.set('USD', { fecha: reciente });
    db.ultima.set('EUR', { fecha: reciente });
    const r = await llamar(`Bearer ${SECRETO}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ resultados: { bcv: 'ya_vigente', euro: 'ya_vigente' } });
    expect(db.inserts).toHaveLength(0);
  });

  it('si la fuente cae responde 502 sin filtrar detalles y no guarda nada', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED dolarapi interno'));
    const r = await llamar(`Bearer ${SECRETO}`);
    const texto = await r.text();
    expect(r.status).toBe(502);
    expect(texto).not.toContain('ECONNREFUSED');
    expect(JSON.parse(texto).resultados).toEqual({ bcv: 'error', euro: 'error' });
    expect(db.inserts).toHaveLength(0);
  });
});
