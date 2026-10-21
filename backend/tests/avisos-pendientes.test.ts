import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/env.js', () => ({
  ENV: { N8N_WEBHOOK_GRUPO: 'https://n8n.test/grupo', N8N_WEBHOOK_ENVIAR_CONTENIDO: 'https://n8n.test/contenido' },
}));
vi.mock('../src/utils/n8n-headers.js', () => ({ cabecerasWebhookN8n: async () => ({ 'Content-Type': 'application/json' }) }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

interface Fila {
  id: string;
  destino: string;
  payload: Record<string, unknown>;
  intentos: number;
  proximo_intento: string;
}
const db = vi.hoisted(() => ({
  filas: [] as unknown[],
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; cambios: Record<string, unknown> }>,
  errorInsert: null as { message: string } | null,
  reservaOk: true,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      let cambios: Record<string, unknown> | null = null;
      let id = '';
      const b: Record<string, unknown> = {
        insert: async (f: Record<string, unknown>) => { db.inserts.push(f); return { error: db.errorInsert }; },
        select: () => b,
        update: (c: Record<string, unknown>) => { cambios = c; return b; },
        is: () => b,
        lte: () => b,
        order: () => b,
        limit: () => b,
        eq: (col: string, v: string) => { if (col === 'id') id = v; return b; },
        then: (ok: (r: unknown) => unknown) => {
          const soloReserva = cambios !== null && Object.keys(cambios).length === 1 && 'proximo_intento' in cambios;
          if (soloReserva) return Promise.resolve({ data: db.reservaOk ? [{ id }] : [], error: null }).then(ok);
          if (cambios) { db.updates.push({ id, cambios }); return Promise.resolve({ error: null }).then(ok); }
          return Promise.resolve({ data: db.filas, error: null }).then(ok);
        },
      };
      return b;
    },
  },
}));

const { encolarAviso, reprocesarAvisosPendientes, esperaTrasIntentos, MAX_INTENTOS_COLA } =
  await import('../src/services/avisos-pendientes-service.js');
const { enviarAvisoN8n } = await import('../src/services/n8n-aviso.js');

const AHORA = new Date('2026-10-16T12:00:00Z');
const fila = (o: Partial<Fila> = {}): Fila => ({
  id: 'a1', destino: 'contenido', payload: { accion: 'mensaje' }, intentos: 1, proximo_intento: AHORA.toISOString(), ...o,
});
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db.filas = [];
  db.inserts.length = 0;
  db.updates.length = 0;
  db.errorInsert = null;
  db.reservaOk = true;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('encolarAviso', () => {
  it('guarda destino, payload e intentos con próximo intento futuro', async () => {
    expect(await encolarAviso('grupo', { texto: 'hola' }, 'n8n respondió 502', 3, AHORA)).toBe(true);
    expect(db.inserts[0]).toMatchObject({ destino: 'grupo', payload: { texto: 'hola' }, intentos: 3, ultimo_error: 'n8n respondió 502' });
    expect(new Date(db.inserts[0].proximo_intento as string).getTime()).toBeGreaterThan(AHORA.getTime());
  });
  it('nunca lanza: devuelve false si la BD falla', async () => {
    db.errorInsert = { message: 'relation does not exist' };
    expect(await encolarAviso('grupo', {}, 'x', 1)).toBe(false);
  });
});

describe('enviarAvisoN8n', () => {
  it('encola cuando los reintentos agotan un fallo transitorio, sin secretos en el payload', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    const r = await enviarAvisoN8n({ destino: 'contenido', evento: 't', cuerpo: { accion: 'mensaje' }, opciones: { maxIntentos: 1 } });
    expect(r.ok).toBe(false);
    expect(db.inserts).toHaveLength(1);
    expect(JSON.stringify(db.inserts[0])).not.toMatch(/secret/i);
  });
  it('no encola un 4xx ni cuando encolar es false', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 400 }));
    await enviarAvisoN8n({ destino: 'contenido', evento: 't', cuerpo: {}, opciones: { maxIntentos: 1 } });
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await enviarAvisoN8n({ destino: 'contenido', evento: 't', cuerpo: {}, encolar: false, opciones: { maxIntentos: 1 } });
    expect(db.inserts).toHaveLength(0);
  });
  it('no encola si el envío funciona', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect((await enviarAvisoN8n({ destino: 'grupo', evento: 't', cuerpo: {} })).ok).toBe(true);
    expect(db.inserts).toHaveLength(0);
  });
});

describe('reprocesarAvisosPendientes', () => {
  it('marca enviado el aviso que n8n ahora acepta', async () => {
    db.filas = [fila()];
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const r = await reprocesarAvisosPendientes(() => AHORA);
    expect(r).toMatchObject({ revisados: 1, enviados: 1 });
    expect(db.updates[0].cambios).toMatchObject({ enviado_en: AHORA.toISOString(), intentos: 2 });
  });
  it('reprograma con backoff si sigue fallando de forma transitoria', async () => {
    db.filas = [fila({ intentos: 2 })];
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    const r = await reprocesarAvisosPendientes(() => AHORA);
    expect(r.reprogramados).toBe(1);
    const c = db.updates[0].cambios;
    expect(c.intentos).toBe(3);
    expect(new Date(c.proximo_intento as string).getTime() - AHORA.getTime()).toBe(esperaTrasIntentos(3));
  });
  it('marca fallido al llegar al máximo de intentos o ante un 4xx', async () => {
    db.filas = [fila({ id: 'a', intentos: MAX_INTENTOS_COLA - 1 }), fila({ id: 'b', intentos: 1 })];
    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(new Response('', { status: 400 }));
    const r = await reprocesarAvisosPendientes(() => AHORA);
    expect(r.fallidos).toBe(2);
    expect(db.updates.every(u => 'fallido_en' in u.cambios)).toBe(true);
  });
  it('omite la fila si otra corrida ya la reservó', async () => {
    db.filas = [fila()];
    db.reservaOk = false;
    const r = await reprocesarAvisosPendientes(() => AHORA);
    expect(r).toMatchObject({ revisados: 1, omitidos: 1, enviados: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('esperaTrasIntentos', () => {
  it('crece y tiene tope', () => {
    expect(esperaTrasIntentos(2)).toBeGreaterThan(esperaTrasIntentos(1));
    expect(esperaTrasIntentos(50)).toBe(esperaTrasIntentos(20));
  });
});
