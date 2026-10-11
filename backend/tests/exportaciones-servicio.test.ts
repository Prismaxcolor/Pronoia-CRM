import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({
  filas: [] as unknown[],
  clientes: [] as unknown[],
  selects: [] as string[],
  errores: [] as Array<{ code: string; message: string } | null>,
  filtros: [] as Array<[string, string, unknown]>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const cadena: Record<string, unknown> = {};
      cadena.select = (cols: string) => { if (tabla === 'packing_lists') bd.selects.push(cols); return cadena; };
      cadena.not = (c: string, op: string, v: unknown) => { bd.filtros.push([c, op, v]); return cadena; };
      cadena.order = () => cadena;
      cadena.in = () => Promise.resolve({ data: bd.clientes, error: null });
      cadena.limit = () => {
        const error = bd.errores.shift() ?? null;
        return Promise.resolve(error ? { data: null, error } : { data: bd.filas, error: null });
      };
      return cadena;
    },
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { listarExportaciones, kgPorLoteDeItems } from '../src/services/exportaciones-service.js';

const fila = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', contenedor: 'SEKU-1', fecha: '2026-01-01', cliente_id: 'c1',
  packing_list_items: [
    { lote: '1', peso_bruto: 100, peso_paleta: 5 },
    { lote: '2', peso_bruto: '50', peso_paleta: '0' },
    { lote: ' 1 ', peso_bruto: 40, peso_paleta: 0 },
    { lote: null, peso_bruto: 10, peso_paleta: 0 },
  ],
  proyeccion: [{ lote: '1', valor_kg_usd: 2, valor_real_kg_usd: 3 }, { lote: '2', valor_kg_usd: '4' }],
  ...extra,
});

beforeEach(() => {
  bd.filas = [fila()];
  bd.clientes = [{ id: 'c1', nombre: 'ACME Corp' }];
  bd.selects = [];
  bd.errores = [];
  bd.filtros = [];
});

describe('kgPorLoteDeItems', () => {
  it('suma el neto por lote en orden de aparición y agrupa sin lote bajo ""', () => {
    expect(kgPorLoteDeItems([
      { lote: '1', peso_bruto: 100, peso_paleta: 5 }, { lote: '2', peso_bruto: 50, peso_paleta: 0 },
      { lote: ' 1 ', peso_bruto: 40, peso_paleta: 0 }, { lote: null, peso_bruto: 10, peso_paleta: 0 },
    ])).toEqual([{ lote: '1', kg: 135 }, { lote: '2', kg: 50 }, { lote: '', kg: 10 }]);
  });
});

describe('listarExportaciones', () => {
  it('lista solo packing lists con cliente y devuelve cliente, kg y total', async () => {
    const r = await listarExportaciones({ puedeVerValores: false });
    expect(bd.filtros).toContainEqual(['cliente_id', 'is', null]);
    expect(r.exportaciones).toEqual([{
      packingListId: 'p1', contenedor: 'SEKU-1', fecha: '2026-01-01', clienteId: 'c1', clienteNombre: 'ACME Corp',
      totalNeto: 195, kgPorLote: [{ lote: '1', kg: 135 }, { lote: '2', kg: 50 }, { lote: '', kg: 10 }],
    }]);
  });

  it('sin facturacion:ver no pide ni devuelve la valoración', async () => {
    const r = await listarExportaciones({ puedeVerValores: false });
    expect(bd.selects[0]).not.toContain('proyeccion');
    expect(r.exportaciones[0]).not.toHaveProperty('proyeccion');
  });

  it('con facturacion:ver devuelve la valoración en formato público', async () => {
    const r = await listarExportaciones({ puedeVerValores: true });
    expect(bd.selects[0]).toContain('proyeccion');
    expect(r.exportaciones[0].proyeccion).toEqual([
      { lote: '1', valorKgUsd: 2, valorRealKgUsd: 3 }, { lote: '2', valorKgUsd: 4 },
    ]);
  });

  it('con facturacion:ver devuelve el total real cobrado (número o null)', async () => {
    bd.filas = [fila({ total_real_usd: '13193.46' }), fila({ id: 'p2' })];
    const r = await listarExportaciones({ puedeVerValores: true });
    expect(bd.selects[0]).toContain('total_real_usd');
    expect(r.exportaciones.map(e => e.totalRealUsd)).toEqual([13193.46, null]);
  });

  it('sin facturacion:ver no pide ni devuelve el total real', async () => {
    bd.filas = [fila({ total_real_usd: 5 })];
    const r = await listarExportaciones({ puedeVerValores: false });
    expect(bd.selects[0]).not.toContain('total_real_usd');
    expect(r.exportaciones[0]).not.toHaveProperty('totalRealUsd');
  });

  it('si falta solo la columna total_real_usd reintenta con la proyección', async () => {
    bd.errores = [{ code: '42703', message: 'column total_real_usd does not exist' }];
    const r = await listarExportaciones({ puedeVerValores: true });
    expect(bd.selects).toHaveLength(2);
    expect(bd.selects[1]).toContain('proyeccion');
    expect(bd.selects[1]).not.toContain('total_real_usd');
    expect(r.exportaciones[0].totalRealUsd).toBeNull();
  });

  it('si falta la columna proyeccion reintenta sin ella', async () => {
    const e = { code: '42703', message: 'column proyeccion does not exist' };
    bd.errores = [e, e];
    bd.filas = [fila({ proyeccion: undefined })];
    const r = await listarExportaciones({ puedeVerValores: true });
    expect(bd.selects).toHaveLength(3);
    expect(bd.selects[2]).not.toContain('proyeccion');
    expect(r.exportaciones[0].proyeccion).toEqual([]);
  });

  it('si falta cliente_id responde vacío con migración pendiente', async () => {
    const e = { code: '42703', message: 'column cliente_id does not exist' };
    bd.errores = [e, e, e];
    const r = await listarExportaciones({ puedeVerValores: true });
    expect(r).toEqual({ exportaciones: [], migracionPendiente: true });
  });

  it('un error distinto se propaga con mensaje claro', async () => {
    bd.errores = [{ code: 'XX000', message: 'boom' }];
    await expect(listarExportaciones({ puedeVerValores: false })).rejects.toThrow(/No se pudieron leer las exportaciones/);
  });

  it('un cliente sin nombre legible queda como null', async () => {
    bd.clientes = [];
    const r = await listarExportaciones({ puedeVerValores: false });
    expect(r.exportaciones[0].clienteNombre).toBeNull();
  });
});
