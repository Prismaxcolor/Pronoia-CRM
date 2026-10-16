import { describe, it, expect, vi } from 'vitest';
import {
  esErrorDeRed, comprobarConexion, crearAlmacenConexion,
} from '../../frontend/src/lib/offline/conexion-logica';

describe('esErrorDeRed', () => {
  it('un TypeError de fetch es error de red', () => {
    expect(esErrorDeRed(new TypeError('Failed to fetch'), true)).toBe(true);
  });

  it('timeout y abort son errores de red', () => {
    expect(esErrorDeRed({ name: 'AbortError' }, true)).toBe(true);
    expect(esErrorDeRed({ name: 'TimeoutError' }, true)).toBe(true);
  });

  it('una respuesta del servidor (400, 401, 404, 409, 500) NO es error de red', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      expect(esErrorDeRed(Object.assign(new Error('x'), { status }), true)).toBe(false);
    }
  });

  it('gateway caído (502, 503, 504), 408 y 0 sí cuentan como sin servidor', () => {
    for (const status of [0, 408, 502, 503, 504]) {
      expect(esErrorDeRed(Object.assign(new Error('x'), { status }), true)).toBe(true);
    }
  });

  it('navigator.onLine=false convierte un Error genérico en error de red, pero no uno con respuesta HTTP', () => {
    expect(esErrorDeRed(new Error('algo'), false)).toBe(true);
    expect(esErrorDeRed(new Error('algo'), true)).toBe(false);
    expect(esErrorDeRed(Object.assign(new Error('x'), { status: 400 }), false)).toBe(false);
  });

  it('valores que no son errores no se tratan como red', () => {
    expect(esErrorDeRed('texto', true)).toBe(false);
    expect(esErrorDeRed(null, false)).toBe(false);
  });
});

describe('comprobarConexion', () => {
  it('true si el servidor responde (aunque sea 500: hay red)', async () => {
    expect(await comprobarConexion('u', async () => ({ ok: false, status: 500 }))).toBe(true);
  });

  it('false si fetch falla o el gateway responde 503', async () => {
    expect(await comprobarConexion('u', async () => { throw new TypeError('x'); })).toBe(false);
    expect(await comprobarConexion('u', async () => ({ ok: false, status: 503 }))).toBe(false);
  });

  it('aborta y devuelve false cuando se acaba el timeout', async () => {
    vi.useFakeTimers();
    const p = comprobarConexion('u', (_u, init) => new Promise((_ok, no) => {
      init.signal.addEventListener('abort', () => no(Object.assign(new Error('abort'), { name: 'AbortError' })));
    }), 50);
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toBe(false);
    vi.useRealTimers();
  });
});

describe('crearAlmacenConexion', () => {
  it('solo avisa cuando cambia el estado y registra desde cuándo', () => {
    let t = 100;
    const a = crearAlmacenConexion(true, () => t);
    const oyente = vi.fn();
    a.suscribir(oyente);
    a.fijar(true);
    expect(oyente).not.toHaveBeenCalled();
    t = 200;
    a.fijar(false);
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(a.obtener()).toEqual({ online: false, desde: 200 });
  });

  it('desuscribir deja de avisar', () => {
    const a = crearAlmacenConexion(true);
    const oyente = vi.fn();
    const baja = a.suscribir(oyente);
    baja();
    a.fijar(false);
    expect(oyente).not.toHaveBeenCalled();
  });
});
