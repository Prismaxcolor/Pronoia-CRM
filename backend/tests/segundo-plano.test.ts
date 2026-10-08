import { describe, it, expect, vi, beforeEach } from 'vitest';

const waitUntil = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', () => ({ waitUntil }));

import { ejecutarEnSegundoPlano } from '../src/utils/segundo-plano.js';

beforeEach(() => {
  waitUntil.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ejecutarEnSegundoPlano', () => {
  it('registra la promesa en waitUntil y no devuelve nada', () => {
    const r = ejecutarEnSegundoPlano(Promise.resolve(1));
    expect(r).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it('la promesa registrada espera al trabajo real', async () => {
    let terminado = false;
    ejecutarEnSegundoPlano(new Promise<void>(ok => setTimeout(() => { terminado = true; ok(); }, 5)));
    await waitUntil.mock.calls[0][0];
    expect(terminado).toBe(true);
  });

  it('acepta una función y la ejecuta', async () => {
    const fn = vi.fn(async () => 'ok');
    ejecutarEnSegundoPlano(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
  });

  it('un rechazo se loguea y la promesa registrada nunca rechaza', async () => {
    ejecutarEnSegundoPlano(Promise.reject(new Error('boom')), 'prueba');
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('una función que lanza de forma síncrona queda aislada', async () => {
    expect(() => ejecutarEnSegundoPlano(() => { throw new Error('sync'); })).not.toThrow();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sync'));
  });

  it('si waitUntil lanza (fuera de Vercel o fallo), no rompe y el trabajo corre igual', async () => {
    waitUntil.mockImplementation(() => { throw new Error('sin contexto'); });
    const fn = vi.fn(async () => undefined);
    expect(() => ejecutarEnSegundoPlano(fn)).not.toThrow();
    expect(fn).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sin contexto'));
  });
});
