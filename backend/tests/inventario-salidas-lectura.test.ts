import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({ sinColumna: false, selects: [] as string[] }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      let columnas = '';
      const b: Record<string, unknown> = {};
      b.select = (c: string) => { columnas = c; bd.selects.push(c); return b; };
      b.is = () => b;
      b.eq = () => b;
      b.order = () => b;
      b.range = () =>
        Promise.resolve(
          bd.sinColumna && columnas.includes('completado_en')
            ? { data: null, error: { code: '42703', message: 'column transformaciones.completado_en does not exist' } }
            : { data: [], error: null }
        );
      return b;
    },
  },
}));

import { leerSalidasAlmacen } from '../src/services/inventario-salidas-lectura.js';

beforeEach(() => { bd.sinColumna = false; bd.selects = []; });

describe('leerSalidasAlmacen', () => {
  it('sin pedir completado_en no degrada', async () => {
    expect(await leerSalidasAlmacen('a1', false)).toEqual({ salidas: [], sinCompletadoEn: false });
  });

  it('con completado_en disponible no degrada', async () => {
    expect(await leerSalidasAlmacen('a1', true)).toEqual({ salidas: [], sinCompletadoEn: false });
  });

  it('si falta la columna lee sin ella y avisa que degradó', async () => {
    bd.sinColumna = true;
    const r = await leerSalidasAlmacen('a1', true);
    expect(r.sinCompletadoEn).toBe(true);
    expect(bd.selects.some(s => !s.includes('completado_en'))).toBe(true);
  });
});
