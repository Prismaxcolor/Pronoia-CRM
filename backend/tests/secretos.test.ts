import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { obtenerSecreto, configurarSecretosParaPruebas, TTL_SECRETOS_MS } from '../src/config/secretos';
import { responderChat, leerEntornoIA } from '../src/services/asistente-service';
import { cabecerasWebhookN8n } from '../src/utils/n8n-headers';

const CLAVE = 'CLAVE_DE_PRUEBA';
let ahora = 0;

beforeEach(() => {
  ahora = 1_000_000;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  configurarSecretosParaPruebas();
});

describe('obtenerSecreto', () => {
  it('la variable de entorno manda y no consulta la tabla', async () => {
    const lector = vi.fn(async () => 'de-tabla');
    configurarSecretosParaPruebas({ lector });
    vi.stubEnv(CLAVE, 'de-env');
    expect(await obtenerSecreto(CLAVE)).toBe('de-env');
    expect(lector).not.toHaveBeenCalled();
  });

  it('env vacía cae a la tabla', async () => {
    configurarSecretosParaPruebas({ lector: async () => 'de-tabla' });
    vi.stubEnv(CLAVE, '');
    expect(await obtenerSecreto(CLAVE)).toBe('de-tabla');
  });

  it('cachea el valor hasta el TTL y luego vuelve a consultar', async () => {
    const lector = vi.fn(async () => 'v1');
    configurarSecretosParaPruebas({ lector, ahora: () => ahora });
    expect(await obtenerSecreto(CLAVE)).toBe('v1');
    ahora += TTL_SECRETOS_MS - 1;
    await obtenerSecreto(CLAVE);
    expect(lector).toHaveBeenCalledTimes(1);
    ahora += 2;
    await obtenerSecreto(CLAVE);
    expect(lector).toHaveBeenCalledTimes(2);
  });

  it('cachea también los que no existen', async () => {
    const lector = vi.fn(async () => null);
    configurarSecretosParaPruebas({ lector });
    expect(await obtenerSecreto(CLAVE)).toBeUndefined();
    expect(await obtenerSecreto(CLAVE)).toBeUndefined();
    expect(lector).toHaveBeenCalledTimes(1);
  });

  it('si la consulta falla devuelve undefined sin lanzar ni loguear el valor', async () => {
    const lector = vi.fn(async () => { throw new Error('db caida'); });
    configurarSecretosParaPruebas({ lector });
    await expect(obtenerSecreto(CLAVE)).resolves.toBeUndefined();
    const logs = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]);
    expect(logs).toContain('secreto_lectura_error');
  });

  it('en modo test sin lector inyectado no toca la base (solo env)', async () => {
    configurarSecretosParaPruebas();
    expect(process.env.NODE_ENV).toBe('test');
    expect(await obtenerSecreto(CLAVE)).toBeUndefined();
  });
});

describe('asistente-service con secretos de la tabla', () => {
  it('leerEntornoIA mezcla env y tabla (env gana)', async () => {
    configurarSecretosParaPruebas({
      lector: async c => ({ ASISTENTE_IA_PROVIDER: 'openai', ASISTENTE_IA_API_KEY: 'k-tabla', ASISTENTE_IA_MODEL: 'm-tabla' } as Record<string, string>)[c] ?? null,
    });
    vi.stubEnv('ASISTENTE_IA_MODEL', 'm-env');
    expect(await leerEntornoIA()).toEqual({
      ASISTENTE_IA_PROVIDER: 'openai', ASISTENTE_IA_API_KEY: 'k-tabla', ASISTENTE_IA_MODEL: 'm-env',
    });
  });

  it('responderChat usa la clave guardada en la tabla como Authorization del proveedor', async () => {
    configurarSecretosParaPruebas({
      lector: async c => ({ ASISTENTE_IA_PROVIDER: 'openai', ASISTENTE_IA_API_KEY: 'k-tabla' } as Record<string, string>)[c] ?? null,
    });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hola' } }] }), { status: 200 }));
    const r = await responderChat(
      { mensaje: 'hola', historial: [], pagina: 'otra', personalidad: 'amigable', nombre: '' },
      { fetchFn },
    );
    expect(r.origen).toBe('ia');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('api.openai.com');
    expect(JSON.stringify(init.headers)).toContain('Bearer k-tabla');
  });
});

describe('cabecerasWebhookN8n con secreto de la tabla', () => {
  it('manda X-Pronoia-Secret leído de la tabla; sin secreto no manda header', async () => {
    configurarSecretosParaPruebas({ lector: async () => 'sec-tabla' });
    expect(await cabecerasWebhookN8n()).toMatchObject({ 'X-Pronoia-Secret': 'sec-tabla' });
    configurarSecretosParaPruebas({ lector: async () => null });
    expect(await cabecerasWebhookN8n()).toEqual({ 'Content-Type': 'application/json' });
  });
});
