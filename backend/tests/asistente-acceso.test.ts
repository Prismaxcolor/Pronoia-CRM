import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));

import {
  verificarAcceso,
  reiniciarCacheAcceso,
  TTL_USUARIO_ACTIVO_MS,
  MENSAJE_LIMITE_DIARIO,
  type DepsAcceso,
} from '../src/services/asistente-acceso';
import { LIMITE_PREGUNTAS_DIARIAS } from '../src/utils/asistente-limites';

let reloj = 0;
const crearDeps = (sobre: Partial<DepsAcceso> = {}) => ({
  usuarioActivo: vi.fn(async () => true),
  registrarUso: vi.fn(async () => true),
  ahora: () => reloj,
  ...sobre,
});

beforeEach(() => {
  reloj = 1_000;
  reiniciarCacheAcceso();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('verificarAcceso: usuario activo', () => {
  it('responde 401 si el usuario está inactivo o no existe y no cuenta la pregunta', async () => {
    const deps = crearDeps({ usuarioActivo: vi.fn(async () => false) });
    const r = await verificarAcceso('u1', deps);
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(deps.registrarUso).not.toHaveBeenCalled();
  });

  it('cachea al usuario activo durante el TTL y vuelve a consultar al vencer', async () => {
    const deps = crearDeps();
    await verificarAcceso('u1', deps);
    await verificarAcceso('u1', deps);
    expect(deps.usuarioActivo).toHaveBeenCalledTimes(1);
    reloj += TTL_USUARIO_ACTIVO_MS + 1;
    await verificarAcceso('u1', deps);
    expect(deps.usuarioActivo).toHaveBeenCalledTimes(2);
  });

  it('un usuario dado de baja se bloquea al vencer el caché', async () => {
    const activo = vi.fn(async () => true);
    const deps = crearDeps({ usuarioActivo: activo });
    expect((await verificarAcceso('u1', deps)).ok).toBe(true);
    activo.mockResolvedValue(false);
    reloj += TTL_USUARIO_ACTIVO_MS + 1;
    expect(await verificarAcceso('u1', deps)).toMatchObject({ ok: false, status: 401 });
  });

  it('si no se puede consultar la BD responde 503 (no deja pasar sin verificar)', async () => {
    const deps = crearDeps({ usuarioActivo: vi.fn(async () => { throw new Error('caída'); }) });
    expect(await verificarAcceso('u1', deps)).toMatchObject({ ok: false, status: 503 });
  });
});

describe('verificarAcceso: tope diario', () => {
  it('cuenta una pregunta con el límite diario por defecto', async () => {
    const deps = crearDeps();
    expect(await verificarAcceso('u1', deps)).toEqual({ ok: true });
    expect(deps.registrarUso).toHaveBeenCalledWith('u1', LIMITE_PREGUNTAS_DIARIAS);
  });

  it('responde 429 amable cuando se alcanza el límite', async () => {
    const deps = crearDeps({ registrarUso: vi.fn(async () => false) });
    expect(await verificarAcceso('u1', deps)).toEqual({ ok: false, status: 429, error: MENSAJE_LIMITE_DIARIO });
  });

  it('falla abierta: si el conteo falla BLOB sigue funcionando', async () => {
    const deps = crearDeps({ registrarUso: vi.fn(async () => { throw new Error('rpc no existe'); }) });
    expect(await verificarAcceso('u1', deps)).toEqual({ ok: true });
  });
});
