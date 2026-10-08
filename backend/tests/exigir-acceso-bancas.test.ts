import { describe, it, expect, vi, beforeEach } from 'vitest';

const acceso = vi.hoisted(() => ({ permitidas: null as ReadonlySet<string> | null }));
vi.mock('../src/services/banca-acceso-service.js', () => ({
  bancasPermitidas: async () => acceso.permitidas,
}));

import { exigirAccesoBancas } from '../src/middlewares/exigir-acceso-bancas.js';

function ejecutar(body: unknown, extra: (() => Promise<string[]>) | undefined = undefined) {
  const res = { statusCode: 200, cuerpo: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.cuerpo = b; return this; } };
  const next = vi.fn();
  const req = { user: { sub: 'u1', rol: 'trabajador' }, body };
  return exigirAccesoBancas(extra)(req as never, res as never, next).then(() => ({ res, next }));
}

beforeEach(() => { acceso.permitidas = null; });

describe('exigirAccesoBancas', () => {
  it('sin restricción deja pasar', async () => {
    const { next } = await ejecutar({ bancaId: 'x' });
    expect(next).toHaveBeenCalled();
  });

  it('responde 403 si el body usa una banca no permitida', async () => {
    acceso.permitidas = new Set(['a']);
    const { res, next } = await ejecutar({ bancas: [{ bancaId: 'a' }, { bancaId: 'b' }] });
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deja pasar si todas están permitidas', async () => {
    acceso.permitidas = new Set(['a', 'b']);
    const { next } = await ejecutar({ bancaId: 'a', bancaDestinoId: 'b' });
    expect(next).toHaveBeenCalled();
  });

  it('también valida las bancas actuales del registro que se edita', async () => {
    acceso.permitidas = new Set(['a']);
    const { res } = await ejecutar({ monto: 5 }, async () => ['zzz']);
    expect(res.statusCode).toBe(403);
  });

  it('usuario sin bancas no puede operar', async () => {
    acceso.permitidas = new Set();
    const { res } = await ejecutar({ bancaId: 'a' });
    expect(res.statusCode).toBe(403);
  });

  it('sin bancas en la petición no bloquea (p. ej. cruce puro)', async () => {
    acceso.permitidas = new Set();
    const { next } = await ejecutar({ bancas: [] });
    expect(next).toHaveBeenCalled();
  });
});

describe('exigirAccesoBancas: falla cerrado', () => {
  it('si la consulta de bancas actuales lanza, responde 503 y no llama next', async () => {
    acceso.permitidas = new Set(['a']);
    const { res, next } = await ejecutar({ monto: 5 }, async () => { throw new Error('bd caida'); });
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('registro inexistente (sin bancas) deja pasar al 404 del handler', async () => {
    acceso.permitidas = new Set(['a']);
    const { next } = await ejecutar({ monto: 5 }, async () => []);
    expect(next).toHaveBeenCalled();
  });
});
