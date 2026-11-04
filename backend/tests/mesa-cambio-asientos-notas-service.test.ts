import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
type Err = { code?: string; message: string } | null;
const bd = vi.hoisted(() => ({
  asientos: [] as Fila[],
  movimientos: [] as Fila[],
  bancas: [] as Fila[],
  porId: null as Fila | null,
  insertError: null as Err,
  insertados: [] as Fila[],
  actualizados: [] as Fila[],
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'is']) c[m] = () => c;
      // Lecturas de comisión: movimientos (.in().gt()) y bancas (.in()).
      c.in = () => Object.assign(Promise.resolve({ data: tabla === 'bancas' ? bd.bancas : bd.movimientos, error: null }), {
        gt: () => Promise.resolve({ data: bd.movimientos, error: null }),
      });
      c.range = () => Promise.resolve({ data: bd.asientos, error: null });
      c.insert = (v: Fila) => { bd.insertados.push(v); return c; };
      c.update = (v: Fila) => { bd.actualizados.push(v); return c; };
      c.single = () => Promise.resolve(bd.insertError
        ? { data: null, error: bd.insertError }
        : { data: { id: 'a-1', numero: 9, tipo: bd.insertados.at(-1)?.tipo, monto_usd: 10, fecha: '2026-10-11' }, error: null });
      c.maybeSingle = () => Promise.resolve({
        data: tabla === 'cambistas' ? { id: 'c-1', nombre: 'X', activo: true, created_at: '2026-01-01' } : bd.porId,
        error: null,
      });
      return c;
    },
  },
}));

import { anularAsiento, crearAsiento, obtenerEstadoCuenta } from '../src/services/mesa-cambio-service.js';

const base = { cambistaId: 'c-1', montoUsd: 10, tasa: null, fecha: '2026-10-11', nota: 'Ajuste', referencia: null };

beforeEach(() => { bd.movimientos = []; bd.bancas = []; bd.asientos = []; bd.porId = null; bd.insertError = null; bd.insertados = []; bd.actualizados = []; });

describe('estado de cuenta con notas y asientos de transferencia', () => {
  it('lee numero_nota y movimiento_id (y tolera filas sin esas columnas)', async () => {
    bd.asientos = [
      { id: 'a1', numero: 1, tipo: 'CARGO', monto_usd: 100, fecha: '2026-10-01', anulado: false, movimiento_id: 'mov-1' },
      { id: 'a2', numero: 2, tipo: 'NC', monto_usd: 30, fecha: '2026-10-02', anulado: false, numero_nota: 4 },
      { id: 'a3', numero: 3, tipo: 'ND', monto_usd: 5, fecha: '2026-10-03', anulado: false },
    ];
    const r = await obtenerEstadoCuenta('c-1', {});
    if ('error' in r) throw new Error(r.error);
    expect(r.estado.filas.map(f => [f.tipo, f.numeroNota, f.movimientoId])).toEqual([
      ['CARGO', null, 'mov-1'], ['NC', 4, null], ['ND', null, null],
    ]);
    expect(r.estado.saldoFinal).toBe(75);
  });
});

describe('estado de cuenta: comisión de la mesa', () => {
  it('muestra la comisión en el CARGO de la transferencia sin cambiar el saldo', async () => {
    bd.asientos = [
      { id: 'a1', numero: 1, tipo: 'CARGO', monto_usd: 100, fecha: '2026-10-01', anulado: false, movimiento_id: 'mov-1' },
    ];
    bd.movimientos = [{ id: 'mov-1', numero_sistema: 12, mesa_comision: 365, mesa_monto_bruto: 36500, banca_destino_id: 'b-1', mesa_estado: 'en_proceso' }];
    bd.bancas = [{ id: 'b-1', moneda: 'VES' }];
    const r = await obtenerEstadoCuenta('c-1', {});
    if ('error' in r) throw new Error(r.error);
    expect(r.estado.filas[0].comision).toEqual({ monto: 365, moneda: 'VES', montoUsd: 1, movimientoNumero: 12, completada: false });
    expect(r.estado.totalComisionesUsd).toBe(1);
    expect(r.estado.saldoFinal).toBe(100);
  });
});

describe('crearAsiento N/C y N/D', () => {
  it('inserta la nota con su tipo', async () => {
    const r = await crearAsiento({ ...base, tipo: 'ND' }, 'u-1');
    expect(bd.insertados[0]).toMatchObject({ tipo: 'ND', nota: 'Ajuste' });
    expect(r).toMatchObject({ asiento: { tipo: 'ND' } });
  });

  it('si la migracion de notas no esta aplicada (check de tipo) => 503 claro', async () => {
    bd.insertError = { code: '23514', message: 'violates check constraint "cambista_asientos_tipo_check"' };
    const r = await crearAsiento({ ...base, tipo: 'NC' }, 'u-1');
    expect(r).toMatchObject({ codigo: 503 });
    expect('error' in r && r.error).toContain('migration_mesa_cambio_transferencias.sql');
  });
});

describe('anularAsiento', () => {
  it('un asiento ligado a una transferencia no se anula suelto', async () => {
    bd.porId = { id: 'a1', anulado: false, movimiento_id: 'mov-1' };
    const r = await anularAsiento('a1', 'Error', 'u-1');
    expect(r).toMatchObject({ codigo: 409, error: expect.stringContaining('transferencia') });
    expect(bd.actualizados).toHaveLength(0);
  });

  it('un asiento manual se anula como antes', async () => {
    bd.porId = { id: 'a2', anulado: false, movimiento_id: null };
    expect(await anularAsiento('a2', 'Error', 'u-1')).toEqual({ ok: true });
    expect(bd.actualizados[0]).toMatchObject({ anulado: true, anulado_motivo: 'Error', anulado_por: 'u-1' });
  });

  it('inexistente => 404 y ya anulado => 409', async () => {
    expect(await anularAsiento('zz', 'Error', 'u-1')).toMatchObject({ codigo: 404 });
    bd.porId = { id: 'a3', anulado: true, movimiento_id: null };
    expect(await anularAsiento('a3', 'Error', 'u-1')).toMatchObject({ codigo: 409 });
  });
});
