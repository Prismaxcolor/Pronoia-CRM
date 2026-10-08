import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

/**
 * POST /api/llaves-solicitudes/telegram-callback: autenticación por secreto, superadmin vinculado,
 * doble resolución, aprobar/rechazar con la misma función del servicio web y textos de respuesta.
 */

const SECRETO = 'secreto-n8n-de-prueba';
const UUID = '11111111-1111-4111-8111-111111111111';
const UUID_OTRA = '22222222-2222-4222-8222-222222222222';

vi.mock('../src/config/env.js', () => ({
  ENV: { JWT_SECRET: 'un-secreto-de-prueba-con-mas-de-32-caracteres-1234', N8N_WEBHOOK_ENVIAR_CONTENIDO: '' },
}));

const tablas: Record<string, { data: unknown; error?: { message: string } | null }> = {};
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, not: () => b, limit: () => b,
        then: (ok: (r: unknown) => unknown) => Promise.resolve(tablas[tabla] ?? { data: [] }).then(ok),
      };
      return b;
    },
  },
}));

const servicio = vi.hoisted(() => ({
  aprobarSolicitud: vi.fn(),
  rechazarSolicitud: vi.fn(),
  resumenSolicitud: vi.fn(),
}));
vi.mock('../src/services/solicitud-llave-service.js', () => ({
  ...servicio,
  contarPendientes: vi.fn(),
  crearSolicitud: vi.fn(),
  listarMias: vi.fn(),
  listarPorEstado: vi.fn(),
  obtenerSolicitud: vi.fn(),
}));
vi.mock('../src/services/edicion-autorizada-service.js', () => ({ esSuperadminEnBd: vi.fn(async () => false) }));

import router from '../src/routes/llaves-solicitudes.js';
import { configurarSecretosParaPruebas } from '../src/config/secretos.js';
import { resolverDesdeTelegram } from '../src/services/solicitud-llave-telegram.js';

const dto = (extra: Record<string, unknown> = {}) => ({
  id: UUID,
  solicitanteId: 'u-maria',
  solicitanteNombre: 'Maria Perez',
  entidadTipo: 'pago',
  entidadId: 'e1',
  descripcion: 'Pago PAG-0042 a Metales SA, 1.520 USD',
  motivo: 'monto mal digitado, era 1.250',
  estado: 'pendiente',
  aprobadorNombre: null,
  motivoRechazo: null,
  resueltaEn: null,
  createdAt: '2026-10-07T19:00:00.000Z',
  expiraEn: '2026-10-07T19:40:00.000Z',
  ...extra,
});

const DETALLE =
  '🔑 Solicitud de llave\nDe: Maria Perez\nPara editar: Pago PAG-0042 a Metales SA, 1.520 USD\nMotivo: monto mal digitado, era 1.250';

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  tablas.users = { data: [{ id: 'u-abraham', nombre: 'Abraham' }] };
  servicio.aprobarSolicitud.mockReset();
  servicio.rechazarSolicitud.mockReset();
  servicio.resumenSolicitud.mockReset();
  servicio.resumenSolicitud.mockResolvedValue({ ok: true, data: dto() });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('resolverDesdeTelegram', () => {
  it('aprobar: usa aprobarSolicitud con el superadmin como actor y responde con el texto actualizado', async () => {
    servicio.aprobarSolicitud.mockResolvedValue({
      ok: true,
      data: dto({ estado: 'aprobada', aprobadorNombre: 'Abraham', resueltaEn: '2026-10-07T19:25:00.000Z', expiraEn: '2026-10-07T19:40:00.000Z' }),
    });
    const r = await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:a:${UUID}` });
    expect(servicio.aprobarSolicitud).toHaveBeenCalledWith(UUID, 'u-abraham');
    expect(r).toEqual({
      ok: true,
      alerta: 'Llave aprobada ✅',
      nuevoTexto: `${DETALLE}\n\n✅ Aprobada por Abraham a las 15:25. Vence 15:40.`,
    });
  });

  it('rechazar: usa rechazarSolicitud con el motivo "Rechazada desde Telegram"', async () => {
    servicio.rechazarSolicitud.mockResolvedValue({
      ok: true,
      data: dto({ estado: 'rechazada', aprobadorNombre: 'Abraham', resueltaEn: '2026-10-07T19:25:00.000Z' }),
    });
    const r = await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:r:${UUID}` });
    expect(servicio.rechazarSolicitud).toHaveBeenCalledWith(UUID, 'u-abraham', 'Rechazada desde Telegram');
    expect(r).toEqual({
      ok: true,
      alerta: 'Solicitud rechazada ❌',
      nuevoTexto: `${DETALLE}\n\n❌ Rechazada por Abraham a las 15:25.`,
    });
  });

  it('nunca expone el código de la llave', async () => {
    servicio.aprobarSolicitud.mockResolvedValue({
      ok: true,
      data: dto({ estado: 'aprobada', aprobadorNombre: 'Abraham', resueltaEn: '2026-10-07T19:25:00.000Z', codigo: 'ABCDE-FGHJK' }),
    });
    const r = await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:a:${UUID}` });
    expect(JSON.stringify(r)).not.toContain('ABCDE');
  });

  it('usuario no vinculado o no superadmin (la consulta no devuelve filas): no ejecuta nada', async () => {
    tablas.users = { data: [] };
    const r = await resolverDesdeTelegram({ telegramUserId: '999', callbackData: `llave:a:${UUID}` });
    expect(r).toEqual({ ok: false, alerta: 'Solo un superadmin con Telegram vinculado puede resolver solicitudes.' });
    expect(servicio.aprobarSolicitud).not.toHaveBeenCalled();
    expect(servicio.rechazarSolicitud).not.toHaveBeenCalled();
  });

  it('columnas ausentes (error de la BD): se trata como no vinculado y no lanza', async () => {
    tablas.users = { data: null, error: { message: 'column users.telegram_chat_id does not exist' } };
    const r = await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:a:${UUID}` });
    expect(r.ok).toBe(false);
    expect(r.alerta).toContain('superadmin con Telegram vinculado');
  });

  it('ya resuelta: avisa quién la resolvió y reescribe el mensaje sin ejecutar', async () => {
    servicio.resumenSolicitud.mockResolvedValue({
      ok: true,
      data: dto({ estado: 'rechazada', aprobadorNombre: 'Rosa', resueltaEn: '2026-10-07T19:20:00.000Z' }),
    });
    const r = await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:a:${UUID}` });
    expect(r).toEqual({
      ok: false,
      alerta: 'Esta solicitud ya fue resuelta (rechazada) por Rosa.',
      nuevoTexto: `${DETALLE}\n\n❌ Rechazada por Rosa a las 15:20.`,
    });
    expect(servicio.aprobarSolicitud).not.toHaveBeenCalled();
  });

  it('carrera: el servicio devuelve 409 y se informa con el estado real', async () => {
    servicio.resumenSolicitud
      .mockResolvedValueOnce({ ok: true, data: dto() })
      .mockResolvedValueOnce({ ok: true, data: dto({ estado: 'aprobada', aprobadorNombre: 'Rosa', resueltaEn: '2026-10-07T19:25:00.000Z' }) });
    servicio.aprobarSolicitud.mockResolvedValue({ ok: false, error: 'La solicitud ya fue resuelta o venció.', codigo: 409 });
    const r = await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:a:${UUID}` });
    expect(r.ok).toBe(false);
    expect(r.alerta).toBe('Esta solicitud ya fue resuelta (aprobada) por Rosa.');
  });

  it('solicitud vencida sin aprobador: alerta de que ya no está pendiente', async () => {
    servicio.resumenSolicitud.mockResolvedValue({ ok: true, data: dto({ estado: 'expirada' }) });
    const r = await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:r:${UUID}` });
    expect(r.alerta).toBe('Esta solicitud ya no está pendiente (expirada).');
    expect(r.nuevoTexto).toBe(`${DETALLE}\n\n⌛ La solicitud venció sin resolverse.`);
  });

  it('solicitud inexistente o callback inválido', async () => {
    servicio.resumenSolicitud.mockResolvedValue({ ok: false, error: 'La solicitud no existe.', codigo: 404 });
    expect((await resolverDesdeTelegram({ telegramUserId: '111', callbackData: `llave:a:${UUID_OTRA}` })).alerta).toBe('La solicitud no existe.');
    for (const malo of ['llave:x:' + UUID, 'otra:a:' + UUID, 'llave:a:no-es-uuid', '']) {
      expect((await resolverDesdeTelegram({ telegramUserId: '111', callbackData: malo })).ok).toBe(false);
    }
  });
});

describe('POST /api/llaves-solicitudes/telegram-callback', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/llaves-solicitudes', router);
    await new Promise<void>(ok => { server = app.listen(0, '127.0.0.1', ok); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/llaves-solicitudes/telegram-callback`;
  });
  afterAll(() => new Promise<void>(ok => server.close(() => ok())));

  beforeEach(() => {
    process.env.N8N_WEBHOOK_SECRET = SECRETO;
    configurarSecretosParaPruebas({ lector: async () => null });
  });
  afterEach(() => {
    delete process.env.N8N_WEBHOOK_SECRET;
    configurarSecretosParaPruebas();
  });

  const llamar = (cabeceras: Record<string, string>, cuerpo: unknown) =>
    fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo) });
  const cuerpoValido = { telegramUserId: 111, callbackData: `llave:a:${UUID}`, chatId: 111, messageId: 7 };

  it('sin cabecera o con secreto incorrecto responde 401 sin tocar el servicio', async () => {
    expect((await llamar({}, cuerpoValido)).status).toBe(401);
    expect((await llamar({ 'x-pronoia-secret': 'otro' }, cuerpoValido)).status).toBe(401);
    expect((await llamar({ 'x-pronoia-secret': `${SECRETO}x` }, cuerpoValido)).status).toBe(401);
    expect(servicio.aprobarSolicitud).not.toHaveBeenCalled();
  });

  it('sin secreto configurado en el servidor rechaza todo', async () => {
    delete process.env.N8N_WEBHOOK_SECRET;
    expect((await llamar({ 'x-pronoia-secret': '' }, cuerpoValido)).status).toBe(401);
  });

  it('body inválido responde 400', async () => {
    const r = await llamar({ 'x-pronoia-secret': SECRETO }, { callbackData: 'llave:a:x' });
    expect(r.status).toBe(400);
  });

  it('con secreto correcto acepta telegramUserId numérico y devuelve 200 con el contrato', async () => {
    servicio.aprobarSolicitud.mockResolvedValue({
      ok: true,
      data: dto({ estado: 'aprobada', aprobadorNombre: 'Abraham', resueltaEn: '2026-10-07T19:25:00.000Z' }),
    });
    const r = await llamar({ 'x-pronoia-secret': SECRETO }, cuerpoValido);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json).toMatchObject({ ok: true, alerta: 'Llave aprobada ✅' });
    expect(json.nuevoTexto).toContain('✅ Aprobada por Abraham a las 15:25.');
  });

  it('usuario no superadmin: 200 con ok:false y la alerta', async () => {
    tablas.users = { data: [] };
    const r = await llamar({ 'x-pronoia-secret': SECRETO }, cuerpoValido);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, alerta: 'Solo un superadmin con Telegram vinculado puede resolver solicitudes.' });
  });
});
