import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const invalidar = vi.hoisted(() => vi.fn());
vi.mock('../src/services/saldos-service.js', () => ({ invalidarCacheSaldos: invalidar }));

const { invalidarSaldosMiddleware } = await import('../src/middlewares/invalidar-saldos.js');

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(invalidarSaldosMiddleware);
  app.all('/x', (_req, res) => { res.status(200).json({ ok: true }); });
  app.all('/falla', (_req, res) => { res.status(400).json({ error: 'x' }); });
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });
beforeEach(() => invalidar.mockReset());

describe('invalidarSaldosMiddleware', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s vacia la cache al terminar la respuesta', async metodo => {
    const r = await fetch(`${base}/x`, { method: metodo });
    await r.text();
    await vi.waitFor(() => expect(invalidar).toHaveBeenCalledTimes(1));
  });

  it('un GET no la vacia', async () => {
    const r = await fetch(`${base}/x`);
    await r.text();
    await new Promise(res => setTimeout(res, 20));
    expect(invalidar).not.toHaveBeenCalled();
  });

  it('una escritura rechazada tambien la vacia (sobrecubre a proposito) y la respuesta no cambia', async () => {
    const r = await fetch(`${base}/falla`, { method: 'POST' });
    expect(r.status).toBe(400);
    await vi.waitFor(() => expect(invalidar).toHaveBeenCalledTimes(1));
  });

  it('si invalidar lanza, la respuesta no se ve afectada', async () => {
    invalidar.mockImplementationOnce(() => { throw new Error('boom'); });
    const r = await fetch(`${base}/x`, { method: 'POST' });
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(invalidar).toHaveBeenCalled());
  });
});
