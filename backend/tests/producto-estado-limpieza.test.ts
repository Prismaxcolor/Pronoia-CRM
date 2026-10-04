import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * productos.estado_limpieza (limpio / sucio / sin definir): esquema zod, servicio de productos
 * (crear/editar/listar) y tolerancia a la migración pendiente (columna inexistente = se ignora el campo, sin 500).
 */

const bd = vi.hoisted(() => ({
  columnaExiste: true,
  categoria: 'No Ferroso' as string | null,
  tipoActual: 'amarillo',
  filas: [] as Array<Record<string, unknown>>,
  escrituras: [] as Array<{ tipo: 'insert' | 'update'; valores: Record<string, unknown> }>,
}));

const ERROR_COLUMNA = { code: 'PGRST204', message: "Could not find the 'estado_limpieza' column of 'productos' in the schema cache" };

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: async () => ({ data: null, error: null }),
    from: (tabla: string) => {
      let op: 'select' | 'insert' | 'update' = 'select';
      let valores: Record<string, unknown> = {};
      const resultado = () => {
        if (op === 'select') return { data: tabla === 'productos' ? bd.filas : [], error: null };
        if (!bd.columnaExiste && 'estado_limpieza' in valores) return { data: null, error: ERROR_COLUMNA };
        bd.escrituras.push({ tipo: op, valores });
        return { data: { id: 'p1', creado_en: '2026-10-04', tipo: bd.tipoActual, ...valores }, error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () => b,
        insert: (v: Record<string, unknown>) => { op = 'insert'; valores = v; return b; },
        update: (v: Record<string, unknown>) => { op = 'update'; valores = v; return b; },
        maybeSingle: async () => {
          if (tabla === 'tipos_material') return { data: bd.categoria ? { nombre: bd.categoria } : null, error: null };
          if (op === 'select') return { data: tabla === 'productos' ? { tipo: bd.tipoActual } : null, error: null };
          return resultado();
        },
        single: async () => resultado(),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(res, rej),
      };
      return b;
    },
  },
}));

const { crearProductoSchema } = await import('../src/schemas/productos.js');
const { crearProducto, actualizarProducto, listarProductos } = await import('../src/services/producto-service.js');

const BASE = { nombre: 'PERFIL', descripcion: '', tipoMaterialId: '11111111-1111-4111-8111-111111111111', moneda: 'USD', tipo: 'amarillo', peso: 0 };

beforeEach(() => {
  bd.columnaExiste = true;
  bd.categoria = 'No Ferroso';
  bd.tipoActual = 'amarillo';
  bd.filas = [];
  bd.escrituras = [];
});

describe('schema: estadoLimpieza', () => {
  it('acepta limpio, sucio, null y ausente; rechaza otros valores', () => {
    expect(crearProductoSchema.safeParse({ ...BASE, estadoLimpieza: 'limpio' }).success).toBe(true);
    expect(crearProductoSchema.safeParse({ ...BASE, estadoLimpieza: 'sucio' }).success).toBe(true);
    expect(crearProductoSchema.safeParse({ ...BASE, estadoLimpieza: null }).success).toBe(true);
    const sin = crearProductoSchema.safeParse(BASE);
    expect(sin.success && sin.data.estadoLimpieza).toBeUndefined();
    expect(crearProductoSchema.safeParse({ ...BASE, estadoLimpieza: 'medio' }).success).toBe(false);
    expect(crearProductoSchema.safeParse({ ...BASE, estadoLimpieza: '' }).success).toBe(false);
  });
});

describe('crearProducto / actualizarProducto con estadoLimpieza', () => {
  it('crea guardando estado_limpieza y lo devuelve en el producto publico', async () => {
    const r = await crearProducto(crearProductoSchema.parse({ ...BASE, estadoLimpieza: 'sucio' }), 'u1');
    expect(bd.escrituras[0].valores).toMatchObject({ estado_limpieza: 'sucio' });
    expect(r).toMatchObject({ producto: { estadoLimpieza: 'sucio' } });
  });

  it('crear sin estado no envia la columna (sirve con la migracion pendiente) y el publico trae null', async () => {
    const r = await crearProducto(crearProductoSchema.parse(BASE), 'u1');
    expect('estado_limpieza' in bd.escrituras[0].valores).toBe(false);
    expect(r).toMatchObject({ producto: { estadoLimpieza: null } });
  });

  it('editar: ausente no toca el campo; null lo borra (sin definir); un valor lo cambia', async () => {
    await actualizarProducto('p1', crearProductoSchema.parse(BASE));
    expect('estado_limpieza' in bd.escrituras[0].valores).toBe(false);
    await actualizarProducto('p1', crearProductoSchema.parse({ ...BASE, estadoLimpieza: null }));
    expect(bd.escrituras[1].valores).toMatchObject({ estado_limpieza: null });
    await actualizarProducto('p1', crearProductoSchema.parse({ ...BASE, estadoLimpieza: 'limpio' }));
    expect(bd.escrituras[2].valores).toMatchObject({ estado_limpieza: 'limpio' });
  });

  it('solo aplica a Ferroso y No ferroso: en otra categoria se rechaza un valor (null si se permite)', async () => {
    bd.categoria = 'PCB';
    const crear = await crearProducto(crearProductoSchema.parse({ ...BASE, estadoLimpieza: 'sucio' }), 'u1');
    expect(crear).toMatchObject({ error: expect.stringMatching(/Ferroso/) });
    const editar = await actualizarProducto('p1', crearProductoSchema.parse({ ...BASE, estadoLimpieza: 'limpio' }));
    expect(editar).toMatchObject({ error: expect.stringMatching(/Ferroso/) });
    expect(bd.escrituras).toEqual([]);
    const nulo = await actualizarProducto('p1', crearProductoSchema.parse({ ...BASE, estadoLimpieza: null }));
    expect('producto' in nulo).toBe(true);
  });

  it('migracion pendiente: sin la columna ignora el campo y guarda el resto, sin error', async () => {
    bd.columnaExiste = false;
    const c = await crearProducto(crearProductoSchema.parse({ ...BASE, estadoLimpieza: 'sucio' }), 'u1');
    expect('producto' in c).toBe(true);
    expect('estado_limpieza' in bd.escrituras[0].valores).toBe(false);
    expect(bd.escrituras[0].valores).toMatchObject({ nombre: 'PERFIL' });
    const e = await actualizarProducto('p1', crearProductoSchema.parse({ ...BASE, estadoLimpieza: 'limpio' }));
    expect('producto' in e).toBe(true);
    expect('estado_limpieza' in bd.escrituras[1].valores).toBe(false);
  });
});

describe('listarProductos', () => {
  it('expone estadoLimpieza (limpio/sucio/null) y trata valores raros o columna ausente como null', async () => {
    const fila = { nombre: 'X', descripcion: '', tipo_material_id: 't', moneda: 'USD', activo: true, tipo: 'amarillo', fotos: [], creado_en: 'z', peso: 1 };
    bd.filas = [
      { ...fila, id: 'a', estado_limpieza: 'sucio' },
      { ...fila, id: 'b', estado_limpieza: 'limpio' },
      { ...fila, id: 'c', estado_limpieza: null },
      { ...fila, id: 'd' },
      { ...fila, id: 'e', estado_limpieza: 'raro' },
    ];
    expect((await listarProductos()).map(p => p.estadoLimpieza)).toEqual(['sucio', 'limpio', null, null, null]);
  });
});
