import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({
  rpc: vi.fn(),
  filaLista: {} as Record<string, unknown>,
  selects: [] as string[],
  /** Columnas que "aún no existen": cualquier select que las nombre falla con 42703. */
  columnasAusentes: [] as string[],
}));

const errorDe = (cols: string) => {
  const falta = bd.columnasAusentes.find(c => cols.includes(c));
  return falta ? { code: '42703', message: `column ${falta} does not exist` } : null;
};

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: bd.rpc,
    from: (tabla: string) => {
      let columnas = '';
      const cadena: Record<string, unknown> = {};
      cadena.select = (cols: string) => {
        columnas = cols;
        if (tabla === 'packing_lists') bd.selects.push(cols);
        return cadena;
      };
      cadena.eq = () => cadena;
      cadena.limit = () => Promise.resolve({ data: [], error: errorDe(columnas) });
      cadena.order = () => (tabla === 'packing_list_items' ? Promise.resolve({ data: [], error: null }) : cadena);
      cadena.maybeSingle = () => {
        if (tabla !== 'packing_lists') return Promise.resolve({ data: null, error: null });
        const error = errorDe(columnas);
        if (error) return Promise.resolve({ data: null, error });
        const incluye = (c: string) => columnas.includes(c);
        const fila = Object.fromEntries(
          Object.entries(bd.filaLista).filter(([k]) => !['cliente_id', 'proyeccion', 'total_real_usd'].includes(k) || incluye(k))
        );
        return Promise.resolve({ data: fila, error: null });
      };
      return cadena;
    },
  },
}));

import { guardarPackingList, obtenerPackingList } from '../src/services/packing-list-service.js';
import { guardarPackingListSchema } from '../src/schemas/packing-lists.js';

const ID = '11111111-1111-4111-8111-111111111111';
const base = {
  contenedor: 'SEKU-1', fecha: '2026-01-01', tipoEmbalaje: 'big_bag', esPcb: true,
  items: [{ numero: 1, lote: '1', pesoBruto: 100, pesoPaleta: 0 }],
};
const entrada = (extra: Record<string, unknown> = {}) => guardarPackingListSchema.parse({ ...base, ...extra });
const fila = (extra: Record<string, unknown> = {}) => ({
  id: ID, contenedor: 'SEKU-1', fecha: '2026-01-01', tipo_embalaje: 'big_bag', es_pcb: true,
  descripcion_es: null, descripcion_en: null, observaciones_es: null, observaciones_en: null,
  referencia_tipo: null, referencia_id: null, created_at: 'x', updated_at: 'y', version: 2,
  cliente_id: null, proyeccion: [], total_real_usd: null, ...extra,
});
const cabecera = () => bd.rpc.mock.calls[0][1].p_cabecera as Record<string, unknown>;

beforeEach(() => {
  bd.rpc.mockReset();
  bd.selects.length = 0;
  bd.columnasAusentes = [];
  bd.filaLista = fila();
  bd.rpc.mockResolvedValue({ data: { id: ID, version: 3 }, error: null });
});

describe('esquema: total real cobrado', () => {
  it('es opcional: ausente queda undefined, null se conserva', () => {
    expect(entrada().totalRealUsd).toBeUndefined();
    expect(entrada({ totalRealUsd: null }).totalRealUsd).toBeNull();
    expect(entrada({ totalRealUsd: 13193.46 }).totalRealUsd).toBe(13193.46);
    expect(entrada({ totalRealUsd: 0 }).totalRealUsd).toBe(0);
  });
  it('rechaza negativos, más de 2 decimales y cifras desmedidas', () => {
    for (const v of [-1, 10.123, 1e12, 'abc']) {
      expect(guardarPackingListSchema.safeParse({ ...base, totalRealUsd: v }).success).toBe(false);
    }
  });
});

describe('guardarPackingList: total real', () => {
  it('envía total_real_usd en la cabecera cuando el usuario ve valores', async () => {
    const r = await guardarPackingList(ID, entrada({ version: 2, totalRealUsd: 500.5 }), 'u1', { puedeVerValores: true });
    expect(r.ok).toBe(true);
    expect(cabecera().total_real_usd).toBe(500.5);
  });
  it('null viaja como null (borra el total guardado)', async () => {
    await guardarPackingList(ID, entrada({ version: 2, totalRealUsd: null }), 'u1', { puedeVerValores: true });
    expect('total_real_usd' in cabecera()).toBe(true);
    expect(cabecera().total_real_usd).toBeNull();
  });
  it('ausente no envía la clave (la BD conserva; compatible con la cola offline anterior)', async () => {
    await guardarPackingList(ID, entrada({ version: 2 }), 'u1', { puedeVerValores: true });
    expect('total_real_usd' in cabecera()).toBe(false);
  });
  it('sin facturacion:ver el total no viaja aunque el cliente lo mande', async () => {
    await guardarPackingList(ID, entrada({ version: 2, totalRealUsd: 99 }), 'u1');
    expect('total_real_usd' in cabecera()).toBe(false);
  });
  it('con la migración pendiente, guardar un total responde 409 y no guarda', async () => {
    bd.columnasAusentes = ['total_real_usd'];
    const r = await guardarPackingList(ID, entrada({ version: 2, totalRealUsd: 500 }), 'u1', { puedeVerValores: true });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.ok === false && r.error).toMatch(/migration_packing_list_total_real\.sql/);
    expect(bd.rpc).not.toHaveBeenCalled();
  });
  it('con la migración pendiente, guardar sin total o con null sigue funcionando', async () => {
    bd.columnasAusentes = ['total_real_usd'];
    expect((await guardarPackingList(ID, entrada({ version: 2 }), 'u1', { puedeVerValores: true })).ok).toBe(true);
    bd.rpc.mockClear();
    expect((await guardarPackingList(ID, entrada({ version: 2, totalRealUsd: null }), 'u1', { puedeVerValores: true })).ok).toBe(true);
  });
});

describe('obtenerPackingList: total real', () => {
  it('con permiso devuelve totalRealUsd como número', async () => {
    bd.filaLista = fila({ total_real_usd: '13193.46' });
    const p = await obtenerPackingList(ID, { puedeVerValores: true });
    expect(p?.totalRealUsd).toBe(13193.46);
  });
  it('con permiso y sin total guardado devuelve null', async () => {
    const p = await obtenerPackingList(ID, { puedeVerValores: true });
    expect(p?.totalRealUsd).toBeNull();
  });
  it('sin permiso no pide ni devuelve el total', async () => {
    bd.filaLista = fila({ total_real_usd: 10 });
    const p = await obtenerPackingList(ID);
    expect(bd.selects.some(s => s.includes('total_real_usd'))).toBe(false);
    expect(p && 'totalRealUsd' in p).toBe(false);
  });
  it('con la migración pendiente lee igual (reintenta sin la columna) y el total queda null', async () => {
    bd.columnasAusentes = ['total_real_usd'];
    bd.filaLista = fila({ proyeccion: [{ lote: '1', valor_kg_usd: 2 }] });
    const p = await obtenerPackingList(ID, { puedeVerValores: true });
    expect(p?.id).toBe(ID);
    expect(p?.totalRealUsd).toBeNull();
    expect(p?.proyeccion).toEqual([{ lote: '1', valorKgUsd: 2 }]);
  });
});
