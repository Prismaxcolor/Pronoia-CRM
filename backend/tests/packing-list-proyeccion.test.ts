import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({ rpc: vi.fn(), filaLista: null as unknown, selects: [] as string[], errorConProyeccion: false }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: bd.rpc,
    from: (tabla: string) => {
      const cadena: Record<string, unknown> = {};
      cadena.select = (cols: string) => { if (tabla === 'packing_lists') bd.selects.push(cols); return cadena; };
      cadena.eq = () => cadena;
      cadena.order = () => (tabla === 'packing_list_items' ? Promise.resolve({ data: [], error: null }) : cadena);
      cadena.maybeSingle = () => {
        const ultima = bd.selects[bd.selects.length - 1] ?? '';
        if (bd.errorConProyeccion && ultima.includes('proyeccion')) {
          return Promise.resolve({ data: null, error: { code: '42703', message: 'column proyeccion does not exist' } });
        }
        // Como PostgREST: solo devuelve las columnas pedidas.
        const { proyeccion, ...sinProyeccion } = bd.filaLista as Record<string, unknown>;
        return Promise.resolve({ data: ultima.includes('proyeccion') ? bd.filaLista : sinProyeccion, error: null });
      };
      return cadena;
    },
  },
}));

import { guardarPackingList, obtenerPackingList } from '../src/services/packing-list-service.js';
import { guardarPackingListSchema } from '../src/schemas/packing-lists.js';
import { calcularProyeccion, kgPorLote } from '../../frontend/src/lib/proyeccion-packing';

const ID = '11111111-1111-4111-8111-111111111111';
const base = {
  contenedor: 'SEKU-1', fecha: '2026-01-01', tipoEmbalaje: 'big_bag', esPcb: true,
  items: [
    { numero: 1, lote: '1', pesoBruto: 100, pesoPaleta: 5 },
    { numero: 2, lote: '2', pesoBruto: 50, pesoPaleta: 0 },
    { numero: 3, lote: '1', pesoBruto: 40, pesoPaleta: 0 },
  ],
};
const entrada = (extra: Record<string, unknown> = {}) => guardarPackingListSchema.parse({ ...base, ...extra });
const fila = (proyeccion: unknown) => ({
  id: ID, contenedor: 'SEKU-1', fecha: '2026-01-01', tipo_embalaje: 'big_bag', es_pcb: true,
  descripcion_es: null, descripcion_en: null, observaciones_es: null, observaciones_en: null,
  referencia_tipo: null, referencia_id: null, created_at: 'x', updated_at: 'y', version: 2, proyeccion,
});

beforeEach(() => {
  bd.rpc.mockReset();
  bd.selects.length = 0;
  bd.errorConProyeccion = false;
  bd.filaLista = fila([{ lote: '1', valor_kg_usd: 2.5 }]);
  bd.rpc.mockResolvedValue({ data: { id: ID, version: 2 }, error: null });
});

describe('esquema: proyeccion', () => {
  it('es opcional: sin el campo queda undefined (no toca lo guardado)', () => {
    expect(entrada().proyeccion).toBeUndefined();
  });
  it('acepta valores por lote', () => {
    expect(entrada({ proyeccion: [{ lote: '1', valorKgUsd: 2.5 }] }).proyeccion).toEqual([{ lote: '1', valorKgUsd: 2.5 }]);
  });
  it('lista vacía es válida (limpia la proyección)', () => {
    expect(entrada({ proyeccion: [] }).proyeccion).toEqual([]);
  });
  it('rechaza valores negativos, con más de 4 decimales, enormes o texto', () => {
    for (const v of [-1, 1.23456, 2_000_000, '3']) {
      expect(guardarPackingListSchema.safeParse({ ...base, proyeccion: [{ lote: '1', valorKgUsd: v }] }).success).toBe(false);
    }
  });
  it('rechaza lotes repetidos', () => {
    const r = guardarPackingListSchema.safeParse({ ...base, proyeccion: [{ lote: '1', valorKgUsd: 1 }, { lote: '1', valorKgUsd: 2 }] });
    expect(r.success).toBe(false);
  });
  it('descarta líneas de lotes que no están en los ítems', () => {
    const r = entrada({ proyeccion: [{ lote: '1', valorKgUsd: 1 }, { lote: '9', valorKgUsd: 3 }] });
    expect(r.proyeccion).toEqual([{ lote: '1', valorKgUsd: 1 }]);
  });
  it('lote vacío corresponde a los ítems sin lote', () => {
    const r = guardarPackingListSchema.parse({ ...base, esPcb: false, proyeccion: [{ lote: '', valorKgUsd: 4 }] });
    expect(r.proyeccion).toEqual([{ lote: '', valorKgUsd: 4 }]);
  });
});

describe('guardarPackingList: proyeccion y permisos', () => {
  const cabeceraEnviada = () => bd.rpc.mock.calls[0][1].p_cabecera as Record<string, unknown>;

  it('con permiso de valores envía la proyección en snake_case dentro de la cabecera', async () => {
    await guardarPackingList(null, entrada({ proyeccion: [{ lote: '1', valorKgUsd: 2.5 }] }), 'u1', { puedeVerValores: true });
    expect(cabeceraEnviada().proyeccion).toEqual([{ lote: '1', valor_kg_usd: 2.5 }]);
  });
  it('sin permiso de valores NO envía la clave (la BD conserva lo guardado)', async () => {
    await guardarPackingList(ID, entrada({ version: 2, proyeccion: [{ lote: '1', valorKgUsd: 99 }] }), 'u1', { puedeVerValores: false });
    expect('proyeccion' in cabeceraEnviada()).toBe(false);
  });
  it('sin opciones falla cerrado (no envía la clave)', async () => {
    await guardarPackingList(ID, entrada({ version: 2, proyeccion: [{ lote: '1', valorKgUsd: 99 }] }), 'u1');
    expect('proyeccion' in cabeceraEnviada()).toBe(false);
  });
  it('con permiso pero sin el campo en el cuerpo tampoco envía la clave', async () => {
    await guardarPackingList(ID, entrada({ version: 2 }), 'u1', { puedeVerValores: true });
    expect('proyeccion' in cabeceraEnviada()).toBe(false);
  });
});

describe('obtenerPackingList: proyeccion', () => {
  it('con permiso devuelve la proyección en camelCase', async () => {
    const p = await obtenerPackingList(ID, { puedeVerValores: true });
    expect(p?.proyeccion).toEqual([{ lote: '1', valorKgUsd: 2.5 }]);
  });
  it('sin permiso no la lee ni la devuelve', async () => {
    const p = await obtenerPackingList(ID);
    expect(p && 'proyeccion' in p).toBe(false);
    expect(bd.selects.every(s => !s.includes('proyeccion'))).toBe(true);
  });
  it('si la migración no está aplicada, el detalle sigue cargando con proyección vacía', async () => {
    bd.errorConProyeccion = true;
    const p = await obtenerPackingList(ID, { puedeVerValores: true });
    expect(p?.id).toBe(ID);
    expect(p?.proyeccion).toEqual([]);
  });
});

describe('cálculo de la proyección (frontend/lib)', () => {
  const filas = [
    { numero: 1, numeroPaleta: null, lote: '1', color: null, pesoBruto: 100, pesoPaleta: 5 },
    { numero: 2, numeroPaleta: null, lote: '2', color: null, pesoBruto: 50, pesoPaleta: 0 },
    { numero: 3, numeroPaleta: null, lote: '1', color: null, pesoBruto: 40, pesoPaleta: 0 },
    { numero: 4, numeroPaleta: null, lote: null, color: null, pesoBruto: 10, pesoPaleta: 0 },
  ];
  it('suma el neto por lote en orden de aparición; sin lote usa clave vacía', () => {
    expect(kgPorLote(filas)).toEqual([{ lote: '1', kg: 135 }, { lote: '2', kg: 50 }, { lote: '', kg: 10 }]);
  });
  it('total por lote = kg x valor y totales generales', () => {
    const r = calcularProyeccion(kgPorLote(filas), { '1': 2.5, '2': 4 });
    expect(r.lineas).toEqual([
      { lote: '1', kg: 135, valorKgUsd: 2.5, totalUsd: 337.5 },
      { lote: '2', kg: 50, valorKgUsd: 4, totalUsd: 200 },
      { lote: '', kg: 10, valorKgUsd: null, totalUsd: 0 },
    ]);
    expect(r.totalKg).toBe(195);
    expect(r.totalUsd).toBe(537.5);
  });
  it('redondea a 2 decimales sin arrastrar error de coma flotante', () => {
    const r = calcularProyeccion([{ lote: 'A', kg: 0.3 }], { A: 0.1 });
    expect(r.totalUsd).toBe(0.03);
  });
});
