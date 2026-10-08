import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actualizarBancaSchema, crearBancaSchema } from '../src/schemas/cochinito.js';

type Resp = { data: Record<string, unknown> | Array<Record<string, unknown>> | null; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({ respuestas: [] as unknown[], escrituras: [] as Array<Record<string, unknown>> }));

vi.mock('../src/config/supabase.js', () => {
  const cadena = (valores?: Record<string, unknown>) => {
    if (valores) bd.escrituras.push(valores);
    const resp = () => Promise.resolve(bd.respuestas.shift() as Resp);
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'select', 'order']) c[m] = () => c;
    c.single = resp;
    c.maybeSingle = resp;
    c.then = (ok: (r: Resp) => unknown) => resp().then(ok);
    return c;
  };
  return { supabaseAdmin: { from: () => ({ insert: cadena, update: cadena, select: () => cadena() }) } };
});

import { actualizarBanca, crearBanca, leerTelegramChatIdBanca, listarBancas, obtenerMovimiento } from '../src/services/banca-service.js';

const fila = { id: 'b1', nombre: 'BNC', tipo: 'banco_nacional', saldo: 0, moneda: 'USD', descripcion: '', archivada: false };
const base = { nombre: 'BNC', tipo: 'banco_nacional' as const, moneda: 'USD', descripcion: null };
const columnaFalta = { code: '42703', message: 'column "telegram_chat_id" of relation "bancas" does not exist' };

beforeEach(() => { bd.respuestas = []; bd.escrituras = []; });

describe('telegram por banca', () => {
  it('listarBancas expone telegramChatId (null si no hay)', async () => {
    bd.respuestas = [{ data: [{ ...fila, telegram_chat_id: '-100123456' }, fila], error: null }];
    const r = await listarBancas();
    expect(r.map(b => b.telegramChatId)).toEqual(['-100123456', null]);
  });

  it('crear con chat id lo envía como telegram_chat_id', async () => {
    bd.respuestas = [{ data: { ...fila, telegram_chat_id: '-100123456' }, error: null }];
    const r = await crearBanca({ ...base, telegramChatId: '-100123456' });
    expect(bd.escrituras[0].telegram_chat_id).toBe('-100123456');
    expect(r).toMatchObject({ banca: { telegramChatId: '-100123456' } });
  });

  it('crear sin chat id no toca la columna', async () => {
    bd.respuestas = [{ data: fila, error: null }];
    await crearBanca(base);
    expect('telegram_chat_id' in bd.escrituras[0]).toBe(false);
  });

  it('editar con null limpia el grupo', async () => {
    bd.respuestas = [{ data: fila, error: null }];
    await actualizarBanca('b1', { telegramChatId: null });
    expect(bd.escrituras[0]).toEqual({ telegram_chat_id: null });
  });

  it('editar con un grupo y sin la columna: pendiente (409), no descarta en silencio', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }];
    const r = await actualizarBanca('b1', { nombre: 'BNC', telegramChatId: '-100123456' });
    expect(r).toMatchObject({ pendiente: true });
    expect('error' in r && r.error).toContain('migration_bancas_telegram_chat.sql');
    expect(bd.escrituras).toHaveLength(1);
  });

  it('editar con grupo null sin la columna degrada quitando solo esa columna', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }, { data: fila, error: null }];
    const r = await actualizarBanca('b1', { nombre: 'BNC', color: 'azul', telegramChatId: null });
    expect(bd.escrituras[1]).toEqual({ nombre: 'BNC', color: 'azul' });
    expect('banca' in r).toBe(true);
  });

  it('si falta solo color se conserva telegram_chat_id', async () => {
    bd.respuestas = [{ data: null, error: { code: '42703', message: 'column "color" of relation "bancas" does not exist' } }, { data: fila, error: null }];
    await actualizarBanca('b1', { nombre: 'BNC', color: 'azul', telegramChatId: '-100123456' });
    expect(bd.escrituras[1]).toEqual({ nombre: 'BNC', telegram_chat_id: '-100123456' });
  });

  it('crear con grupo y sin la columna: pendiente', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }];
    expect(await crearBanca({ ...base, telegramChatId: '-100123456' })).toMatchObject({ pendiente: true });
  });

  it('crear con color y sin la columna color: crea sin color', async () => {
    bd.respuestas = [{ data: null, error: { code: '42703', message: 'column "color" does not exist' } }, { data: fila, error: null }];
    const r = await crearBanca({ ...base, color: 'azul' });
    expect('banca' in r).toBe(true);
    expect('color' in bd.escrituras[1]).toBe(false);
  });

  it('leerTelegramChatIdBanca devuelve el valor actual o null', async () => {
    bd.respuestas = [{ data: { telegram_chat_id: '-100999' }, error: null }, { data: null, error: null }];
    expect(await leerTelegramChatIdBanca('b1')).toBe('-100999');
    expect(await leerTelegramChatIdBanca('b1')).toBeNull();
  });
});

describe('schemas de banca con telegramChatId', () => {
  it('acepta ids numéricos de grupo, vacío => null', () => {
    expect(crearBancaSchema.parse({ ...base, telegramChatId: ' -1001234567890 ' }).telegramChatId).toBe('-1001234567890');
    expect(actualizarBancaSchema.parse({ telegramChatId: '' }).telegramChatId).toBeNull();
  });
  it('rechaza texto que no es un id de chat', () => {
    expect(crearBancaSchema.safeParse({ ...base, telegramChatId: 'mi grupo' }).success).toBe(false);
    expect(actualizarBancaSchema.safeParse({ telegramChatId: '@canal' }).success).toBe(false);
  });
  it('sin el campo, no aparece (no pisa el valor al editar)', () => {
    expect('telegramChatId' in actualizarBancaSchema.parse({ nombre: 'X' })).toBe(false);
  });
});

describe('correlativo del sistema', () => {
  const mov = { id: 'm1', tipo: 'ingreso', monto: 5, moneda: 'USD', banca_origen_id: 'b1', fecha: '2026-10-01', creado_en: '2026-10-01T00:00:00Z' };
  it('mapea numero_sistema a numeroSistema', async () => {
    bd.respuestas = [{ data: { ...mov, numero_sistema: 12 }, error: null }];
    expect((await obtenerMovimiento('m1'))?.numeroSistema).toBe(12);
  });
  it('un movimiento de pago/cobro queda sin correlativo de sistema', async () => {
    bd.respuestas = [{ data: { ...mov, numero: 7, subtipo: 'pago' }, error: null }];
    const m = await obtenerMovimiento('m1');
    expect(m?.numeroSistema).toBeNull();
    expect(m?.numero).toBe(7);
  });
});
