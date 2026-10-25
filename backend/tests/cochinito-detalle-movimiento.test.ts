import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * GET /api/cochinito/movimientos/:id a través del router real: autenticación, permiso
 * cochinito:ver, validación del id, 404 y nombres resueltos (el tercero solo con permiso).
 */

const usuarios: Record<string, { rol: string; permisos: unknown; activo: boolean }> = {};
const tablas: Record<string, Array<Record<string, unknown>>> = {};

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      let id: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (_c: string, v: string) => { id = v; return b; },
        maybeSingle: async () => {
          if (tabla === 'users' && id && usuarios[id]) {
            const u = usuarios[id];
            const fila = (tablas.users ?? []).find(f => f.id === id);
            return { data: { ...u, ...(fila ?? {}) }, error: null };
          }
          const fila = (tablas[tabla] ?? []).find(f => f.id === id) ?? null;
          return { data: fila, error: null };
        },
      };
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));

// Este test no trata el acceso por banca (ver banca-acceso.test.ts): todas las bancas permitidas.
vi.mock('../src/services/banca-acceso-service.js', () => ({
  bancasPermitidas: async () => null,
  idsBancasDeMovimiento: async () => [],
}));

vi.mock('../src/services/movimiento-edicion-service.js', () => ({
  anularMovimientoBanca: vi.fn(),
  editarMovimientoBanca: vi.fn(),
}));

const { default: cochinitoRouter } = await import('../src/routes/cochinito.js');

const MOV = '11111111-1111-4111-8111-111111111111';
const BANCA_A = '22222222-2222-4222-8222-222222222222';
const BANCA_B = '33333333-3333-4333-8333-333333333333';
const PROV = '44444444-4444-4444-8444-444444444444';

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cochinito', cochinitoRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.admin = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.soloWallet = { rol: 'trabajador', permisos: [{ recurso: 'cochinito', accion: 'ver' }], activo: true };
  usuarios.sinPermiso = { rol: 'trabajador', permisos: [{ recurso: 'tickets', accion: 'ver' }], activo: true };
  tablas.users = [{ id: 'admin', nombre: 'Ana' }, { id: 'soloWallet', nombre: 'Luis' }];
  tablas.bancas = [{ id: BANCA_A, nombre: 'Banesco' }, { id: BANCA_B, nombre: 'Caja' }];
  tablas.proveedores = [{ id: PROV, nombre: 'Proveedor Uno' }];
  tablas.clientes = [];
  tablas.movimientos = [{
    id: MOV, tipo: 'egreso', monto: '100', moneda: 'USD', descripcion: 'Pago de flete', banca_origen_id: BANCA_A,
    banca_destino_id: BANCA_B, fecha: '2026-10-07', referencia: 'R-1', registrado_por: 'admin', proveedor_id: PROV,
    cliente_id: null, monto_usd: '100', monto_destino: null, creado_en: '2026-10-07T18:05:00Z', subtipo: null, numero: 12,
    grupo_id: null, comprobantes: ['https://x.test/a.png'], anulado: true, anulado_motivo: 'Duplicado',
    anulado_at: '2026-10-08T12:00:00Z', anulado_por: 'soloWallet',
  }];
});

async function llamar(ruta: string, usuario: string | null) {
  const res = await fetch(`${base}${ruta}`, { headers: usuario ? { Authorization: `Bearer ${usuario}` } : {} });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe('GET /api/cochinito/movimientos/:id', () => {
  it('sin sesión responde 401', async () => {
    expect((await llamar(`/api/cochinito/movimientos/${MOV}`, null)).status).toBe(401);
  });

  it('sin permiso cochinito:ver responde 403', async () => {
    expect((await llamar(`/api/cochinito/movimientos/${MOV}`, 'sinPermiso')).status).toBe(403);
  });

  it('un id que no es UUID responde 400', async () => {
    expect((await llamar('/api/cochinito/movimientos/abc', 'admin')).status).toBe(400);
  });

  it('un movimiento inexistente responde 404', async () => {
    const r = await llamar('/api/cochinito/movimientos/99999999-9999-4999-8999-999999999999', 'admin');
    expect(r.status).toBe(404);
  });

  it('devuelve el movimiento con bancas, tercero, autor y anulación resueltos', async () => {
    const r = await llamar(`/api/cochinito/movimientos/${MOV}`, 'admin');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      bancaOrigenNombre: 'Banesco',
      bancaDestinoNombre: 'Caja',
      proveedorNombre: 'Proveedor Uno',
      clienteNombre: null,
      registradoPorNombre: 'Ana',
      anuladoPorNombre: 'Luis',
      movimiento: { id: MOV, numero: 12, monto: 100, anulado: true, anuladoMotivo: 'Duplicado', comprobantes: ['https://x.test/a.png'] },
    });
  });

  it('sin permiso de ver proveedores no revela el nombre del tercero', async () => {
    const r = await llamar(`/api/cochinito/movimientos/${MOV}`, 'soloWallet');
    expect(r.status).toBe(200);
    expect(r.json?.proveedorNombre).toBeNull();
    expect(r.json?.bancaOrigenNombre).toBe('Banesco');
  });
});
