import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** PATCH .../notas-ajuste/:notaId/categoria (clientes y proveedores) deja rastro en auditoria_ediciones. */

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: tabla === 'users' ? { rol: 'superadmin', permisos: null, activo: true } : null, error: null }),
      };
      return b;
    },
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: () => ({ sub: 'u1', email: 'u1@x.test', rol: 'superadmin' }),
}));
const s = vi.hoisted(() => ({ asignar: vi.fn(), auditar: vi.fn() }));
vi.mock('../src/services/categoria-nota-service.js', () => ({ asignarCategoriaNota: s.asignar }));
vi.mock('../src/services/auditoria-service.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/auditoria-service.js')>()),
  registrarAuditoria: s.auditar,
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: clientesRouter } = await import('../src/routes/clientes.js');
const { default: proveedoresRouter } = await import('../src/routes/proveedores.js');

const ID = '44444444-4444-4444-8444-444444444444';
const NOTA = '55555555-5555-4555-8555-555555555555';
const CAT = '66666666-6666-4666-8666-666666666666';
const ANTERIOR = '77777777-7777-4777-8777-777777777777';
let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/clientes', clientesRouter);
  app.use('/api/proveedores', proveedoresRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  s.asignar.mockReset();
  s.auditar.mockReset();
  s.asignar.mockResolvedValue({ ok: true, anterior: ANTERIOR });
  s.auditar.mockResolvedValue(true);
});

const patch = (ruta: string) => fetch(`${base}${ruta}/${ID}/notas-ajuste/${NOTA}/categoria`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
  body: JSON.stringify({ categoriaId: CAT }),
});

describe('auditoría del cambio de categoría de una nota', () => {
  it.each([
    ['/api/clientes', 'nota_ajuste_cliente'],
    ['/api/proveedores', 'nota_ajuste_proveedor'],
  ])('%s registra la acción con la entidad %s', async (ruta, entidad) => {
    expect((await patch(ruta)).status).toBe(200);
    expect(s.auditar).toHaveBeenCalledWith(expect.objectContaining({
      entidadTipo: entidad, entidadId: NOTA, accion: 'cambiar_categoria', usuarioId: 'u1',
      cambios: expect.objectContaining({ categoria_id: { antes: ANTERIOR, despues: CAT } }),
    }));
  });

  it('si el cambio falla no se audita', async () => {
    s.asignar.mockResolvedValue({ error: 'Nota no encontrada.', codigo: 404 });
    expect((await patch('/api/clientes')).status).toBe(404);
    expect(s.auditar).not.toHaveBeenCalled();
  });
});
