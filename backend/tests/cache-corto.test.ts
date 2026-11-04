import { describe, it, expect, vi } from 'vitest';
import { crearCacheCorto } from '../src/utils/cache-corto.js';
import { conLimiteDeTiempo } from '../src/utils/tiempo-limite.js';

describe('crearCacheCorto', () => {
  it('reutiliza el resultado dentro del TTL y recalcula al vencer', async () => {
    let ahora = 1000;
    const cache = crearCacheCorto<number>({ ttlMs: 20_000, ahora: () => ahora });
    const calcular = vi.fn(async () => 7);
    expect(await cache.obtener('a', calcular)).toBe(7);
    ahora += 19_999;
    expect(await cache.obtener('a', calcular)).toBe(7);
    expect(calcular).toHaveBeenCalledTimes(1);
    ahora += 2;
    await cache.obtener('a', calcular);
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('claves distintas no se mezclan (p. ej. con y sin permiso de valor)', async () => {
    const cache = crearCacheCorto<string>({ ttlMs: 20_000 });
    expect(await cache.obtener('valor:1', async () => 'con valor')).toBe('con valor');
    expect(await cache.obtener('valor:0', async () => 'sin valor')).toBe('sin valor');
    expect(await cache.obtener('valor:1', async () => 'otro')).toBe('con valor');
  });

  it('peticiones simultaneas con la misma clave comparten un solo calculo', async () => {
    const cache = crearCacheCorto<number>({ ttlMs: 20_000 });
    const calcular = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); return 1; });
    await Promise.all([cache.obtener('k', calcular), cache.obtener('k', calcular), cache.obtener('k', calcular)]);
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('un calculo fallido NO se guarda', async () => {
    const cache = crearCacheCorto<number>({ ttlMs: 20_000 });
    await expect(cache.obtener('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await cache.obtener('k', async () => 5)).toBe(5);
  });

  it('un resultado que pide no guardarse (parcial) tampoco se reutiliza', async () => {
    const cache = crearCacheCorto<{ ok: boolean }>({ ttlMs: 20_000, guardar: v => v.ok });
    const calcular = vi.fn(async () => ({ ok: calcular.mock.calls.length > 1 }));
    await cache.obtener('k', calcular);
    await cache.obtener('k', calcular);
    await cache.obtener('k', calcular);
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('ttlPara da un TTL distinto por resultado (p. ej. mas corto para uno parcial) y 0 no guarda', async () => {
    let ahora = 0;
    const cache = crearCacheCorto<{ tipo: string }>({
      ttlMs: 20_000, ahora: () => ahora, ttlPara: v => (v.tipo === 'parcial' ? 5_000 : v.tipo === 'nada' ? 0 : 20_000),
    });
    const parcial = vi.fn(async () => ({ tipo: 'parcial' }));
    await cache.obtener('p', parcial);
    ahora = 4_999;
    await cache.obtener('p', parcial);
    expect(parcial).toHaveBeenCalledTimes(1);
    ahora = 5_001;
    await cache.obtener('p', parcial);
    expect(parcial).toHaveBeenCalledTimes(2);
    const completo = vi.fn(async () => ({ tipo: 'completo' }));
    ahora = 10_000;
    await cache.obtener('c', completo);
    ahora = 29_999;
    await cache.obtener('c', completo);
    expect(completo).toHaveBeenCalledTimes(1);
    const nada = vi.fn(async () => ({ tipo: 'nada' }));
    await cache.obtener('n', nada);
    await cache.obtener('n', nada);
    expect(nada).toHaveBeenCalledTimes(2);
  });

  it('invalidar vacia todo y el tamano esta acotado', async () => {
    const cache = crearCacheCorto<number>({ ttlMs: 20_000, maxEntradas: 2 });
    await cache.obtener('a', async () => 1);
    await cache.obtener('b', async () => 2);
    await cache.obtener('c', async () => 3);
    expect(cache.tamano()).toBe(2);
    cache.invalidar();
    expect(cache.tamano()).toBe(0);
  });
});

describe('conLimiteDeTiempo', () => {
  it('devuelve el valor si llega a tiempo', async () => {
    expect(await conLimiteDeTiempo(Promise.resolve(3), 50)).toEqual({ ok: true, valor: 3 });
  });
  it('vence: no espera a la promesa lenta y no deja temporizadores', async () => {
    const lenta = new Promise<number>(r => setTimeout(() => r(1), 200));
    const t0 = Date.now();
    expect(await conLimiteDeTiempo(lenta, 20)).toEqual({ ok: false, motivo: 'tiempo' });
    expect(Date.now() - t0).toBeLessThan(150);
  });
  it('un rechazo tardio tras vencer no genera error no manejado', async () => {
    const rechaza = new Promise<number>((_, rej) => setTimeout(() => rej(new Error('tarde')), 30));
    expect(await conLimiteDeTiempo(rechaza, 5)).toEqual({ ok: false, motivo: 'tiempo' });
    await new Promise(r => setTimeout(r, 50));
  });
  it('un rechazo a tiempo se informa como error', async () => {
    const r = await conLimiteDeTiempo(Promise.reject(new Error('x')), 50);
    expect(r).toMatchObject({ ok: false, motivo: 'error' });
  });
  it('con 0 ms o menos vence de inmediato', async () => {
    expect(await conLimiteDeTiempo(new Promise<number>(() => {}), 0)).toEqual({ ok: false, motivo: 'tiempo' });
  });
});
