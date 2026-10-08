import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { quitarPrecioEstimado } from '../src/utils/auditoria.js';

/**
 * El historial de un lote (GET /api/auditoria/lote/:id) pide solo productos:ver, pero sus cambios pueden
 * traer el precio estimado de venta: quien no tiene facturacion:ver no debe verlo por esa vía.
 */

const usuarios: Record<string, { rol: string; permisos: unknown; activo: boolean }> = {};

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      let id: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (_c: string, v: string) => { id = v; return b; },
        maybeSingle: async () => ({ data: tabla === 'users' && id ? usuarios[id] ?? null : null, error: null }),
      };
      return b;
    },
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));
const listarAuditoria = vi.hoisted(() => vi.fn());
vi.mock('../src/services/auditoria-service.js', () => ({ listarAuditoria }));

const { default: auditoriaRouter } = await import('../src/routes/auditoria.js');

const ID = '11111111-1111-4111-8111-111111111111';
const entradaLote = () => ({
  id: 'a1', entidadTipo: 'lote', entidadId: ID, accion: 'clasificacion', usuarioId: 'u', usuarioNombre: 'U',
  autorizadoPor: null, autorizadoPorNombre: null, createdAt: '2026-10-01T00:00:00Z',
  cambios: {
    clase: { antes: 'otro', despues: 'exportacion' },
    precio_estimado_kg: { antes: null, despues: 1.8 },
    precio_estimado_actualizado_en: { antes: null, despues: '2026-10-01' },
    precio_estimado_actualizado_por: { antes: null, despues: 'u' },
  },
});
const soloPrecio = () => ({ ...entradaLote(), id: 'a2', cambios: { precio_estimado_kg: { antes: 1, despues: 2 } } });

describe('quitarPrecioEstimado', () => {
  it('elimina el precio estimado y sus derivados y deja el resto', () => {
    const r = quitarPrecioEstimado([entradaLote()]);
    expect(Object.keys(r[0].cambios)).toEqual(['clase']);
  });
  it('un registro que solo cambiaba el precio se conserva con cambios vacíos', () => {
    const r = quitarPrecioEstimado([soloPrecio()]);
    expect(r).toHaveLength(1);
    expect(r[0].cambios).toEqual({});
  });
  it('no muta las entradas originales', () => {
    const original = entradaLote();
    quitarPrecioEstimado([original]);
    expect(original.cambios.precio_estimado_kg).toEqual({ antes: null, despues: 1.8 });
  });
});

let servidor: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use('/api/auditoria', auditoriaRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });
beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.admin = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.trabajador = { rol: 'trabajador', permisos: null, activo: true };
  usuarios.administracion = { rol: 'administracion', permisos: null, activo: true };
  usuarios.sinfactura = { rol: 'administracion', permisos: [{ recurso: 'productos', accion: 'ver' }], activo: true };
  listarAuditoria.mockReset();
});

async function pedir(usuario: string, tipo: string) {
  const res = await fetch(`${base}/api/auditoria/${tipo}/${ID}`, { headers: { Authorization: `Bearer ${usuario}` } });
  return { status: res.status, json: (await res.json()) as { entradas: Array<{ cambios: Record<string, unknown> }> } };
}

describe('GET /api/auditoria/lote/:id', () => {
  it('superadmin y administracion (facturacion:ver) ven el precio estimado', async () => {
    for (const u of ['admin', 'administracion']) {
      listarAuditoria.mockResolvedValue([entradaLote()]);
      const r = await pedir(u, 'lote');
      expect(r.status).toBe(200);
      expect(r.json.entradas[0].cambios.precio_estimado_kg).toEqual({ antes: null, despues: 1.8 });
    }
  });
  it('trabajador (sin facturacion:ver) y permisos personalizados sin él no ven el precio ni sus derivados', async () => {
    for (const u of ['trabajador', 'sinfactura']) {
      listarAuditoria.mockResolvedValue([entradaLote(), soloPrecio()]);
      const r = await pedir(u, 'lote');
      expect(r.status).toBe(200);
      expect(r.json.entradas).toHaveLength(2);
      expect(Object.keys(r.json.entradas[0].cambios)).toEqual(['clase']);
      expect(r.json.entradas[1].cambios).toEqual({});
    }
  });
  it('otras entidades no se alteran', async () => {
    listarAuditoria.mockResolvedValue([{ ...entradaLote(), entidadTipo: 'transformacion' }]);
    const r = await pedir('trabajador', 'transformacion');
    expect(r.status).toBe(200);
    expect(Object.keys(r.json.entradas[0].cambios)).toHaveLength(4);
  });
});
