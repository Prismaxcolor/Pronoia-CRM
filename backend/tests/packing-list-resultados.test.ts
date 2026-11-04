import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({
  rpc: vi.fn(),
  filaLista: null as unknown,
  selects: [] as string[],
  cliente: null as unknown,
  sinColumnaCliente: false,
  consultasClientes: 0,
}));

const errorColumna = { code: '42703', message: 'column cliente_id does not exist' };

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: bd.rpc,
    from: (tabla: string) => {
      const cadena: Record<string, unknown> = {};
      cadena.select = (cols: string) => {
        if (tabla === 'packing_lists') bd.selects.push(cols);
        if (tabla === 'clientes') bd.consultasClientes += 1;
        return cadena;
      };
      cadena.eq = () => cadena;
      cadena.limit = () => Promise.resolve({ data: [], error: bd.sinColumnaCliente ? errorColumna : null });
      cadena.order = () => (tabla === 'packing_list_items' ? Promise.resolve({ data: [], error: null }) : cadena);
      cadena.maybeSingle = () => {
        if (tabla === 'clientes') return Promise.resolve({ data: bd.cliente, error: null });
        const ultima = bd.selects[bd.selects.length - 1] ?? '';
        if (bd.sinColumnaCliente && ultima.includes('cliente_id')) return Promise.resolve({ data: null, error: errorColumna });
        const { cliente_id, ...sinCliente } = bd.filaLista as Record<string, unknown>;
        void cliente_id;
        return Promise.resolve({ data: ultima.includes('cliente_id') ? bd.filaLista : sinCliente, error: null });
      };
      return cadena;
    },
  },
}));

import { guardarPackingList, obtenerPackingList } from '../src/services/packing-list-service.js';
import { guardarPackingListSchema } from '../src/schemas/packing-lists.js';
import { calcularResultados } from '../../frontend/src/lib/resultados-exportacion';

const ID = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const base = {
  contenedor: 'SEKU-1', fecha: '2026-01-01', tipoEmbalaje: 'big_bag', esPcb: true,
  items: [
    { numero: 1, lote: '1', pesoBruto: 100, pesoPaleta: 0 },
    { numero: 2, lote: '2', pesoBruto: 50, pesoPaleta: 0 },
  ],
};
const entrada = (extra: Record<string, unknown> = {}) => guardarPackingListSchema.parse({ ...base, ...extra });
const fila = (extra: Record<string, unknown> = {}) => ({
  id: ID, contenedor: 'SEKU-1', fecha: '2026-01-01', tipo_embalaje: 'big_bag', es_pcb: true,
  descripcion_es: null, descripcion_en: null, observaciones_es: null, observaciones_en: null,
  referencia_tipo: null, referencia_id: null, created_at: 'x', updated_at: 'y', version: 2,
  cliente_id: null, proyeccion: [], ...extra,
});

beforeEach(() => {
  bd.rpc.mockReset();
  bd.selects.length = 0;
  bd.consultasClientes = 0;
  bd.sinColumnaCliente = false;
  bd.cliente = { id: CLIENTE, nombre: 'Acme Corp', tipo_venta: 'internacional' };
  bd.filaLista = fila();
  bd.rpc.mockResolvedValue({ data: { id: ID, version: 2 }, error: null });
});

describe('esquema: valor real y cliente', () => {
  it('acepta valor real por lote junto al estimado', () => {
    const r = entrada({ proyeccion: [{ lote: '1', valorKgUsd: 2, valorRealKgUsd: 2.5 }] });
    expect(r.proyeccion).toEqual([{ lote: '1', valorKgUsd: 2, valorRealKgUsd: 2.5 }]);
  });
  it('conserva una línea con solo valor real (estimado null)', () => {
    const r = entrada({ proyeccion: [{ lote: '1', valorKgUsd: null, valorRealKgUsd: 3 }] });
    expect(r.proyeccion).toEqual([{ lote: '1', valorKgUsd: null, valorRealKgUsd: 3 }]);
  });
  it('descarta líneas sin ningún valor', () => {
    const r = entrada({ proyeccion: [{ lote: '1', valorKgUsd: null, valorRealKgUsd: null }, { lote: '2', valorKgUsd: 1 }] });
    expect(r.proyeccion).toEqual([{ lote: '2', valorKgUsd: 1 }]);
  });
  it('rechaza valor real negativo, con más de 4 decimales o enorme', () => {
    for (const v of [-1, 1.23456, 2_000_000]) {
      expect(guardarPackingListSchema.safeParse({ ...base, proyeccion: [{ lote: '1', valorKgUsd: 1, valorRealKgUsd: v }] }).success).toBe(false);
    }
  });
  it('clienteId es opcional, acepta null y exige uuid', () => {
    expect(entrada().clienteId).toBeUndefined();
    expect(entrada({ clienteId: null }).clienteId).toBeNull();
    expect(entrada({ clienteId: CLIENTE }).clienteId).toBe(CLIENTE);
    expect(guardarPackingListSchema.safeParse({ ...base, clienteId: 'abc' }).success).toBe(false);
  });
});

describe('guardarPackingList: cliente internacional', () => {
  const cabecera = () => bd.rpc.mock.calls[0][1].p_cabecera as Record<string, unknown>;

  it('con cliente internacional lo envía en la cabecera', async () => {
    const r = await guardarPackingList(null, entrada({ clienteId: CLIENTE }), 'u1');
    expect(r.ok).toBe(true);
    expect(cabecera().cliente_id).toBe(CLIENTE);
  });
  it('rechaza un cliente nacional con 400 y no guarda', async () => {
    bd.cliente = { id: CLIENTE, nombre: 'Local', tipo_venta: 'nacional' };
    const r = await guardarPackingList(null, entrada({ clienteId: CLIENTE }), 'u1');
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });
  it('rechaza un cliente inexistente con 400', async () => {
    bd.cliente = null;
    const r = await guardarPackingList(null, entrada({ clienteId: CLIENTE }), 'u1');
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });
  it('null desvincula el cliente y no consulta clientes', async () => {
    await guardarPackingList(ID, entrada({ version: 2, clienteId: null }), 'u1');
    expect(cabecera().cliente_id).toBeNull();
    expect(bd.consultasClientes).toBe(0);
  });
  it('sin el campo no envía la clave (la BD conserva el cliente; compatible con la cola offline anterior)', async () => {
    await guardarPackingList(ID, entrada({ version: 2 }), 'u1');
    expect('cliente_id' in cabecera()).toBe(false);
  });
  it('si la migración no está aplicada responde 409 en vez de perder el cliente en silencio', async () => {
    bd.sinColumnaCliente = true;
    const r = await guardarPackingList(null, entrada({ clienteId: CLIENTE }), 'u1');
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });
  it('sin cliente y sin migración sigue guardando', async () => {
    bd.sinColumnaCliente = true;
    const r = await guardarPackingList(null, entrada(), 'u1');
    expect(r.ok).toBe(true);
  });
  it('envía el valor real en snake_case sin claves nulas', async () => {
    await guardarPackingList(null, entrada({ proyeccion: [{ lote: '1', valorKgUsd: null, valorRealKgUsd: 3 }] }), 'u1', { puedeVerValores: true });
    expect(cabecera().proyeccion).toEqual([{ lote: '1', valor_real_kg_usd: 3 }]);
  });
  it('sin permiso de valores el valor real tampoco viaja', async () => {
    await guardarPackingList(ID, entrada({ version: 2, proyeccion: [{ lote: '1', valorKgUsd: 1, valorRealKgUsd: 3 }] }), 'u1');
    expect('proyeccion' in cabecera()).toBe(false);
  });
});

describe('obtenerPackingList: cliente y valor real', () => {
  it('devuelve clienteId y clienteNombre', async () => {
    bd.filaLista = fila({ cliente_id: CLIENTE });
    const p = await obtenerPackingList(ID);
    expect(p?.clienteId).toBe(CLIENTE);
    expect(p?.clienteNombre).toBe('Acme Corp');
  });
  it('sin cliente: clienteId null y no consulta clientes', async () => {
    const p = await obtenerPackingList(ID);
    expect(p?.clienteId).toBeNull();
    expect(bd.consultasClientes).toBe(0);
  });
  it('con migración pendiente el detalle carga con clienteId null', async () => {
    bd.sinColumnaCliente = true;
    const p = await obtenerPackingList(ID);
    expect(p?.id).toBe(ID);
    expect(p?.clienteId).toBeNull();
  });
  it('con permiso devuelve estimado y real; los ausentes quedan null/undefined', async () => {
    bd.filaLista = fila({ proyeccion: [{ lote: '1', valor_kg_usd: 2, valor_real_kg_usd: 2.5 }, { lote: '2', valor_kg_usd: 4 }] });
    const p = await obtenerPackingList(ID, { puedeVerValores: true });
    expect(p?.proyeccion).toEqual([
      { lote: '1', valorKgUsd: 2, valorRealKgUsd: 2.5 },
      { lote: '2', valorKgUsd: 4 },
    ]);
  });
  it('línea solo con real devuelve estimado null', async () => {
    bd.filaLista = fila({ proyeccion: [{ lote: '1', valor_real_kg_usd: 3 }] });
    const p = await obtenerPackingList(ID, { puedeVerValores: true });
    expect(p?.proyeccion).toEqual([{ lote: '1', valorKgUsd: null, valorRealKgUsd: 3 }]);
  });
  it('sin permiso no devuelve proyección (ni valores reales)', async () => {
    bd.filaLista = fila({ proyeccion: [{ lote: '1', valor_kg_usd: 2, valor_real_kg_usd: 2.5 }] });
    const p = await obtenerPackingList(ID);
    expect(p && 'proyeccion' in p).toBe(false);
  });
});

describe('calcularResultados (proyección vs real)', () => {
  const kgs = [{ lote: '1', kg: 100 }, { lote: '2', kg: 50 }, { lote: '3', kg: 10 }];

  it('compara por lote: diferencia en USD y en %', () => {
    const r = calcularResultados(kgs.slice(0, 1), { '1': 2 }, { '1': 2.5 });
    expect(r.lineas[0]).toMatchObject({ estimadoUsd: 200, realUsd: 250, diferenciaUsd: 50, diferenciaPct: 25 });
  });
  it('diferencia negativa cuando lo real es menor', () => {
    const r = calcularResultados(kgs.slice(0, 1), { '1': 4 }, { '1': 3 });
    expect(r.lineas[0]).toMatchObject({ diferenciaUsd: -100, diferenciaPct: -25 });
  });
  it('lote sin real: muestra null y no inventa cifras', () => {
    const r = calcularResultados(kgs.slice(0, 1), { '1': 2 }, {});
    expect(r.lineas[0]).toMatchObject({ estimadoUsd: 200, realUsd: null, diferenciaUsd: null, diferenciaPct: null });
  });
  it('lote sin estimado: no hay diferencia aunque haya real', () => {
    const r = calcularResultados(kgs.slice(0, 1), {}, { '1': 2 });
    expect(r.lineas[0]).toMatchObject({ estimadoUsd: null, realUsd: 200, diferenciaUsd: null, diferenciaPct: null });
  });
  it('el total comparativo solo suma lotes con ambos valores y cuenta los que faltan', () => {
    const r = calcularResultados(kgs, { '1': 2, '2': 4, '3': 1 }, { '1': 2.5, '3': 1 });
    // Lotes 1 y 3 tienen ambos; el 2 no tiene real.
    expect(r.lotesComparados).toBe(2);
    expect(r.lotesIncompletos).toBe(1);
    expect(r.totalEstimadoUsd).toBe(210);
    expect(r.totalRealUsd).toBe(260);
    expect(r.diferenciaUsd).toBe(50);
    expect(r.diferenciaPct).toBe(23.81);
  });
  it('sin ningún lote comparable el total es null (no 0)', () => {
    const r = calcularResultados(kgs, { '1': 2 }, {});
    expect(r.lotesComparados).toBe(0);
    expect(r.totalEstimadoUsd).toBeNull();
    expect(r.totalRealUsd).toBeNull();
    expect(r.diferenciaUsd).toBeNull();
    expect(r.diferenciaPct).toBeNull();
  });
  it('estimado en cero: porcentaje null (sin división por cero)', () => {
    const r = calcularResultados(kgs.slice(0, 1), { '1': 0 }, { '1': 1 });
    expect(r.lineas[0].diferenciaUsd).toBe(100);
    expect(r.lineas[0].diferenciaPct).toBeNull();
  });
  it('no arrastra error de coma flotante', () => {
    const r = calcularResultados([{ lote: 'A', kg: 0.3 }], { A: 0.1 }, { A: 0.2 });
    expect(r.lineas[0]).toMatchObject({ estimadoUsd: 0.03, realUsd: 0.06, diferenciaUsd: 0.03 });
  });
});
