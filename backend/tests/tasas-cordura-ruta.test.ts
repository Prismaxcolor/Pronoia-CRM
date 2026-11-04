import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const db = vi.hoisted(() => ({
  ultima: null as { tasa: number; fecha: string } | null,
  inserts: [] as Array<{ tasa: number }>,
}));
const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: db.ultima ? { id: 'u', moneda_origen: 'USD', moneda_destino: 'VES', fuente: 'BCV', ...db.ultima } : null, error: null }),
        insert: (fila: { tasa: number }) => {
          db.inserts.push(fila);
          return { select: () => ({ single: async () => ({ data: { id: 'n', moneda_origen: 'USD', moneda_destino: 'VES', fuente: 'BCV', fecha: new Date().toISOString(), ...fila }, error: null }) }) };
        },
      };
      return b;
    },
  },
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: log.warn, error: log.error },
  clienteIp: () => '127.0.0.1',
}));

const { default: router } = await import('../src/routes/tasas.js');

const realFetch = globalThis.fetch;
const DIAS_MS = 24 * 60 * 60 * 1000;
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

const apiRespondePromedio = (promedio: number) => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ promedio }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => {
  db.ultima = { tasa: 36.5, fecha: new Date(Date.now() - 3 * DIAS_MS).toISOString() };
  db.inserts.length = 0;
  log.warn.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('GET /api/tasas/oficial con validación de rango', () => {
  it('rechaza una tasa que salta más del 30 %: devuelve la anterior (stale), no inserta y avisa', async () => {
    apiRespondePromedio(3650);
    const r = await realFetch(`${base}/api/tasas/oficial`);
    const cuerpo = await r.json() as { tasa: number; stale?: boolean };
    expect(r.status).toBe(200);
    expect(cuerpo).toMatchObject({ tasa: 36.5, stale: true });
    expect(db.inserts).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ evento: 'tasas_rechazada_fuera_de_rango', nueva: 3650, anterior: 36.5 }));
  });

  it('guarda una tasa dentro del umbral', async () => {
    apiRespondePromedio(37.2);
    const r = await realFetch(`${base}/api/tasas/oficial`);
    expect(r.status).toBe(200);
    expect(db.inserts.map(i => i.tasa)).toEqual([37.2]);
  });

  it('envía un timeout a la API externa', async () => {
    apiRespondePromedio(37);
    await realFetch(`${base}/api/tasas/oficial`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('con 60 consultas por minuto desde la misma IP, la siguiente recibe 429', async () => {
    db.ultima = { tasa: 36.5, fecha: new Date().toISOString() }; // vigente: sin fetch externo
    let ultimo = 200;
    for (let i = 0; i < 61; i++) ultimo = (await realFetch(`${base}/api/tasas/historial?fuenteKey=bcv`)).status;
    expect(ultimo).toBe(429);
  });
});
