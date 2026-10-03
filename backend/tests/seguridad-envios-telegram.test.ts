import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

import { slugArchivo, nombreArchivoSeguro } from '../src/utils/nombre-archivo.js';
import { validarUuidParam } from '../src/middlewares/validate-uuid-param.js';
import { estadoCuentaTelegramLimiter } from '../src/middlewares/rate-limit.js';
import { logger } from '../src/utils/logger.js';
import { notificarTicket } from '../src/services/telegram-eventos-service.js';
import { generarNotaPdf, nombreArchivoEstadoCuenta, type NotaParaPdf } from '../src/services/document-generator-financiero.js';

// --- H1: URLs por defecto de n8n solo en producción ------------------------------------
describe('ENV: webhooks de n8n', () => {
  const CLAVES = ['N8N_WEBHOOK_ENVIAR_DOCUMENTO', 'N8N_WEBHOOK_ENVIAR_CONTENIDO', 'N8N_WEBHOOK_PORTAL_LOGIN', 'N8N_WEBHOOK_GRUPO'] as const;

  async function cargarEnv(nodeEnv: string, extra: Record<string, string> = {}) {
    vi.resetModules();
    for (const c of CLAVES) vi.stubEnv(c, '');
    vi.stubEnv('N8N_WEBHOOK_SECRET', '');
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
    vi.stubEnv('CORS_ORIGINS', 'https://app.test');
    for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
    return (await import('../src/config/env.js')).ENV;
  }
  afterEach(() => vi.unstubAllEnvs());

  it('development y test: los cuatro webhooks quedan vacíos (nada real desde local/CI)', async () => {
    for (const modo of ['development', 'test']) {
      const env = await cargarEnv(modo);
      for (const c of CLAVES) expect(env[c], `${c} en ${modo}`).toBe('');
    }
  });

  it('producción: usa la URL de n8n por defecto', async () => {
    const env = await cargarEnv('production');
    for (const c of CLAVES) expect(env[c]).toMatch(/^https:\/\/evo-n8n-pronoia\.xgwlbt\.easypanel\.host\/webhook\/.+/);
  });

  it('una variable explícita manda en cualquier entorno', async () => {
    const env = await cargarEnv('development', { N8N_WEBHOOK_GRUPO: 'https://n8n.local/grupo' });
    expect(env.N8N_WEBHOOK_GRUPO).toBe('https://n8n.local/grupo');
  });

  it('N8N_WEBHOOK_SECRET no tiene valor por defecto', async () => {
    expect((await cargarEnv('production')).N8N_WEBHOOK_SECRET).toBe('');
  });
});

// --- H1(b): header X-Pronoia-Secret ----------------------------------------------------
describe('cabecerasWebhookN8n', () => {
  afterEach(() => vi.doUnmock('../src/config/env.js'));

  async function cabeceras(secreto: string) {
    vi.resetModules();
    vi.doMock('../src/config/env.js', () => ({ ENV: { N8N_WEBHOOK_SECRET: secreto } }));
    return (await import('../src/utils/n8n-headers.js')).cabecerasWebhookN8n();
  }

  it('sin secreto: no se envía el header (retrocompatible)', async () => {
    expect(await cabeceras('')).toEqual({ 'Content-Type': 'application/json' });
  });

  it('con secreto: se envía en X-Pronoia-Secret', async () => {
    expect(await cabeceras('abc123')).toEqual({ 'Content-Type': 'application/json', 'X-Pronoia-Secret': 'abc123' });
  });
});

// --- M3: nombres de archivo seguros ----------------------------------------------------
describe('slugArchivo / nombreArchivoSeguro', () => {
  const CLAVE_VALIDA = /^[a-z0-9._-]+$/;

  it.each([
    ['KAGUIGÜA', 'kaguigua'],
    ['JONATAN BRICEÑO', 'jonatan-briceno'],
    ['Napoleón Dávila', 'napoleon-davila'],
    ['Jhon Peña', 'jhon-pena'],
  ])('proveedor real %s -> %s', (nombre, esperado) => {
    expect(slugArchivo(nombre)).toBe(esperado);
    const archivo = nombreArchivoEstadoCuenta({ entidad: { id: 'x', tipo: 'proveedor', nombre } } as never, '2026-10-03');
    expect(archivo).toBe(`estado-de-cuenta-${esperado}-2026-10-03.pdf`);
    expect(archivo).toMatch(CLAVE_VALIDA);
  });

  it('quita caracteres de ruta y colapsa guiones y puntos', () => {
    const s = slugArchivo('../../etc/pass wd\\x//  --  y..z');
    expect(s).toMatch(CLAVE_VALIDA);
    expect(s).not.toMatch(/[/\\]|\.\./);
    expect(s).not.toMatch(/--/);
    expect(s.startsWith('.') || s.startsWith('-')).toBe(false);
  });

  it('largo máximo 80 y valor de respaldo si queda vacío', () => {
    expect(slugArchivo('a'.repeat(300))).toHaveLength(80);
    expect(slugArchivo('???')).toBe('archivo');
  });

  it('nombreArchivoSeguro conserva la extensión dentro del máximo', () => {
    const n = nombreArchivoSeguro(`${'ñ'.repeat(200)}.PDF`);
    expect(n.length).toBeLessThanOrEqual(80);
    expect(n.endsWith('.pdf')).toBe(true);
    expect(nombreArchivoSeguro('Ticket Compra/0057 ñ.pdf')).toBe('ticket-compra-0057-n.pdf');
  });
});

// --- H2: el PDF de la nota no lleva el motivo interno ---------------------------------
describe('PDF de nota sin motivos internos', () => {
  const nota: NotaParaPdf = {
    id: 'abcdef12-0000-4000-8000-000000000000', codigo: 'NC-0004', tipo: 'credito', monto: 50, motivo: 'MOTIVOSECRETOINTERNO',
    anulada: true, fecha: '2026-10-03', anuladaAt: '2026-10-04T10:00:00Z', anuladaMotivo: 'ANULACIONSECRETA', facturaAsociada: null,
  };

  it('no escribe motivo ni motivo de anulación en el documento', () => {
    const texto = generarNotaPdf(nota, 'Proveedor SA', true).toString('latin1');
    expect(texto).toContain('Proveedor SA'); // comprueba que el PDF es legible en texto plano
    expect(texto).not.toContain('MOTIVOSECRETOINTERNO');
    expect(texto).not.toContain('ANULACIONSECRETA');
    expect(texto).not.toContain('Motivo');
  });
});

// --- M2: los avisos nunca rompen la operación ------------------------------------------
describe('avisos de Telegram aislados', () => {
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it('un dato que revienta en la parte síncrona solo se loguea, no lanza', () => {
    const ticketRoto = { estado: 'completo', entidadId: 'E1', get tipo(): string { throw new Error('dato roto'); } };
    expect(() => notificarTicket(ticketRoto as never)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ evento: 'telegram_evento_error_sincrono', aviso: 'notificarTicket' }));
  });
});

// --- M1: validación de UUID y límite de 1 envío por minuto -------------------------------
describe('endpoint de envío de estado de cuenta: UUID y límite', () => {
  let servidor: ReturnType<ReturnType<typeof express>['listen']>;
  let base: string;
  let usuario = 'U1';
  let envios = 0;
  let responderError = false;

  beforeEach(async () => {
    envios = 0;
    responderError = false;
    const app = express();
    app.use((req, _res, next) => { req.user = { sub: usuario } as never; next(); });
    app.post('/:id/estado-cuenta/enviar-telegram', validarUuidParam('id'), estadoCuentaTelegramLimiter, (_req, res) => {
      if (responderError) { res.status(409).json({ error: 'sin vincular' }); return; }
      envios++;
      res.status(202).json({ ok: true });
    });
    servidor = app.listen(0);
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>(r => servidor.close(() => r())));

  const post = (id: string) => fetch(`${base}/${id}/estado-cuenta/enviar-telegram`, { method: 'POST' });
  const ID_A = '616bcc24-30c4-4f7c-b18c-ead15b040fe9';
  const ID_B = '11111111-1111-4111-8111-111111111111';

  it('id que no es UUID: 400', async () => {
    const r = await post('no-es-uuid');
    expect(r.status).toBe(400);
    expect(envios).toBe(0);
  });

  it('segundo envío al mismo usuario+entidad dentro del minuto: 429 con mensaje claro', async () => {
    usuario = 'U-limite-1';
    expect((await post(ID_A)).status).toBe(202);
    const r = await post(ID_A);
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: string }).error).toMatch(/Espera un minuto/);
    expect(envios).toBe(1);
  });

  it('otra entidad u otro usuario tienen su propio cupo', async () => {
    usuario = 'U-limite-2';
    expect((await post(ID_A)).status).toBe(202);
    expect((await post(ID_B)).status).toBe(202);
    usuario = 'U-limite-3';
    expect((await post(ID_A)).status).toBe(202);
  });

  it('un envío fallido (409 sin vincular) no gasta el cupo', async () => {
    usuario = 'U-limite-4';
    responderError = true;
    expect((await post(ID_A)).status).toBe(409);
    responderError = false;
    expect((await post(ID_A)).status).toBe(202);
  });
});
