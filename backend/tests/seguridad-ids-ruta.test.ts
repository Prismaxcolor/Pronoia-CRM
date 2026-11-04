import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** N3/N7/N9 a través de los routers reales: ids de ruta no UUID, capturas viejas y tipos heredados de uploads. */

const llamadas = vi.hoisted(() => ({ rpc: vi.fn(), tablas: [] as string[] }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      llamadas.tablas.push(tabla);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: tabla === 'users' ? { activo: true, rol: 'superadmin', permisos: [] } : null, error: null }),
      };
      return b;
    },
    rpc: llamadas.rpc,
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: () => ({ sub: 'u1', email: 'a@x.test', rol: 'superadmin' }),
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: tomaFisica } = await import('../src/routes/toma-fisica.js');
const { default: transformaciones } = await import('../src/routes/transformaciones.js');
const { default: tickets } = await import('../src/routes/tickets-pesaje.js');
const { default: traslados } = await import('../src/routes/traslados.js');
const { default: packingLists } = await import('../src/routes/packing-lists.js');
const { default: uploads, TAMANO_MAXIMO } = await import('../src/routes/uploads.js');
const { tipoDeRecurso, TIPO_OPERACION } = await import('../src/services/operaciones-idempotentes-cola.js');
const { completarTicketIdempotente } = await import('../src/services/operaciones-idempotentes.js');
const { capturaDemasiadoAntigua, MAX_ANTIGUEDAD_CAPTURA_MS } = await import('../src/middlewares/rechazar-captura-antigua.js');

const UUID = '11111111-1111-4111-8111-111111111111';
const REQ_ID = '22222222-2222-4222-8222-222222222222';
const LARGO = 'a'.repeat(8000);
const AUTH = { Authorization: 'Bearer t', 'Content-Type': 'application/json' };

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/toma-fisica', tomaFisica);
  app.use('/api/transformaciones', transformaciones);
  app.use('/api/tickets-pesaje', tickets);
  app.use('/api/traslados', traslados);
  app.use('/api/packing-lists', packingLists);
  app.use('/api/uploads', uploads);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });
beforeEach(() => { llamadas.rpc.mockReset(); llamadas.tablas.length = 0; });

const peticion = (metodo: string, ruta: string, cuerpo: unknown = { clientRequestId: REQ_ID }) =>
  fetch(base + ruta, { method: metodo, headers: AUTH, body: JSON.stringify(cuerpo) });

const RUTAS: Array<[string, string, string]> = [
  ['POST', '/api/toma-fisica/', '/pesajes'],
  ['PATCH', '/api/transformaciones/', '/completar-ferroso'],
  ['PATCH', '/api/transformaciones/', '/completar-pcb'],
  ['PATCH', '/api/transformaciones/', '/completar-mixta'],
  ['PATCH', '/api/tickets-pesaje/', '/completar'],
  ['PATCH', '/api/traslados/', '/completar'],
];

describe('N3: id de ruta no UUID', () => {
  for (const [metodo, prefijo, sufijo] of RUTAS) {
    it(`${metodo} ${prefijo}:id${sufijo} responde 400 con id largo y no escribe`, async () => {
      const r = await peticion(metodo, `${prefijo}${LARGO}${sufijo}`);
      expect(r.status).toBe(400);
      expect(llamadas.rpc).not.toHaveBeenCalled();
      expect(llamadas.tablas).not.toContain('operaciones_cliente');
    });
    it(`${metodo} ${prefijo}:id${sufijo} responde 400 con id corto no UUID`, async () => {
      const r = await peticion(metodo, `${prefijo}abc${sufijo}`);
      expect(r.status).toBe(400);
      expect(llamadas.rpc).not.toHaveBeenCalled();
    });
  }

  it('PUT /api/packing-lists/:id responde 400 con id largo y no escribe', async () => {
    const r = await peticion('PUT', `/api/packing-lists/${LARGO}`);
    expect(r.status).toBe(400);
    expect(llamadas.rpc).not.toHaveBeenCalled();
  });

  it('tipoDeRecurso rechaza lo que no sea UUID y acepta un UUID', () => {
    expect(() => tipoDeRecurso(TIPO_OPERACION.packingListEditar, LARGO)).toThrow();
    expect(() => tipoDeRecurso(TIPO_OPERACION.packingListEditar, 'x:y')).toThrow();
    expect(tipoDeRecurso(TIPO_OPERACION.packingListEditar, UUID)).toBe(`packing_list_editar:${UUID}`);
  });

  it('completarTicketIdempotente con id no UUID falla antes de tocar la BD', async () => {
    await expect(completarTicketIdempotente(LARGO, { clientRequestId: REQ_ID } as never, 'u1')).rejects.toThrow();
    expect(llamadas.rpc).not.toHaveBeenCalled();
  });
});

describe('N7: capturas de más de 29 días', () => {
  const vieja = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  const reciente = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

  it('helper: límite de 29 días', () => {
    const ahora = Date.parse('2026-10-07T00:00:00Z');
    expect(capturaDemasiadoAntigua(new Date(ahora - MAX_ANTIGUEDAD_CAPTURA_MS - 1000).toISOString(), ahora)).toBe(true);
    expect(capturaDemasiadoAntigua(new Date(ahora - MAX_ANTIGUEDAD_CAPTURA_MS + 1000).toISOString(), ahora)).toBe(false);
    expect(capturaDemasiadoAntigua(undefined, ahora)).toBe(false);
    expect(capturaDemasiadoAntigua('basura', ahora)).toBe(false);
  });

  for (const [metodo, prefijo, sufijo] of RUTAS.slice(1)) {
    it(`${metodo} ${prefijo}:id${sufijo} da 409 claro con capturadoEn de 40 días y no escribe`, async () => {
      const r = await peticion(metodo, `${prefijo}${UUID}${sufijo}`, { clientRequestId: REQ_ID, capturadoEn: vieja });
      expect(r.status).toBe(409);
      expect(((await r.json()) as { error: string }).error).toMatch(/29 días/);
      expect(llamadas.rpc).not.toHaveBeenCalled();
    });
  }

  it('PUT packing-lists da 409 con captura vieja', async () => {
    const r = await peticion('PUT', `/api/packing-lists/${UUID}`, { clientRequestId: REQ_ID, capturadoEn: vieja });
    expect(r.status).toBe(409);
    expect(llamadas.rpc).not.toHaveBeenCalled();
  });

  it('una captura reciente no se rechaza por antigüedad', async () => {
    const r = await peticion('PATCH', `/api/tickets-pesaje/${UUID}/completar`, { clientRequestId: REQ_ID, capturadoEn: reciente });
    expect(r.status).not.toBe(409);
  });

  it('sin clientRequestId no aplica el rechazo', async () => {
    const r = await peticion('PATCH', `/api/tickets-pesaje/${UUID}/completar`, { capturadoEn: vieja });
    expect(r.status).not.toBe(409);
  });
});

describe('N9: uploads', () => {
  it('tipos heredados (constructor, toString, __proto__) dan 404', async () => {
    for (const t of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const r = await fetch(`${base}/api/uploads/${t}`, { method: 'POST', headers: { Authorization: 'Bearer t' } });
      expect(r.status).toBe(404);
    }
  });

  it('un tipo propio válido no da 404', async () => {
    const r = await fetch(`${base}/api/uploads/productos`, { method: 'POST', headers: { Authorization: 'Bearer t' } });
    expect(r.status).not.toBe(404);
  });

  it('el límite del servidor es 6 MB, igual al del cliente', () => {
    expect(TAMANO_MAXIMO).toBe(6 * 1024 * 1024);
  });
});
