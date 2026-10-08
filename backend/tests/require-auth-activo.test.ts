import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const estado = { rol: 'superadmin', activo: true as boolean | null, error: null as { message: string } | null, consultas: 0 };
const supabaseAdmin = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          estado.consultas += 1;
          if (estado.error) return { data: null, error: estado.error };
          return { data: estado.activo === null ? null : { activo: estado.activo, rol: estado.rol, permisos: null }, error: null };
        },
      }),
    }),
  }),
};
vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let payload: { sub: string; email: string; rol: string } = { sub: 'u1', email: 'a@b.c', rol: 'superadmin' };
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (t: string) => {
    if (t === 'malo') throw new Error('jwt');
    return payload;
  },
}));

const { requireAuth, requirePermiso, requireSuperadmin } = await import('../src/middlewares/require-auth.js');
const { invalidarUsuarioActivo, vaciarCacheUsuarioActivo, TTL_USUARIO_ACTIVO_MS } = await import('../src/utils/usuario-activo.js');

function llamar(mw: (q: never, s: never, n: never) => unknown, token = 'bueno', user?: unknown) {
  const req = { headers: { authorization: `Bearer ${token}` }, user } as never;
  const res = { statusCode: 0, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  const next = vi.fn();
  return Promise.resolve(mw(req, res as never, next as never)).then(() => ({ res, next, req: req as { user?: unknown } }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  vaciarCacheUsuarioActivo();
  estado.activo = true; estado.error = null; estado.consultas = 0; estado.rol = 'superadmin';
  payload = { sub: 'u1', email: 'a@b.c', rol: 'superadmin' };
});
afterEach(() => vi.useRealTimers());

describe('requireAuth y usuario activo', () => {
  it('superadmin activo pasa y conserva su rol', async () => {
    const { res, next, req } = await llamar(requireAuth);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
    expect(req.user).toMatchObject({ sub: 'u1', rol: 'superadmin' });
  });

  it('superadmin DESACTIVADO recibe 401 aunque su JWT sea válido', async () => {
    estado.activo = false;
    const { res, next } = await llamar(requireAuth);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('usuario inexistente recibe 401', async () => {
    estado.activo = null;
    const { res, next } = await llamar(requireAuth);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('token inválido: 401 sin consultar la BD', async () => {
    const { res } = await llamar(requireAuth, 'malo');
    expect(res.statusCode).toBe(401);
    expect(estado.consultas).toBe(0);
  });

  it('la caché evita consultar en cada petición y expira a los 30 s', async () => {
    await llamar(requireAuth);
    await llamar(requireAuth);
    expect(estado.consultas).toBe(1);
    vi.advanceTimersByTime(TTL_USUARIO_ACTIVO_MS + 1);
    estado.activo = false;
    const { res } = await llamar(requireAuth);
    expect(estado.consultas).toBe(2);
    expect(res.statusCode).toBe(401);
  });

  it('desactivar invalida la caché: el siguiente request ya se rechaza sin esperar el TTL', async () => {
    await llamar(requireAuth);
    estado.activo = false;
    invalidarUsuarioActivo('u1');
    const { res } = await llamar(requireAuth);
    expect(res.statusCode).toBe(401);
  });

  it('si la BD falla responde 503 (falla cerrado) y no cachea el error', async () => {
    estado.error = { message: 'db caída' };
    const { res, next } = await llamar(requireAuth);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
    estado.error = null;
    const ok = await llamar(requireAuth);
    expect(ok.next).toHaveBeenCalledOnce();
  });

  it('requirePermiso: un superadmin desactivado tampoco pasa (rutas con permiso)', async () => {
    estado.activo = false;
    const { res, next } = await llamar(requirePermiso('pesaje', 'crear'), 'bueno', payload);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('requirePermiso: un superadmin activo sigue pasando', async () => {
    const { next } = await llamar(requirePermiso('pesaje', 'crear'), 'bueno', payload);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('rol real de la BD (N6)', () => {
  it('un superadmin degradado deja de pasar requireSuperadmin tras invalidar la caché', async () => {
    const a = await llamar(requireAuth);
    expect((a.req.user as { rol: string }).rol).toBe('superadmin');
    estado.rol = 'trabajador';
    invalidarUsuarioActivo('u1');
    const b = await llamar(requireAuth);
    expect(b.next).toHaveBeenCalledOnce();
    expect((b.req.user as { rol: string }).rol).toBe('trabajador');
    const c = await llamar(requireSuperadmin(), 'bueno', b.req.user);
    expect(c.res.statusCode).toBe(403);
    expect(c.next).not.toHaveBeenCalled();
  });

  it('sin invalidar, el rol viejo dura como máximo el TTL de 30 s', async () => {
    await llamar(requireAuth);
    estado.rol = 'trabajador';
    const dentro = await llamar(requireAuth);
    expect((dentro.req.user as { rol: string }).rol).toBe('superadmin');
    vi.advanceTimersByTime(TTL_USUARIO_ACTIVO_MS + 1);
    const fuera = await llamar(requireAuth);
    expect((fuera.req.user as { rol: string }).rol).toBe('trabajador');
  });

  it('requirePermiso no deja pasar como superadmin a quien la BD ya degradó (JWT viejo)', async () => {
    estado.rol = 'trabajador';
    const { req } = await llamar(requirePermiso('pesaje', 'crear'), 'bueno', { ...payload });
    expect((req.user as { rol: string }).rol).toBe('trabajador');
    expect(estado.consultas).toBe(2); // 1 del estado cacheado + 1 de la lectura de permisos del no-superadmin
  });

  it('requirePermiso: si la BD falla responde 503 y no cachea', async () => {
    estado.error = { message: 'caída' };
    const { res, next } = await llamar(requirePermiso('pesaje', 'crear'), 'bueno', payload);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
    estado.error = null;
    const ok = await llamar(requirePermiso('pesaje', 'crear'), 'bueno', payload);
    expect(ok.next).toHaveBeenCalledOnce();
  });
});
