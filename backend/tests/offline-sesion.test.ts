import { describe, it, expect } from 'vitest';
import {
  decodificarExpiracion, evaluarVigencia, clasificarFalloSesion, decidirArranque,
  MAX_SIN_VERIFICAR_MS, VERSION_SESION, type SesionLocal,
} from '../../frontend/src/lib/offline/sesion-logica';
import { crearServicioSesion } from '../../frontend/src/lib/offline/sesion-servicio';
import { crearAlmacenKvMemoria, type AlmacenKV } from '../../frontend/src/lib/offline/almacen-kv';
import type { DependenciasPin } from '../../frontend/src/lib/offline/pin-logica';

const DIA = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

function jwt(expSegundos: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp: expSegundos })}.firma`;
}

function sesion(extra: Partial<SesionLocal> = {}): SesionLocal {
  return {
    v: VERSION_SESION,
    usuario: { id: 'u1', nombre: 'Ana', rol: 'operador', permisos: [] },
    token: 'tok',
    expiraEn: T0 + 7 * DIA,
    ultimaVerificacion: T0,
    offlineActivo: true,
    ...extra,
  };
}

describe('decodificarExpiracion', () => {
  it('lee exp del JWT y lo pasa a milisegundos', () => {
    expect(decodificarExpiracion(jwt(1_900_000_000))).toBe(1_900_000_000_000);
  });
  it('devuelve null con tokens opacos, dañados o sin exp', () => {
    expect(decodificarExpiracion('abc')).toBeNull();
    expect(decodificarExpiracion('a.%%%.c')).toBeNull();
    const sinExp = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('{"sub":1}').toString('base64url')}.f`;
    expect(decodificarExpiracion(sinExp)).toBeNull();
  });
});

describe('evaluarVigencia', () => {
  it('vigente dentro de 7 días y con el token sin vencer', () => {
    expect(evaluarVigencia(sesion(), T0 + 3 * DIA, 'tok').vigente).toBe(true);
  });
  it('caduca a los 7 días sin revalidar (constante configurable)', () => {
    expect(evaluarVigencia(sesion({ expiraEn: null }), T0 + MAX_SIN_VERIFICAR_MS, 'tok')).toEqual({ vigente: false, motivo: 'caducada' });
    expect(evaluarVigencia(sesion({ expiraEn: null }), T0 + 2 * DIA, 'tok', DIA)).toEqual({ vigente: false, motivo: 'caducada' });
  });
  it('no vigente si el JWT ya venció aunque la verificación sea reciente', () => {
    expect(evaluarVigencia(sesion({ expiraEn: T0 + 1000 }), T0 + 2000, 'tok')).toEqual({ vigente: false, motivo: 'token-vencido' });
  });
  it('reloj desfasado hacia atrás no extiende la sesión', () => {
    expect(evaluarVigencia(sesion(), T0 - DIA, 'tok')).toEqual({ vigente: false, motivo: 'reloj' });
  });
  it('tolera un retraso pequeño del reloj', () => {
    expect(evaluarVigencia(sesion(), T0 - 60_000, 'tok').vigente).toBe(true);
  });
  it('reloj adelantado vence antes (lado seguro)', () => {
    expect(evaluarVigencia(sesion(), T0 + 30 * DIA, 'tok').vigente).toBe(false);
  });
  it('interruptor apagado, token distinto o datos dañados no son vigentes', () => {
    expect(evaluarVigencia(sesion({ offlineActivo: false }), T0, 'tok')).toEqual({ vigente: false, motivo: 'apagado' });
    expect(evaluarVigencia(sesion(), T0, 'otro')).toEqual({ vigente: false, motivo: 'token-distinto' });
    expect(evaluarVigencia(null, T0, 'tok')).toEqual({ vigente: false, motivo: 'invalida' });
    expect(evaluarVigencia({ ...sesion(), v: 99 } as SesionLocal, T0, 'tok')).toEqual({ vigente: false, motivo: 'invalida' });
  });
});

describe('clasificarFalloSesion', () => {
  it('solo 401, 403 y 404 invalidan la sesión', () => {
    for (const status of [401, 403, 404]) expect(clasificarFalloSesion({ status })).toBe('sesion-invalida');
    for (const status of [400, 429, 500, 502, 503]) expect(clasificarFalloSesion({ status })).toBe('sin-servidor');
  });
  it('un fallo de red nunca invalida la sesión', () => {
    expect(clasificarFalloSesion(new TypeError('Failed to fetch'))).toBe('sin-servidor');
    expect(clasificarFalloSesion({ name: 'AbortError' })).toBe('sin-servidor');
    expect(clasificarFalloSesion(undefined)).toBe('sin-servidor');
  });
});

describe('decidirArranque', () => {
  const red = { ok: false as const, error: new TypeError('Failed to fetch') };

  it('/me correcto da online', () => {
    const d = decidirArranque({ ok: true, usuario: sesion().usuario }, null, T0, 'tok');
    expect(d.accion).toBe('online');
  });
  it('sin red y sesión local vigente usa la local sin cerrar sesión', () => {
    expect(decidirArranque(red, sesion(), T0 + DIA, 'tok').accion).toBe('offline');
  });
  it('sin red y sin sesión local queda sin-usuario, conservando el token', () => {
    expect(decidirArranque(red, null, T0, 'tok')).toEqual({ accion: 'sin-usuario', motivo: 'invalida' });
  });
  it('sin red y sesión local caducada queda sin-usuario (no se borra nada)', () => {
    expect(decidirArranque(red, sesion({ expiraEn: null }), T0 + 8 * DIA, 'tok')).toMatchObject({ accion: 'sin-usuario', motivo: 'caducada' });
  });
  it('401 o 404 cierran aunque exista sesión local', () => {
    expect(decidirArranque({ ok: false, error: { status: 401 } }, sesion(), T0, 'tok').accion).toBe('cerrar');
    expect(decidirArranque({ ok: false, error: { status: 404 } }, sesion(), T0, 'tok').accion).toBe('cerrar');
  });
  it('500 del servidor con sesión vigente trabaja con la local', () => {
    expect(decidirArranque({ ok: false, error: { status: 500 } }, sesion(), T0, 'tok').accion).toBe('offline');
  });
});

describe('servicio de sesión', () => {
  const pinFalso = (ahora: () => number): DependenciasPin => ({
    derivar: async (pin, sal) => new TextEncoder().encode(`${pin}|${sal.join(',')}`),
    aleatorios: n => Uint8Array.from({ length: n }, (_, i) => i + 1),
    ahora,
  });
  const crear = (
    kv: AlmacenKV = crearAlmacenKvMemoria(), reloj = { t: T0 }, token: string | null = 'tok',
    kvSesion: AlmacenKV = crearAlmacenKvMemoria(), alCambiarUsuario?: () => Promise<void>,
  ) => ({
    reloj,
    kv,
    kvSesion,
    svc: crearServicioSesion({ kv, kvSesion, alCambiarUsuario, ahora: () => reloj.t, leerToken: () => token, pin: pinFalso(() => reloj.t) }),
  });
  const usuario = { id: 'u1', nombre: 'Ana', rol: 'operador', permisos: [] } as never;

  it('guarda y vuelve a leer la sesión; la vigencia es síncrona tras guardar', async () => {
    const { svc } = crear();
    expect(svc.vigente()).toBe(false);
    expect(await svc.guardar(usuario, 'tok', { offlineActivo: true, recordar: true })).toBe(true);
    expect(svc.vigente()).toBe(true);
    expect((await svc.leer())?.usuario).toMatchObject({ id: 'u1' });
  });

  it('la sesión se recupera en una instancia nueva (reabrir la app)', async () => {
    const kv = crearAlmacenKvMemoria();
    await crear(kv).svc.guardar(usuario, 'tok', { offlineActivo: true, recordar: true });
    const nueva = crear(kv).svc;
    expect(nueva.vigente()).toBe(false);
    await nueva.leer();
    expect(nueva.vigente()).toBe(true);
  });

  it('cuota llena o IndexedDB que falla: guardar devuelve false y no lanza', async () => {
    const kv: AlmacenKV = { leer: async () => null, escribir: async () => false, borrar: async () => false };
    const { svc } = crear(kv);
    expect(await svc.guardar(usuario, 'tok', { recordar: true })).toBe(false);
  });

  it('el interruptor apagado desactiva la vigencia sin borrar la sesión', async () => {
    const { svc } = crear();
    await svc.guardar(usuario, 'tok', { offlineActivo: true, recordar: true });
    await svc.actualizarInterruptor(false);
    expect(svc.vigente()).toBe(false);
    expect(svc.habilitado()).toBe(false);
    expect(await svc.leer()).not.toBeNull();
  });

  it('el reloj adelantado más de 7 días vence la sesión local', async () => {
    const { svc, reloj } = crear();
    await svc.guardar(usuario, 'tok', { offlineActivo: true, recordar: true });
    expect(svc.vigente()).toBe(true);
    reloj.t = T0 + 8 * DIA;
    expect(svc.vigente()).toBe(false);
  });

  it('limpiar borra la sesión y el PIN', async () => {
    const { svc } = crear();
    await svc.guardar(usuario, 'tok');
    await svc.configurarPin('1234', 'u1');
    await svc.limpiar();
    expect(await svc.leer()).toBeNull();
    expect(await svc.pinConfigurado()).toBe(false);
  });

  it('otro usuario inicia sesión en el equipo: el PIN del anterior se descarta', async () => {
    const { svc } = crear();
    await svc.guardar(usuario, 'tok');
    await svc.configurarPin('1234', 'u1');
    await svc.guardar({ ...(usuario as object), id: 'u2' } as never, 'tok2');
    expect(await svc.pinConfigurado()).toBe(false);
  });

  it('el mismo usuario que revalida conserva su PIN', async () => {
    const { svc } = crear();
    await svc.guardar(usuario, 'tok');
    await svc.configurarPin('1234', 'u1');
    await svc.guardar(usuario, 'tok-nuevo');
    expect(await svc.pinConfigurado()).toBe(true);
  });

  it('configurar PIN falla con mensaje claro si no se puede escribir', async () => {
    const kv: AlmacenKV = { leer: async () => null, escribir: async () => false, borrar: async () => true };
    await expect(crear(kv).svc.configurarPin('1234', 'u1')).rejects.toThrow(/No se pudo guardar el PIN/);
  });
});
