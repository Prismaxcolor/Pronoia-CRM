import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const reproceso = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/services/avisos-pendientes-service.js', () => ({ reprocesarAvisosPendientes: reproceso.fn }));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: router } = await import('../src/routes/avisos.js');
const SECRETO = 'secreto-largo-de-prueba';
let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use('/api/avisos', router);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });
beforeEach(() => {
  process.env.CRON_SECRET = SECRETO;
  reproceso.fn.mockReset().mockResolvedValue({ revisados: 2, enviados: 2, reprogramados: 0, fallidos: 0, omitidos: 0 });
});
afterEach(() => { delete process.env.CRON_SECRET; });

const llamar = (metodo: string, auth?: string) =>
  fetch(`${base}/api/avisos/reprocesar`, { method: metodo, headers: auth ? { Authorization: auth } : {} });

describe('/api/avisos/reprocesar', () => {
  it('401 con secreto incorrecto o ausente y 503 sin CRON_SECRET configurado', async () => {
    expect((await llamar('POST', 'Bearer otro')).status).toBe(401);
    expect((await llamar('POST')).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await llamar('POST', `Bearer ${SECRETO}`)).status).toBe(503);
    expect(reproceso.fn).not.toHaveBeenCalled();
  });
  it('POST y GET (Vercel Cron) con secreto correcto reprocesan', async () => {
    const r = await llamar('POST', `Bearer ${SECRETO}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ resumen: { revisados: 2, enviados: 2, reprogramados: 0, fallidos: 0, omitidos: 0 } });
    expect((await llamar('GET', `Bearer ${SECRETO}`)).status).toBe(200);
  });
  it('405 con otros métodos y 500 genérico si la cola no se puede leer', async () => {
    expect((await llamar('DELETE', `Bearer ${SECRETO}`)).status).toBe(405);
    reproceso.fn.mockRejectedValue(new Error('detalle interno'));
    const r = await llamar('POST', `Bearer ${SECRETO}`);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('detalle interno');
  });
});
