import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  ENV: { N8N_WEBHOOK_GRUPO: 'https://n8n.test/grupo', N8N_WEBHOOK_ENVIAR_CONTENIDO: 'https://n8n.test/contenido' },
}));
vi.mock('../src/utils/n8n-headers.js', () => ({
  cabecerasWebhookN8n: async () => ({ 'Content-Type': 'application/json', 'X-Pronoia-Secret': 's' }),
}));

const { enviarN8n, esStatusTransitorio, urlDeDestino } = await import('../src/services/n8n-cliente.js');

let fetchMock: ReturnType<typeof vi.fn>;
const esperar = vi.fn(async () => undefined);
const respuesta = (status: number) => new Response('{}', { status });

beforeEach(() => {
  esperar.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('enviarN8n', () => {
  it('éxito al primer intento: 1 intento, sin esperas, con cabecera de secreto', async () => {
    fetchMock.mockResolvedValue(respuesta(200));
    const r = await enviarN8n('https://n8n.test/x', { a: 1 }, { esperar });
    expect(r).toMatchObject({ ok: true, status: 200, intentos: 1 });
    expect(esperar).not.toHaveBeenCalled();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Pronoia-Secret']).toBe('s');
    expect(init.body).toBe('{"a":1}');
  });

  it('reintenta un 5xx y se recupera', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(502)).mockResolvedValueOnce(respuesta(200));
    const r = await enviarN8n('https://n8n.test/x', {}, { esperar });
    expect(r).toMatchObject({ ok: true, intentos: 2 });
    expect(esperar).toHaveBeenCalledTimes(1);
  });

  it('reintenta errores de red y 429, y agota los intentos como transitorio', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(respuesta(429))
      .mockResolvedValueOnce(respuesta(503));
    const r = await enviarN8n('https://n8n.test/x', {}, { esperar });
    expect(r).toMatchObject({ ok: false, status: 503, intentos: 3, transitorio: true });
  });

  it('un fallo de red sin respuesta devuelve status null', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    const r = await enviarN8n('https://n8n.test/x', {}, { esperar });
    expect(r).toMatchObject({ ok: false, status: null, intentos: 3, transitorio: true, error: 'timeout' });
  });

  it('NO reintenta un 4xx', async () => {
    fetchMock.mockResolvedValue(respuesta(400));
    const r = await enviarN8n('https://n8n.test/x', {}, { esperar });
    expect(r).toMatchObject({ ok: false, status: 400, intentos: 1, transitorio: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('con timeout largo reintenta una sola vez; maxIntentos explícito manda', async () => {
    fetchMock.mockResolvedValue(respuesta(500));
    expect((await enviarN8n('https://n8n.test/x', {}, { esperar, timeoutMs: 30_000 })).intentos).toBe(2);
    expect((await enviarN8n('https://n8n.test/x', {}, { esperar, maxIntentos: 1 })).intentos).toBe(1);
  });
});

describe('utilidades', () => {
  it('clasifica status transitorios', () => {
    expect([500, 502, 429, 408].every(esStatusTransitorio)).toBe(true);
    expect([400, 401, 404, 422].some(esStatusTransitorio)).toBe(false);
  });
  it('resuelve la URL por destino', () => {
    expect(urlDeDestino('grupo')).toBe('https://n8n.test/grupo');
    expect(urlDeDestino('contenido')).toBe('https://n8n.test/contenido');
  });
});
