import { describe, it, expect, vi, beforeEach } from 'vitest';

import bcrypt from 'bcryptjs';

type Fila = Record<string, unknown>;

const bd = vi.hoisted(() => ({ tablas: {} as Record<string, Fila[]>, seq: 0 }));
const env = vi.hoisted(() => ({
  CORS_ORIGINS: ['https://app.ejemplo.com'] as string[],
  WEBAUTHN_ORIGINS: [] as string[],
  WEBAUTHN_RP_ID: '',
  WEBAUTHN_RP_NAME: 'Pronoia',
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(40),
}));
const lib = vi.hoisted(() => ({
  verifyReg: vi.fn(),
  verifyAuth: vi.fn(),
}));

/** Supabase en memoria: soporta select/insert/update/delete con eq/lt, single/maybeSingle y await directo. */
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      bd.tablas[tabla] ??= [];
      let modo: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: Fila = {};
      const filtros: Array<(f: Fila) => boolean> = [];
      let soloConteo = false;
      const c: Record<string, unknown> = {};
      const ejecutar = () => {
        const filas = bd.tablas[tabla]!;
        if (modo === 'insert') {
          const nueva = { id: `id-${++bd.seq}`, creado_en: new Date().toISOString(), ultimo_uso: null, ...payload };
          filas.push(nueva);
          return { data: [nueva], error: null };
        }
        const afectadas = filas.filter(f => filtros.every(fn => fn(f)));
        if (modo === 'delete') {
          bd.tablas[tabla] = filas.filter(f => !afectadas.includes(f));
          return { data: afectadas, error: null };
        }
        if (modo === 'update') {
          afectadas.forEach(f => Object.assign(f, payload));
          return { data: afectadas, error: null };
        }
        return { data: afectadas, error: null, count: afectadas.length };
      };
      c.select = (_cols?: string, opts?: { head?: boolean }) => { soloConteo = Boolean(opts?.head); return c; };
      c.insert = (p: Fila) => { modo = 'insert'; payload = p; return c; };
      c.update = (p: Fila) => { modo = 'update'; payload = p; return c; };
      c.delete = () => { modo = 'delete'; return c; };
      c.eq = (k: string, v: unknown) => { filtros.push(f => f[k] === v); return c; };
      c.gt = (k: string, v: string) => { filtros.push(f => String(f[k]) > v); return c; };
      c.lt = (k: string, v: string) => { filtros.push(f => String(f[k]) < v); return c; };
      c.order = () => c;
      c.single = () => { const r = ejecutar(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
      c.maybeSingle = c.single;
      c.then = (ok: (r: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok);
      void soloConteo;
      return c;
    },
  },
}));
vi.mock('../src/config/env.js', () => ({ ENV: env }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async (o: { rpID: string; excludeCredentials: unknown[] }) => ({
    challenge: `reg-${++bd.seq}`,
    rp: { id: o.rpID },
    excludeCredentials: o.excludeCredentials,
  })),
  generateAuthenticationOptions: vi.fn(async (o: { rpID: string }) => ({
    challenge: `auth-${++bd.seq}`,
    rpId: o.rpID,
  })),
  verifyRegistrationResponse: lib.verifyReg,
  verifyAuthenticationResponse: lib.verifyAuth,
}));

import {
  resolverRp,
  opcionesRegistro,
  verificarRegistro,
  opcionesLogin,
  verificarLogin,
  borrarPasskey,
  listarPasskeys,
  consumirChallengePorId,
  borrarPasskeysDeUsuario,
  MAX_CHALLENGES_LOGIN_VIGENTES,
  CHALLENGE_TTL_MS,
} from '../src/services/passkey-service.js';

const ORIGEN = 'https://app.ejemplo.com';
const PASS = 'secreta123';
const HASH = bcrypt.hashSync(PASS, 4);
const USER = 'user-1';

function sembrarUsuario(activo = true, id = USER) {
  bd.tablas.users = [{
    id, email: 'a@b.com', nombre: 'Ana', rol: 'trabajador', permisos: null, activo,
    password_hash: HASH, creado_en: '2026-01-01',
  }];
}

function sembrarPasskey(over: Fila = {}) {
  bd.tablas.passkeys = [{
    id: 'pk-1', user_id: USER, credential_id: 'cred-1',
    public_key: Buffer.from([1, 2, 3]).toString('base64url'),
    counter: 5, transports: ['internal'], nombre: 'Mi celular', creado_en: '2026-01-01', ultimo_uso: null,
    ...over,
  }];
}

function respuestaConChallenge(challenge: string, id = 'cred-nueva') {
  const cdj = Buffer.from(JSON.stringify({ challenge })).toString('base64url');
  return { id, response: { clientDataJSON: cdj } } as never;
}

beforeEach(() => {
  bd.tablas = {};
  bd.seq = 0;
  env.CORS_ORIGINS = [ORIGEN];
  env.WEBAUTHN_ORIGINS = [];
  env.WEBAUTHN_RP_ID = '';
  env.NODE_ENV = 'production';
  lib.verifyReg.mockReset();
  lib.verifyAuth.mockReset();
  sembrarUsuario();
});

describe('resolverRp', () => {
  it('acepta un origin de CORS_ORIGINS y deriva el rpID del host', () => {
    expect(resolverRp(ORIGEN)).toEqual({ rpID: 'app.ejemplo.com', origin: ORIGEN });
  });
  it('rechaza un origin no permitido, ausente o mal formado', () => {
    expect(resolverRp('https://malo.com')).toBeNull();
    expect(resolverRp(undefined)).toBeNull();
    expect(resolverRp('no-es-url')).toBeNull();
    expect(resolverRp(`${ORIGEN}/`)).toBeNull();
  });
  it('WEBAUTHN_ORIGINS tiene prioridad sobre CORS_ORIGINS', () => {
    env.WEBAUTHN_ORIGINS = ['https://otro.com'];
    expect(resolverRp(ORIGEN)).toBeNull();
    expect(resolverRp('https://otro.com')?.rpID).toBe('otro.com');
  });
  it('WEBAUTHN_RP_ID debe ser el host o un dominio padre del origin', () => {
    env.WEBAUTHN_RP_ID = 'ejemplo.com';
    expect(resolverRp(ORIGEN)?.rpID).toBe('ejemplo.com');
    env.WEBAUTHN_RP_ID = 'distinto.com';
    expect(resolverRp(ORIGEN)).toBeNull();
  });
  it('en desarrollo sin lista permite localhost; en producción no', () => {
    env.CORS_ORIGINS = [];
    env.NODE_ENV = 'development';
    expect(resolverRp('http://localhost:5173')?.rpID).toBe('localhost');
    env.NODE_ENV = 'production';
    expect(resolverRp('http://localhost:5173')).toBeNull();
  });
});

describe('origenes inseguros (L1)', () => {
  it('ignora origenes http:// fuera de localhost y falla cerrado en produccion', () => {
    env.CORS_ORIGINS = ['http://app.ejemplo.com'];
    expect(resolverRp('http://app.ejemplo.com')).toBeNull();
  });
  it('un origen https sigue funcionando junto a uno http', () => {
    env.CORS_ORIGINS = ['http://x.com', ORIGEN];
    expect(resolverRp(ORIGEN)).not.toBeNull();
    expect(resolverRp('http://x.com')).toBeNull();
  });
});

describe('reautenticacion y verificacion de usuario', () => {
  it('registro/options con contrasena incorrecta devuelve error password y no crea challenge', async () => {
    expect(await opcionesRegistro(USER, ORIGEN, 'mala')).toEqual({ error: 'password' });
    expect(await opcionesRegistro(USER, ORIGEN, '')).toEqual({ error: 'password' });
    expect(bd.tablas.passkey_challenges ?? []).toHaveLength(0);
  });

  it('borrar con contrasena incorrecta no borra', async () => {
    sembrarPasskey();
    expect(await borrarPasskey(USER, 'pk-1', 'mala')).toBe('password');
    expect(bd.tablas.passkeys).toHaveLength(1);
  });

  it('exige userVerification en opciones y en las verificaciones', async () => {
    const reg = await opcionesRegistro(USER, ORIGEN, PASS);
    const challenge = 'opciones' in reg ? reg.opciones.challenge : '';
    const gen = await import('@simplewebauthn/server');
    expect((gen.generateRegistrationOptions as unknown as { mock: { calls: Array<[{ authenticatorSelection: unknown }]> } })
      .mock.calls.at(-1)![0].authenticatorSelection).toEqual({ residentKey: 'required', userVerification: 'required' });
    lib.verifyReg.mockResolvedValue({ verified: false });
    await verificarRegistro(USER, ORIGEN, respuestaConChallenge(challenge));
    expect(lib.verifyReg.mock.calls[0]![0].requireUserVerification).toBe(true);

    await opcionesLogin(ORIGEN);
    expect((gen.generateAuthenticationOptions as unknown as { mock: { calls: Array<[{ userVerification: string }]> } })
      .mock.calls.at(-1)![0].userVerification).toBe('required');
  });

  it('borrarPasskeysDeUsuario revoca solo las de ese usuario', async () => {
    sembrarPasskey();
    bd.tablas.passkeys!.push({ id: 'pk-2', user_id: 'otro', credential_id: 'c2', public_key: 'k', counter: 0, nombre: 'x', creado_en: 'x', ultimo_uso: null });
    await borrarPasskeysDeUsuario(USER, 'test');
    expect(bd.tablas.passkeys!.map(p => p.id)).toEqual(['pk-2']);
  });
});

describe('tope global de challenges de login (M1)', () => {
  it('con el tope alcanzado responde saturado; los vencidos no cuentan', async () => {
    const vigente = new Date(Date.now() + 60000).toISOString();
    bd.tablas.passkey_challenges = Array.from({ length: MAX_CHALLENGES_LOGIN_VIGENTES }, (_, i) => ({
      id: `c${i}`, challenge: `x${i}`, user_id: null, tipo: 'login', expira_en: vigente,
    }));
    expect(await opcionesLogin(ORIGEN)).toEqual({ error: 'saturado' });
    bd.tablas.passkey_challenges[0]!.expira_en = new Date(Date.now() - 1000).toISOString();
    expect('loginId' in (await opcionesLogin(ORIGEN))).toBe(true);
  });
});

describe('registro', () => {
  it('rechaza origin no permitido sin tocar la BD', async () => {
    expect(await opcionesRegistro(USER, 'https://malo.com', PASS)).toEqual({ error: 'origen' });
    expect(bd.tablas.passkey_challenges ?? []).toHaveLength(0);
  });

  it('opciones excluye credenciales existentes y guarda un challenge de registro', async () => {
    sembrarPasskey();
    const r = await opcionesRegistro(USER, ORIGEN, PASS);
    expect('opciones' in r && r.opciones.excludeCredentials).toEqual([{ id: 'cred-1', transports: ['internal'] }]);
    expect(bd.tablas.passkey_challenges).toHaveLength(1);
    expect(bd.tablas.passkey_challenges![0]).toMatchObject({ tipo: 'registro', user_id: USER });
  });

  it('verify guarda la passkey y consume el challenge (un solo uso)', async () => {
    const op = await opcionesRegistro(USER, ORIGEN, PASS);
    const challenge = 'opciones' in op ? op.opciones.challenge : '';
    lib.verifyReg.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: 'cred-nueva', publicKey: new Uint8Array([9, 9]), counter: 0, transports: ['usb'] } },
    });
    const r = await verificarRegistro(USER, ORIGEN, respuestaConChallenge(challenge), '  Laptop ');
    expect(r).toMatchObject({ passkey: { nombre: 'Laptop', ultimoUso: null } });
    expect(bd.tablas.passkeys).toHaveLength(1);
    expect(bd.tablas.passkey_challenges).toHaveLength(0);

    const repetido = await verificarRegistro(USER, ORIGEN, respuestaConChallenge(challenge));
    expect(repetido).toEqual({ error: 'invalido' });
    expect(lib.verifyReg).toHaveBeenCalledTimes(1);
  });

  it('verify rechaza un challenge vencido', async () => {
    bd.tablas.passkey_challenges = [{
      id: 'c1', challenge: 'viejo', user_id: USER, tipo: 'registro',
      expira_en: new Date(Date.now() - 1000).toISOString(),
    }];
    const r = await verificarRegistro(USER, ORIGEN, respuestaConChallenge('viejo'));
    expect(r).toEqual({ error: 'invalido' });
    expect(lib.verifyReg).not.toHaveBeenCalled();
    expect(bd.tablas.passkey_challenges).toHaveLength(0);
  });

  it('verify rechaza el challenge de otro usuario', async () => {
    bd.tablas.passkey_challenges = [{
      id: 'c1', challenge: 'ajeno', user_id: 'otro', tipo: 'registro',
      expira_en: new Date(Date.now() + 60000).toISOString(),
    }];
    expect(await verificarRegistro(USER, ORIGEN, respuestaConChallenge('ajeno'))).toEqual({ error: 'invalido' });
  });

  it('verify con firma inválida no guarda nada', async () => {
    const op = await opcionesRegistro(USER, ORIGEN, PASS);
    const challenge = 'opciones' in op ? op.opciones.challenge : '';
    lib.verifyReg.mockRejectedValue(new Error('origin mismatch'));
    expect(await verificarRegistro(USER, ORIGEN, respuestaConChallenge(challenge))).toEqual({ error: 'invalido' });
    expect(bd.tablas.passkeys ?? []).toHaveLength(0);
  });
});

describe('challenges', () => {
  it('el challenge de login vence a los 5 minutos y se borra al usarse', async () => {
    const op = await opcionesLogin(ORIGEN);
    const loginId = 'loginId' in op ? op.loginId : '';
    const fila = bd.tablas.passkey_challenges![0]!;
    const vence = new Date(String(fila.expira_en)).getTime() - Date.now();
    expect(vence).toBeGreaterThan(CHALLENGE_TTL_MS - 5000);
    expect(vence).toBeLessThanOrEqual(CHALLENGE_TTL_MS);

    expect(await consumirChallengePorId(loginId, 'login')).not.toBeNull();
    expect(await consumirChallengePorId(loginId, 'login')).toBeNull();
  });

  it('un challenge de registro no sirve para login', async () => {
    bd.tablas.passkey_challenges = [{
      id: 'c1', challenge: 'x', user_id: USER, tipo: 'registro',
      expira_en: new Date(Date.now() + 60000).toISOString(),
    }];
    expect(await consumirChallengePorId('c1', 'login')).toBeNull();
  });
});

describe('login', () => {
  async function prepararLogin() {
    sembrarPasskey();
    const op = await opcionesLogin(ORIGEN);
    return 'loginId' in op ? op.loginId : '';
  }
  const resp = { id: 'cred-1', response: {} } as never;

  it('éxito: devuelve token + usuario y actualiza counter y ultimo_uso', async () => {
    const loginId = await prepararLogin();
    lib.verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
    const r = await verificarLogin(ORIGEN, loginId, resp);
    expect(r?.token).toEqual(expect.any(String));
    expect(r?.usuario.id).toBe(USER);
    expect(bd.tablas.passkeys![0]).toMatchObject({ counter: 6 });
    expect(bd.tablas.passkeys![0]!.ultimo_uso).toEqual(expect.any(String));
    // el verificador recibió el counter guardado
    expect(lib.verifyAuth.mock.calls[0]![0].credential.counter).toBe(5);
  });

  it('el mismo loginId no se puede reutilizar', async () => {
    const loginId = await prepararLogin();
    lib.verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
    expect(await verificarLogin(ORIGEN, loginId, resp)).not.toBeNull();
    expect(await verificarLogin(ORIGEN, loginId, resp)).toBeNull();
  });

  it('rechaza origin no permitido', async () => {
    const loginId = await prepararLogin();
    expect(await verificarLogin('https://malo.com', loginId, resp)).toBeNull();
    expect(lib.verifyAuth).not.toHaveBeenCalled();
  });

  it('rechaza usuario inactivo y no actualiza el counter', async () => {
    const loginId = await prepararLogin();
    sembrarUsuario(false);
    lib.verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
    expect(await verificarLogin(ORIGEN, loginId, resp)).toBeNull();
    expect(bd.tablas.passkeys![0]).toMatchObject({ counter: 5 });
  });

  it('rechaza si la librería detecta counter retrocedido (clon) o firma inválida', async () => {
    const loginId = await prepararLogin();
    lib.verifyAuth.mockRejectedValue(new Error('Response counter value 3 was lower than expected 5'));
    expect(await verificarLogin(ORIGEN, loginId, resp)).toBeNull();
    expect(bd.tablas.passkeys![0]).toMatchObject({ counter: 5, ultimo_uso: null });
  });

  it('rechaza una credencial desconocida', async () => {
    const loginId = await prepararLogin();
    expect(await verificarLogin(ORIGEN, loginId, { id: 'otra', response: {} } as never)).toBeNull();
  });

  it('rechaza un loginId inexistente', async () => {
    sembrarPasskey();
    expect(await verificarLogin(ORIGEN, 'no-existe', resp)).toBeNull();
  });
});

describe('listar y borrar', () => {
  it('lista solo las propias, sin exponer la clave', async () => {
    sembrarPasskey();
    bd.tablas.passkeys!.push({ id: 'pk-2', user_id: 'otro', credential_id: 'c2', public_key: 'k', counter: 0, nombre: 'Ajena', creado_en: 'x', ultimo_uso: null });
    const lista = await listarPasskeys(USER);
    expect(lista).toEqual([{ id: 'pk-1', nombre: 'Mi celular', creadoEn: '2026-01-01', ultimoUso: null }]);
  });

  it('no borra una passkey ajena', async () => {
    sembrarPasskey({ user_id: 'otro' });
    expect(await borrarPasskey(USER, 'pk-1', PASS)).toBe(false);
    expect(bd.tablas.passkeys).toHaveLength(1);
  });

  it('borra una propia y devuelve false si ya no existe', async () => {
    sembrarPasskey();
    expect(await borrarPasskey(USER, 'pk-1', PASS)).toBe(true);
    expect(await borrarPasskey(USER, 'pk-1', PASS)).toBe(false);
  });
});
