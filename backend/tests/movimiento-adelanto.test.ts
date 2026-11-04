import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({
  insertado: null as Record<string, unknown> | null,
  monedas: {} as Record<string, string | undefined>,
  respuesta: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      let id = '';
      const c: Record<string, unknown> = {
        select: () => c,
        eq: (_k: string, v: string) => { id = v; return c; },
        maybeSingle: () => Promise.resolve({ data: bd.monedas[id] ? { moneda: bd.monedas[id] } : null, error: null }),
        insert: (fila: Record<string, unknown>) => {
          bd.insertado = fila;
          return { select: () => ({ single: () => Promise.resolve(bd.respuesta) }) };
        },
      };
      return c;
    },
  },
}));

import { subtipoAdelantoDeMovimiento } from '../src/utils/movimiento-adelanto.js';
import { crearMovimiento } from '../src/services/banca-service.js';
import type { CrearMovimientoInput } from '../src/schemas/cochinito.js';

const P = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const U = '11111111-1111-4111-8111-111111111111';

describe('subtipoAdelantoDeMovimiento', () => {
  it('un egreso con proveedor es un adelanto', () => {
    expect(subtipoAdelantoDeMovimiento({ tipo: 'egreso', proveedorId: P })).toBe('adelanto');
  });
  it('un ingreso con cliente es un anticipo', () => {
    expect(subtipoAdelantoDeMovimiento({ tipo: 'ingreso', clienteId: C })).toBe('anticipo');
  });
  it('sin proveedor/cliente, o con la entidad contraria, es un movimiento manual común', () => {
    expect(subtipoAdelantoDeMovimiento({ tipo: 'egreso' })).toBeNull();
    expect(subtipoAdelantoDeMovimiento({ tipo: 'egreso', proveedorId: null, clienteId: C })).toBeNull();
    expect(subtipoAdelantoDeMovimiento({ tipo: 'ingreso', proveedorId: P })).toBeNull();
    expect(subtipoAdelantoDeMovimiento({ tipo: 'ingreso', proveedorId: P, clienteId: null })).toBeNull();
  });
  it('las transferencias nunca son adelantos', () => {
    expect(subtipoAdelantoDeMovimiento({ tipo: 'transferencia', proveedorId: P, clienteId: C })).toBeNull();
  });
});

const entrada = (extra: Partial<CrearMovimientoInput> = {}): CrearMovimientoInput => ({
  tipo: 'egreso', bancaId: 'b-1', bancaDestinoId: null, monto: 100, montoDestino: null, moneda: 'USD',
  descripcion: 'Pago por adelantado', referencia: null, fecha: '2026-10-24', proveedorId: null, clienteId: null, comprobantes: [], ...extra,
});

beforeEach(() => {
  bd.insertado = null;
  bd.monedas = { 'b-1': 'USD', 'b-2': 'USD' };
  bd.respuesta = { data: { id: 'm1', tipo: 'egreso', monto: 100, moneda: 'USD', banca_origen_id: 'b-1', fecha: '2026-10-24' }, error: null };
});

describe('crearMovimiento: adelanto/anticipo desde Wallet', () => {
  it('un egreso con proveedor se inserta como adelanto con su propio grupo', async () => {
    await crearMovimiento(entrada({ proveedorId: P }), U);
    expect(bd.insertado).toMatchObject({ tipo: 'egreso', proveedor_id: P, subtipo: 'adelanto', descripcion: 'Pago por adelantado' });
    expect(bd.insertado?.grupo_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un ingreso con cliente se inserta como anticipo con su propio grupo', async () => {
    await crearMovimiento(entrada({ tipo: 'ingreso', clienteId: C }), U);
    expect(bd.insertado).toMatchObject({ tipo: 'ingreso', cliente_id: C, subtipo: 'anticipo' });
    expect(bd.insertado?.grupo_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('cada adelanto recibe un grupo distinto', async () => {
    await crearMovimiento(entrada({ proveedorId: P }), U);
    const primero = bd.insertado?.grupo_id;
    await crearMovimiento(entrada({ proveedorId: P }), U);
    expect(bd.insertado?.grupo_id).not.toBe(primero);
  });

  it('un movimiento sin proveedor ni cliente sigue siendo manual (sin subtipo ni grupo)', async () => {
    await crearMovimiento(entrada(), U);
    expect(bd.insertado).not.toHaveProperty('subtipo');
    expect(bd.insertado).not.toHaveProperty('grupo_id');
  });

  it('un ingreso con proveedor o un egreso con cliente no son adelantos', async () => {
    await crearMovimiento(entrada({ tipo: 'ingreso', proveedorId: P }), U);
    expect(bd.insertado).not.toHaveProperty('subtipo');
    await crearMovimiento(entrada({ tipo: 'egreso', clienteId: C }), U);
    expect(bd.insertado).not.toHaveProperty('subtipo');
  });

  it('una transferencia con proveedor no es un adelanto', async () => {
    await crearMovimiento(entrada({ tipo: 'transferencia', bancaDestinoId: 'b-2', proveedorId: P }), U);
    expect(bd.insertado).not.toHaveProperty('subtipo');
  });

  it('devuelve el movimiento con su subtipo cuando la base lo confirma', async () => {
    bd.respuesta = { data: { id: 'm1', tipo: 'egreso', monto: 100, moneda: 'USD', banca_origen_id: 'b-1', fecha: '2026-10-24', subtipo: 'adelanto', numero: 7, grupo_id: 'g1' }, error: null };
    const r = await crearMovimiento(entrada({ proveedorId: P }), U);
    expect(r).toMatchObject({ movimiento: { subtipo: 'adelanto', numero: 7, grupoId: 'g1' } });
  });
});

describe('crearMovimiento: la moneda es la de la cuenta de origen', () => {
  it('rechaza un egreso de una cuenta en Bs enviado con moneda USD (explotación del adelanto) y no inserta', async () => {
    bd.monedas['b-1'] = 'VES';
    const r = await crearMovimiento(entrada({ monto: 5000, moneda: 'USD', proveedorId: P }), U);
    expect(r).toMatchObject({ error: expect.stringMatching(/moneda/i) });
    expect(bd.insertado).toBeNull();
  });
  it('inserta con la moneda de la cuenta (sin importar mayúsculas del payload)', async () => {
    bd.monedas['b-1'] = 'VES';
    await crearMovimiento(entrada({ moneda: 'ves' }), U);
    expect(bd.insertado).toMatchObject({ moneda: 'VES' });
  });
  it('rechaza una cuenta de origen inexistente', async () => {
    bd.monedas = {};
    expect(await crearMovimiento(entrada(), U)).toMatchObject({ error: expect.stringMatching(/origen/i) });
    expect(bd.insertado).toBeNull();
  });
  it('en una transferencia valida que exista la cuenta destino', async () => {
    bd.monedas = { 'b-1': 'USD' };
    const r = await crearMovimiento(entrada({ tipo: 'transferencia', bancaDestinoId: 'b-2' }), U);
    expect(r).toMatchObject({ error: expect.stringMatching(/destino/i) });
    expect(bd.insertado).toBeNull();
  });
  it('un error de la base no devuelve su mensaje crudo', async () => {
    bd.respuesta = { data: null, error: { message: 'insert into movimientos violates secret_constraint' } as never };
    const r = await crearMovimiento(entrada(), U);
    expect(JSON.stringify(r)).not.toMatch(/secret_constraint/);
  });
});

describe('migration_comision_automatica_banca.sql: USD del adelanto desde Bs', () => {
  it('la RPC guarda monto_usd con la última tasa Binance (o BCV) y rechaza sin tasa', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sql = readFileSync(resolve(__dirname, '../../docs/migration_comision_automatica_banca.sql'), 'utf-8');
    expect(sql).toMatch(/fuente = 'Binance'/);
    expect(sql).toMatch(/fuente = 'BCV'/);
    expect(sql).toMatch(/v_usd := round\(p_monto \/ v_tasa_usd, 2\)/);
    expect(sql).toMatch(/grupo_id, monto_usd\)/);
    expect(sql).toMatch(/No hay una tasa de cambio disponible/);
  });
});
