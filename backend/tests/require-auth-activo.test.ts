import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const estado = { rol: 'superadmin', permisos: null as unknown, activo: true as boolean | null, error: null as { message: string } | null, consultas: 0 };
const supabaseAdmin = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          estado.consultas += 1;
          if (estado.error) return { data: null, error: estado.error };
          return { data: estado.activo === null ? null : { activo: estado.activo, rol: estado.rol, permisos: estado.permisos }, error: null };
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
  estado.activo = true; estado.error = null; estado.consultas = 0; estado.rol = 'superadmin'; estado.permisos = null;
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
    expect(estado.consultas).toBe(1); // la lectura de estado (fallo de caché) ya trae los permisos: no se repite la consulta
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

describe('permisos: una sola consulta por petición en el primer request de la instancia', () => {
  const usuario = { sub: 'u1', email: 'a@b.c', rol: 'trabajador' };

  /** Una petición real: requireAuth y requirePermiso comparten el mismo req (como en Express). */
  async function peticion(recurso: 'pesaje' | 'usuarios') {
    payload = usuario;
    const req = { headers: { authorization: 'Bearer bueno' } } as { headers: { authorization: string }; user?: unknown };
    const res = { statusCode: 0, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
    const next = vi.fn();
    await requireAuth(req as never, res as never, next as never);
    const next2 = vi.fn();
    await requirePermiso(recurso, 'ver')(req as never, res as never, next2 as never);
    return { res, next: next2 };
  }

  it('requireAuth + requirePermiso con la caché fría: 1 consulta (antes 2) y el permiso se aplica igual', async () => {
    estado.rol = 'trabajador';
    const ok = await peticion('pesaje');
    expect(estado.consultas).toBe(1);
    expect(ok.next).toHaveBeenCalledOnce();
  });

  it('con la caché caliente los permisos se siguen leyendo frescos de la BD (no se cachean)', async () => {
    estado.rol = 'trabajador';
    await peticion('pesaje');
    estado.consultas = 0;
    const ok = await peticion('pesaje');
    expect(estado.consultas).toBe(1); // solo la lectura de permisos; el estado viene de la caché
    expect(ok.next).toHaveBeenCalledOnce();
  });

  it('los permisos personalizados de la lectura compartida se respetan (403 si no incluyen el recurso)', async () => {
    estado.rol = 'trabajador';
    estado.permisos = [{ recurso: 'pesaje', accion: 'ver' }];
    expect((await peticion('pesaje')).next).toHaveBeenCalledOnce();
    vaciarCacheUsuarioActivo();
    const denegado = await peticion('usuarios');
    expect(denegado.res.statusCode).toBe(403);
    expect(denegado.next).not.toHaveBeenCalled();
  });

  it('un cambio de permisos se nota en la siguiente petición con la caché caliente, sin esperar el TTL', async () => {
    estado.rol = 'trabajador';
    estado.permisos = [{ recurso: 'pesaje', accion: 'ver' }];
    await peticion('pesaje');
    estado.permisos = [{ recurso: 'usuarios', accion: 'ver' }];
    const r = await peticion('pesaje');
    expect(r.res.statusCode).toBe(403);
  });
});
