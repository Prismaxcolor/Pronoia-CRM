import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});

const { vaciarDesechos } = await import('../src/services/vaciar-desechos-service.js');
const { esProductoDesechos, leerVaciados, sumarKg } = await import('../src/utils/desechos.js');

const DESECHOS = '11111111-1111-4111-8111-111111111111';
const COBRE = '22222222-2222-4222-8222-222222222222';
const ALM1 = '33333333-3333-4333-8333-333333333333';
const ALM2 = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  bdFalsa.reiniciar();
  bdFalsa.tablas.productos = [
    { id: DESECHOS, nombre: 'DESECHOS' },
    { id: COBRE, nombre: 'COBRE' },
  ];
});

describe('esProductoDesechos', () => {
  it('reconoce DESECHOS sin importar mayúsculas, tildes ni espacios', () => {
    expect(esProductoDesechos(' Desechos ')).toBe(true);
    expect(esProductoDesechos('BASURA MALA')).toBe(false);
    expect(esProductoDesechos(null)).toBe(false);
  });
});

describe('leerVaciados / sumarKg', () => {
  it('ignora filas inválidas y suma los kg', () => {
    const v = leerVaciados([{ almacen_id: ALM1, kg: '10.5' }, { almacen_id: ALM2, kg: 4.25 }, { kg: 3 }, { almacen_id: 'x', kg: 0 }]);
    expect(v).toHaveLength(2);
    expect(sumarKg(v)).toBe(14.75);
    expect(leerVaciados(null)).toEqual([]);
  });
});

describe('vaciarDesechos', () => {
  it('vacía DESECHOS llamando al RPC con el producto y el usuario, y devuelve los kg por almacén', async () => {
    bdFalsa.rpc.vaciar_desechos = [{ almacen_id: ALM1, kg: 120 }, { almacen_id: ALM2, kg: 30 }];
    const r = await vaciarDesechos(DESECHOS, USER);
    expect(r).toEqual({ ok: true, kgVaciados: 150, almacenes: [{ almacenId: ALM1, kg: 120 }, { almacenId: ALM2, kg: 30 }] });
    expect(bdFalsa.llamadasRpc[0]).toEqual({ nombre: 'vaciar_desechos', args: { p_producto_id: DESECHOS, p_usuario_id: USER } });
  });

  it('rechaza cualquier otro producto sin llamar al RPC', async () => {
    const r = await vaciarDesechos(COBRE, USER);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });

  it('producto inexistente = 404', async () => {
    expect(await vaciarDesechos('99999999-9999-4999-8999-999999999999', USER)).toMatchObject({ ok: false, status: 404 });
  });

  it('sin stock que vaciar responde 400 con mensaje claro', async () => {
    bdFalsa.rpc.vaciar_desechos = [];
    expect(await vaciarDesechos(DESECHOS, USER)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/No hay desechos/) });
  });

  it('migración sin aplicar = 409; error del RPC (toma abierta) = 400 con su mensaje', async () => {
    expect(await vaciarDesechos(DESECHOS, USER)).toMatchObject({ ok: false, status: 409 });
    bdFalsa.rpc.vaciar_desechos = () => ({ error: { code: 'P0001', message: 'Hay una toma física abierta' } });
    expect(await vaciarDesechos(DESECHOS, USER)).toMatchObject({ ok: false, status: 400, error: 'Hay una toma física abierta' });
  });
});

describe('puedeVaciarDesechos (frontend)', () => {
  it('solo ofrece vaciar en la fila del material DESECHOS con kg', async () => {
    const { puedeVaciarDesechos } = await import('../../frontend/src/lib/desechos.js');
    const base = { tipo: 'material', material: 'DESECHOS', productoId: 'p', kg: 12 };
    expect(puedeVaciarDesechos(base)).toBe(true);
    expect(puedeVaciarDesechos({ ...base, material: 'BASURA MALA' })).toBe(false);
    expect(puedeVaciarDesechos({ ...base, kg: 0 })).toBe(false);
    expect(puedeVaciarDesechos({ ...base, tipo: 'lote', productoId: null })).toBe(false);
  });
});
