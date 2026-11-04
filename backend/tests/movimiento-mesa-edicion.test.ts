import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  fila: null as Fila | null,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcError: null as { code?: string; message: string } | null,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      bd.rpcs.push({ fn, args });
      return Promise.resolve({ data: {}, error: bd.rpcError });
    },
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'eq']) c[m] = () => c;
      c.maybeSingle = () => Promise.resolve({ data: bd.fila, error: null });
      c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return c;
    },
  },
}));
vi.mock('../src/services/edicion-autorizada-service.js', () => ({
  autorizarEdicion: () => Promise.resolve({ ok: true, autorizadoPor: null, liberar: () => Promise.resolve() }),
}));
vi.mock('../src/services/auditoria-service.js', () => ({
  registrarAuditoria: () => Promise.resolve(true),
  nombreDeUsuario: () => Promise.resolve(null),
}));

import { anularMovimientoBanca, editarMovimientoBanca } from '../src/services/movimiento-edicion-service.js';

const ID = '22222222-2222-4222-8222-222222222222';
const actor = { userId: 'u-1', email: 'a@b.c', rol: 'superadmin' as const };
const fila = (extra: Fila = {}): Fila => ({
  id: ID, tipo: 'transferencia', monto: 100, moneda: 'USD', descripcion: '', banca_origen_id: 'b-o', banca_destino_id: 'b-d',
  fecha: '2026-10-11', referencia: '', registrado_por: 'u-1', creado_en: '2026-10-11T10:00:00Z', anulado: false, ...extra,
});

beforeEach(() => { bd.fila = fila(); bd.rpcs = []; bd.rpcError = null; });

describe('anularMovimientoBanca', () => {
  it('una transferencia normal usa la RPC de siempre', async () => {
    await anularMovimientoBanca(ID, 'Error', actor);
    expect(bd.rpcs[0].fn).toBe('anular_movimiento_banca');
  });

  it('una transferencia con mesa de cambio usa su propia RPC (revierte origen, destino si estaba completada, y asientos)', async () => {
    bd.fila = fila({ mesa_cambista_id: 'c-1', mesa_estado: 'en_proceso' });
    await anularMovimientoBanca(ID, 'Cambista no entregó', actor, { puedeMesaCambio: true });
    expect(bd.rpcs[0]).toEqual({ fn: 'anular_transferencia_mesa_cambio', args: { p_movimiento_id: ID, p_motivo: 'Cambista no entregó', p_usuario: 'u-1' } });
  });
});

describe('anularMovimientoBanca: permiso de mesa de cambio', () => {
  beforeEach(() => { bd.fila = fila({ mesa_cambista_id: 'c-1', mesa_estado: 'en_proceso' }); });

  it('sin permiso de mesa de cambio rechaza con 403 y no llama a ninguna RPC (falla cerrado por defecto)', async () => {
    const r = await anularMovimientoBanca(ID, 'Cambista no entregó', actor);
    expect(r).toMatchObject({ codigo: 403, error: expect.stringContaining('mesa de cambio') });
    expect(await anularMovimientoBanca(ID, 'x', actor, { puedeMesaCambio: false })).toMatchObject({ codigo: 403 });
    expect(bd.rpcs).toHaveLength(0);
  });

  it('una transferencia normal no exige el permiso de mesa de cambio', async () => {
    bd.fila = fila();
    await anularMovimientoBanca(ID, 'Error', actor);
    expect(bd.rpcs[0].fn).toBe('anular_movimiento_banca');
  });
});

describe('editarMovimientoBanca con mesa de cambio', () => {
  beforeEach(() => { bd.fila = fila({ mesa_cambista_id: 'c-1', mesa_estado: 'en_proceso' }); });

  it('rechaza cambios de monto o cuentas con 409 y no llama a ninguna RPC', async () => {
    const r = await editarMovimientoBanca(ID, { monto: 500 }, actor);
    expect(r).toMatchObject({ codigo: 409, error: expect.stringContaining('mesa de cambio') });
    expect(bd.rpcs).toHaveLength(0);
  });

  it('permite editar la descripcion, referencia, fecha y comprobantes', async () => {
    await editarMovimientoBanca(ID, { descripcion: 'Nueva' }, actor);
    expect(bd.rpcs[0].fn).toBe('editar_movimiento_banca_campos');
  });
});
