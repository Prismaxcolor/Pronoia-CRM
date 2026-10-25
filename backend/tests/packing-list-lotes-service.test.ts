import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({
  lotes: [] as Array<Record<string, unknown>>,
  stock: {} as Record<string, Array<{ almacen_id: string; stock: number }>>,
  rpc: vi.fn(),
  /** Lotes cuya lectura de stock falla. */
  fallan: new Set<string>(),
}));
const CON_DISPONIBLE = { puedeVerDisponible: true };

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (nombre: string, args: { p_lote_id: string }) => {
      bd.rpc(nombre, args);
      if (bd.fallan.has(args.p_lote_id)) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: bd.stock[args.p_lote_id] ?? [], error: null });
    },
    from: (tabla: string) => {
      const datos: Record<string, unknown[]> = {
        lotes: bd.lotes,
        almacenes: [{ id: 'a1', nombre: 'Norte' }, { id: 'a2', nombre: 'Sur' }],
        tipos_material: [{ id: 'c-pcb', nombre: 'PCB' }, { id: 'c-pgm', nombre: 'PGM' }],
      };
      const resultado = Promise.resolve({ data: datos[tabla] ?? [], error: null });
      const cadena: Record<string, unknown> = { then: resultado.then.bind(resultado) };
      cadena.select = () => cadena;
      cadena.eq = () => cadena;
      return cadena;
    },
  },
}));

vi.mock('../src/services/toma-fisica-opciones-service.js', () => ({
  cargarLotesParaToma: () =>
    Promise.resolve([
      { id: 'l1', nombre: 'LOTE 1', categoriaIdsAncladas: ['c-pcb'] },
      { id: 'l4', nombre: 'LOTE 4', categoriaIdsAncladas: ['c-pgm'] },
    ]),
}));

import { listarOpcionesLotePacking } from '../src/services/packing-list-lotes-service.js';

beforeEach(() => {
  bd.rpc.mockReset();
  bd.fallan.clear();
  bd.lotes = [
    { id: 'l1', nombre: 'LOTE 1', activo: true, clase: 'exportacion', color_packing_list: 'green' },
    { id: 'l4', nombre: 'LOTE 4', activo: true, clase: 'exportacion', color_packing_list: null },
    { id: 'lt', nombre: 'BGPP', activo: true, clase: 'trabajo', color_packing_list: null },
  ];
  bd.stock = { l1: [{ almacen_id: 'a2', stock: 450 }, { almacen_id: 'a1', stock: 800 }, { almacen_id: 'a3', stock: 0 }] };
});

describe('listarOpcionesLotePacking', () => {
  it('ofrece solo lotes de exportación de PCB (sin catalizadores ni lotes de trabajo), con kg por almacén', async () => {
    const opciones = await listarOpcionesLotePacking(CON_DISPONIBLE);
    expect(opciones.map(o => [o.nombre, o.almacenNombre, o.disponibleKg, o.colorPredeterminado])).toEqual([
      ['LOTE 1', 'Norte', 800, 'green'],
      ['LOTE 1', 'Sur', 450, 'green'],
    ]);
  });

  it('solo lee stock: no hay llamadas de escritura (solo la función de lectura por almacén)', async () => {
    await listarOpcionesLotePacking(CON_DISPONIBLE);
    expect(bd.rpc.mock.calls.every(([nombre]) => nombre === 'stock_lote_por_almacen')).toBe(true);
  });

  it('un color guardado que ya no está en el catálogo no se ofrece', async () => {
    bd.lotes[0].color_packing_list = 'fucsia';
    expect((await listarOpcionesLotePacking(CON_DISPONIBLE))[0].colorPredeterminado).toBeNull();
  });

  it('sin la migración de clasificación (sin columna clase ni color) se usan los lotes numerados', async () => {
    bd.lotes = [{ id: 'l1', nombre: 'LOTE 1', activo: true }, { id: 'lt', nombre: 'BGPP', activo: true }];
    const opciones = await listarOpcionesLotePacking(CON_DISPONIBLE);
    expect(opciones.map(o => o.nombre)).toEqual(['LOTE 1', 'LOTE 1']);
    expect(opciones[0].colorPredeterminado).toBeNull();
  });

  it('sin permiso de inventario devuelve el lote sin kg ni almacén y no lee el stock', async () => {
    const opciones = await listarOpcionesLotePacking();
    expect(opciones).toEqual([
      { loteId: 'l1', nombre: 'LOTE 1', valor: '1', almacenId: null, almacenNombre: null, disponibleKg: null, colorPredeterminado: 'green' },
    ]);
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('si falla la lectura del stock el lote se marca como no leído (no 0 kg)', async () => {
    bd.fallan.add('l1');
    const opciones = await listarOpcionesLotePacking(CON_DISPONIBLE);
    expect(opciones).toHaveLength(1);
    expect(opciones[0]).toMatchObject({ nombre: 'LOTE 1', disponibleKg: null, disponibilidadNoLeida: true, almacenId: null });
  });
});
