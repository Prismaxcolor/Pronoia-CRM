import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (t: string) => {
    if (!t.startsWith('u')) throw new Error('jwt');
    return { sub: t, email: 'x', rol: 'admin' };
  },
}));
const rpc = vi.fn(async (_nombre: string) => ({ error: null }));
vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: { rpc } }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { operacionesClienteLimiter, LIMITE_OPERACIONES_CLIENTE_POR_MINUTO } = await import('../src/middlewares/rate-limit.js');
const { limpiezaOportunista, PROBABILIDAD_LIMPIEZA } = await import('../src/services/operaciones-limpieza.js');
const { default: express } = await import('express');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/proveedores', operacionesClienteLimiter);
app.all('/api/proveedores', (_req, res) => { res.status(201).json({ ok: true }); });
const servidor = await new Promise<import('node:http').Server>(res => { const s = app.listen(0, () => res(s)); });
const URL_BASE = `http://127.0.0.1:${(servidor.address() as { port: number }).port}/api/proveedores`;
afterAll(() => new Promise<void>(res => { servidor.close(() => res()); }));

const post = (token: string, cuerpo: object) =>
  fetch(URL_BASE, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(cuerpo) });

describe('operacionesClienteLimiter', () => {
  it('limita por usuario las escrituras con clientRequestId y no afecta a otro usuario ni a otras peticiones', async () => {
    const LIMITE = LIMITE_OPERACIONES_CLIENTE_POR_MINUTO;
    expect(LIMITE).toBe(120);
    for (let i = 0; i < LIMITE; i += 1) {
      const r = await post('uA', { clientRequestId: crypto.randomUUID() });
      expect(r.status).toBe(201);
    }
    const excedida = await post('uA', { clientRequestId: crypto.randomUUID() });
    expect(excedida.status).toBe(429);
    expect(await excedida.json()).toMatchObject({ reintentar: true });

    // otro usuario no se ve afectado
    expect((await post('uB', { clientRequestId: crypto.randomUUID() })).status).toBe(201);
    // sin clientRequestId no cuenta (flujo de siempre)
    expect((await post('uA', { nombre: 'x' })).status).toBe(201);
    // las lecturas no cuentan
    expect((await fetch(URL_BASE, { headers: { authorization: 'Bearer uA' } })).status).toBe(201);
  });
});

describe('limpiezaOportunista', () => {
  it('lanza la limpieza solo cuando el azar cae bajo la probabilidad', async () => {
    rpc.mockClear();
    expect(limpiezaOportunista(() => 0.5)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(limpiezaOportunista(() => PROBABILIDAD_LIMPIEZA / 2)).toBe(true);
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledWith('limpiar_operaciones_cliente');
  });

  it('un fallo de la limpieza nunca propaga el error', async () => {
    rpc.mockRejectedValueOnce(new Error('boom'));
    expect(() => limpiezaOportunista(() => 0)).not.toThrow();
    await new Promise(r => setTimeout(r, 5));
  });
});
