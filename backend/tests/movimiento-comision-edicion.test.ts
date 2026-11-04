import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  fila: null as Record<string, unknown> | null,
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
  id: ID, tipo: 'egreso', monto: 10000, moneda: 'VES', descripcion: 'Pago', banca_origen_id: 'b-o', banca_destino_id: null,
  fecha: '2026-10-11', referencia: '', registrado_por: 'u-1', creado_en: '2026-10-11T10:00:00Z', anulado: false, ...extra,
});

beforeEach(() => { bd.fila = fila(); bd.rpcs = []; bd.rpcError = null; });

describe('anular un movimiento con comisión bancaria', () => {
  it('usa la RPC que anula el movimiento y su comisión juntos', async () => {
    bd.fila = fila({ comision_bancaria: 30 });
    await anularMovimientoBanca(ID, 'Error de digitación', actor);
    expect(bd.rpcs).toEqual([
      { fn: 'anular_movimiento_con_comision_bancaria', args: { p_id: ID, p_motivo: 'Error de digitación', p_usuario: 'u-1' } },
    ]);
  });

  it('un movimiento sin comisión sigue usando la RPC de siempre', async () => {
    await anularMovimientoBanca(ID, 'Error', actor);
    expect(bd.rpcs[0].fn).toBe('anular_movimiento_banca');
  });

  it('el cargo de la comisión no se anula suelto: se anula con su movimiento (409, sin RPC)', async () => {
    bd.fila = fila({ comision_de_id: '33333333-3333-4333-8333-333333333333' });
    const r = await anularMovimientoBanca(ID, 'Error', actor);
    expect(r).toMatchObject({ codigo: 409, error: expect.stringContaining('comisión bancaria') });
    expect(bd.rpcs).toHaveLength(0);
  });
});

describe('editar un movimiento con comisión bancaria', () => {
  it('rechaza cambios de monto o cuentas con 409 (la comisión depende del monto) y no llama a ninguna RPC', async () => {
    bd.fila = fila({ comision_bancaria: 30 });
    const r = await editarMovimientoBanca(ID, { monto: 500 }, actor);
    expect(r).toMatchObject({ codigo: 409, error: expect.stringContaining('comisión bancaria') });
    expect(bd.rpcs).toHaveLength(0);
  });

  it('permite editar el concepto, la referencia, la fecha y los comprobantes', async () => {
    bd.fila = fila({ comision_bancaria: 30 });
    await editarMovimientoBanca(ID, { descripcion: 'Nueva' }, actor);
    expect(bd.rpcs[0].fn).toBe('editar_movimiento_banca_campos');
  });

  it('el cargo de la comisión no se edita (409, sin RPC)', async () => {
    bd.fila = fila({ comision_de_id: '33333333-3333-4333-8333-333333333333' });
    const r = await editarMovimientoBanca(ID, { descripcion: 'Otra' }, actor);
    expect(r).toMatchObject({ codigo: 409 });
    expect(bd.rpcs).toHaveLength(0);
  });
});
