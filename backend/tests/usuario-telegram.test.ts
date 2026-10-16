import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  tablas: {} as Record<string, Fila[]>,
  errorInsert: null as null | { code?: string; message?: string },
  errorUpdateUsers: null as null | { code?: string; message?: string },
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const filtros: Array<(f: Fila) => boolean> = [];
      let cambios: Fila | null = null;
      const filas = () => (bd.tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)));
      const aplicar = () => {
        if (!cambios) return filas();
        const objetivo = filas();
        for (const f of objetivo) Object.assign(f, cambios);
        cambios = null;
        return objetivo;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return b; },
        update: (v: Fila) => { cambios = v; return b; },
        insert: async (fila: Fila) => {
          if (bd.errorInsert) return { error: bd.errorInsert };
          (bd.tablas[tabla] ??= []).push({ usado: false, ...fila });
          return { error: null };
        },
        maybeSingle: async () => {
          if (tabla === 'users' && cambios && bd.errorUpdateUsers) return { data: null, error: bd.errorUpdateUsers };
          return { data: aplicar()[0] ?? null, error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: aplicar(), error: null }).then(res),
      };
      return b;
    },
  },
}));
vi.mock('../src/config/env.js', () => ({ ENV: { TELEGRAM_BOT_USERNAME: 'BotPrueba' } }));

import {
  TOKEN_USUARIO_TTL_MINUTOS,
  calcularExpiracionUsuario,
  desvincularTelegramUsuario,
  generarLinkTelegramUsuario,
  puedeGestionarTelegramDe,
} from '../src/services/usuario-telegram-service.js';
import { puedeVerChatId } from '../src/services/usuario-service.js';

const tokens = () => bd.tablas.telegram_link_tokens ?? [];

beforeEach(() => {
  bd.errorInsert = null;
  bd.errorUpdateUsers = null;
  bd.tablas = {
    users: [
      { id: 'u1', activo: true, telegram_chat_id: '555', telegram_linked_at: '2026-10-01T00:00:00Z' },
      { id: 'u2', activo: false },
    ],
    telegram_link_tokens: [],
  };
});

describe('expiración del enlace de usuario', () => {
  it('vence a los 30 minutos', () => {
    const desde = new Date('2026-10-07T10:00:00Z');
    expect(TOKEN_USUARIO_TTL_MINUTOS).toBe(30);
    expect(calcularExpiracionUsuario(desde)).toBe('2026-10-07T10:30:00.000Z');
  });
});

describe('generarLinkTelegramUsuario', () => {
  it('crea un token de tipo usuario con deep link y expiración de 30 min', async () => {
    const antes = Date.now();
    const r = await generarLinkTelegramUsuario('u1');
    expect('deepLink' in r).toBe(true);
    if (!('deepLink' in r)) return;
    expect(tokens()).toHaveLength(1);
    const t = tokens()[0];
    expect(t.entidad_tipo).toBe('usuario');
    expect(t.entidad_id).toBe('u1');
    expect(r.deepLink).toBe(`https://t.me/BotPrueba?start=${t.token}`);
    expect(String(t.token)).toMatch(/^[0-9a-f]{32}$/);
    const ms = new Date(String(t.expires_at)).getTime() - antes;
    expect(ms).toBeGreaterThan(29 * 60_000);
    expect(ms).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it('invalida los tokens pendientes previos del mismo usuario y no toca los de otros', async () => {
    bd.tablas.telegram_link_tokens = [
      { entidad_tipo: 'usuario', entidad_id: 'u1', token: 'viejo', usado: false },
      { entidad_tipo: 'usuario', entidad_id: 'otro', token: 'ajeno', usado: false },
      { entidad_tipo: 'proveedor', entidad_id: 'u1', token: 'prov', usado: false },
    ];
    await generarLinkTelegramUsuario('u1');
    const por = (tk: string) => tokens().find(t => t.token === tk)!;
    expect(por('viejo').usado).toBe(true);
    expect(por('ajeno').usado).toBe(false);
    expect(por('prov').usado).toBe(false);
    expect(tokens().filter(t => t.entidad_id === 'u1' && t.entidad_tipo === 'usuario' && !t.usado)).toHaveLength(1);
  });

  it('404 si el usuario no existe y 400 si está desactivado, sin crear tokens', async () => {
    const noExiste = await generarLinkTelegramUsuario('zzz');
    expect(noExiste).toMatchObject({ status: 404 });
    const inactivo = await generarLinkTelegramUsuario('u2');
    expect(inactivo).toMatchObject({ status: 400 });
    expect(tokens()).toHaveLength(0);
  });

  it('responde 409 claro si falta la migración (CHECK de entidad_tipo)', async () => {
    bd.errorInsert = { code: '23514', message: 'violates check constraint' };
    const r = await generarLinkTelegramUsuario('u1');
    expect(r).toMatchObject({ status: 409 });
    expect('error' in r && r.error).toContain('migration_users_telegram.sql');
  });
});

describe('desvincularTelegramUsuario', () => {
  it('borra chat id y fecha e invalida enlaces pendientes', async () => {
    bd.tablas.telegram_link_tokens = [{ entidad_tipo: 'usuario', entidad_id: 'u1', token: 'p', usado: false }];
    const r = await desvincularTelegramUsuario('u1');
    expect(r).toEqual({ ok: true });
    expect(bd.tablas.users[0].telegram_chat_id).toBeNull();
    expect(bd.tablas.users[0].telegram_linked_at).toBeNull();
    expect(tokens()[0].usado).toBe(true);
  });

  it('404 si el usuario no existe', async () => {
    expect(await desvincularTelegramUsuario('zzz')).toMatchObject({ status: 404 });
  });

  it('409 si la columna aún no existe', async () => {
    bd.errorUpdateUsers = { code: '42703', message: 'column "telegram_chat_id" does not exist' };
    expect(await desvincularTelegramUsuario('u1')).toMatchObject({ status: 409 });
  });
});

describe('autorización', () => {
  it('cada usuario gestiona el suyo; el de otro solo un superadmin', () => {
    expect(puedeGestionarTelegramDe({ id: 'a', rol: 'trabajador' }, 'a')).toBe(true);
    expect(puedeGestionarTelegramDe({ id: 'a', rol: 'trabajador' }, 'b')).toBe(false);
    expect(puedeGestionarTelegramDe({ id: 'a', rol: 'administracion' }, 'b')).toBe(false);
    expect(puedeGestionarTelegramDe({ id: 'a', rol: 'superadmin' }, 'b')).toBe(true);
  });

  it('el chat id solo es visible para el propio usuario y superadmin', () => {
    expect(puedeVerChatId({ id: 'a', rol: 'administracion' }, 'b')).toBe(false);
    expect(puedeVerChatId({ id: 'a', rol: 'administracion' }, 'a')).toBe(true);
    expect(puedeVerChatId({ id: 'a', rol: 'superadmin' }, 'b')).toBe(true);
  });
});
