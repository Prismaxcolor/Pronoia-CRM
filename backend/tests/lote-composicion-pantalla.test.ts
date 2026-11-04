import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  armarComposicion,
  calcularCompradoPeriodo,
  hayStockHeredado,
  type CompraDirectaLote,
  type SalidaHaciaLote,
} from '../src/utils/lote-composicion-pantalla.js';
import { composicionLoteQuerySchema } from '../src/schemas/lote-composicion.js';

// ---- base de datos y autenticación falsas ----------------------------------------------------------------------

const usuarios: Record<string, { rol: string; permisos: unknown; activo: boolean }> = {};
type Filtros = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  tablas: {} as Record<string, (f: Filtros) => unknown[]>,
  rpc: {} as Record<string, (args: Record<string, unknown>) => unknown>,
  rpcLlamadas: [] as string[],
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const filtros: Filtros = {};
      let unico = false;
      const resolver = () => {
        if (tabla === 'users') {
          const u = usuarios[String(filtros.id)];
          return { data: u ?? null, error: null };
        }
        const filas = bd.tablas[tabla]?.(filtros) ?? [];
        return { data: unico ? (filas[0] ?? null) : filas, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => { filtros[c] = v; return b; },
        in: (c: string, v: unknown) => { filtros[c] = v; return b; },
        order: () => b,
        range: (d: number) => (d > 0 ? Promise.resolve({ data: [], error: null }) : Promise.resolve(resolver())),
        maybeSingle: async () => { unico = true; return resolver(); },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(resolver()).then(ok),
      };
      return b;
    },
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      bd.rpcLlamadas.push(nombre);
      return { data: bd.rpc[nombre]?.(args) ?? null, error: null };
    },
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));

const { default: inventarioRouter } = await import('../src/routes/inventario.js');

const LOTE = '11111111-1111-4111-8111-111111111111';
const G1 = '44444444-4444-4444-8444-444444444444';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let servidor: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use('/api/inventario', inventarioRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

async function pedir(ruta: string, usuario: string | null) {
  const res = await fetch(`${base}/api/inventario/pantalla/lotes/${ruta}`, {
    headers: usuario ? { Authorization: `Bearer ${usuario}` } : {},
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

// ---- lógica pura -----------------------------------------------------------------------------------------------

const compra = (productoId: string, pesoKg: number, fecha: string, almacenId: string | null = G1): CompraDirectaLote => ({ productoId, pesoKg, fecha, almacenId });
const salida = (over: Partial<SalidaHaciaLote>): SalidaHaciaLote => ({
  transformacionId: 't1', productoId: null, pesoNeto: 100, fecha: '2026-10-01', completa: true, almacenId: G1,
  entradas: [{ productoId: A, pesoKg: 60 }, { productoId: B, pesoKg: 40 }], ...over,
});

describe('calcularCompradoPeriodo', () => {
  it('suma las compras directas dentro del rango y excluye las de fuera', () => {
    const r = calcularCompradoPeriodo([compra(A, 10, '2026-09-20'), compra(A, 5, '2026-10-02'), compra(B, 7, '2026-09-10')], [], { desde: '2026-09-15', hasta: '2026-10-03' });
    expect(r.porProducto.get(A)).toBe(15);
    expect(r.porProducto.has(B)).toBe(false);
    expect(r.kgProporcional).toBe(0);
  });

  it('sin rango cuenta todo el historial', () => {
    const r = calcularCompradoPeriodo([compra(A, 10, '2026-01-01'), compra(A, 5, '2026-10-02')], [], {});
    expect(r.porProducto.get(A)).toBe(15);
  });

  it('reparte en proporción lo que una transformación completa entregó sin producto', () => {
    const r = calcularCompradoPeriodo([], [salida({})], {});
    expect(r.porProducto.get(A)).toBeCloseTo(60);
    expect(r.porProducto.get(B)).toBeCloseTo(40);
    expect(r.kgProporcional).toBe(100);
  });

  it('una salida con producto es exacta, no proporcional', () => {
    const r = calcularCompradoPeriodo([], [salida({ productoId: B })], {});
    expect(r.porProducto.get(B)).toBe(100);
    expect(r.porProducto.has(A)).toBe(false);
    expect(r.kgProporcional).toBe(0);
  });

  it('ignora transformaciones no completas y fuera de rango', () => {
    const r = calcularCompradoPeriodo([], [salida({ completa: false }), salida({ fecha: '2026-08-01' })], { desde: '2026-09-01', hasta: '2026-10-04' });
    expect(r.porProducto.size).toBe(0);
    expect(r.kgProporcional).toBe(0);
  });

  it('la parte de entrada sin producto no se atribuye a ningún producto', () => {
    const r = calcularCompradoPeriodo([], [salida({ entradas: [{ productoId: A, pesoKg: 50 }, { productoId: null, pesoKg: 50 }] })], {});
    expect(r.porProducto.get(A)).toBeCloseTo(50);
    expect(r.kgSinProducto).toBeCloseTo(50);
  });

  it('una transformación sin entradas registradas no inventa productos', () => {
    const r = calcularCompradoPeriodo([], [salida({ entradas: [] })], {});
    expect(r.porProducto.size).toBe(0);
    expect(r.kgProporcional).toBe(0);
  });

  it('filtra por almacén compras y salidas', () => {
    const r = calcularCompradoPeriodo([compra(A, 10, '2026-10-01', 'otro'), compra(A, 3, '2026-10-01')], [salida({ almacenId: 'otro' })], { almacenId: G1 });
    expect(r.porProducto.get(A)).toBe(3);
    expect(r.kgProporcional).toBe(0);
  });
});

describe('hayStockHeredado', () => {
  it('true solo si hubo una transformación completa sin producto con entradas', () => {
    expect(hayStockHeredado([salida({})])).toBe(true);
    expect(hayStockHeredado([salida({ productoId: A })])).toBe(false);
    expect(hayStockHeredado([salida({ completa: false })])).toBe(false);
    expect(hayStockHeredado([salida({ entradas: [] })])).toBe(false);
    expect(hayStockHeredado([salida({ almacenId: 'otro' })], G1)).toBe(false);
  });
});

describe('armarComposicion', () => {
  const productos = new Map([[A, { nombre: 'Cobre', categoria: 'No ferroso' }], [B, { nombre: 'Aluminio', categoria: 'No ferroso' }]]);
  const sinComprado = { porProducto: new Map<string, number>(), kgProporcional: 0, kgSinProducto: 0 };

  it('ordena por stock, redondea, totaliza y no marca aproximado si todo es exacto', () => {
    const r = armarComposicion({
      nombreLote: 'Lote 1', productos, stockTotalKg: 30,
      stockPorProducto: [{ productoId: A, stock: 10.004 }, { productoId: B, stock: 20 }],
      comprado: { ...sinComprado, porProducto: new Map([[A, 4]]) }, stockHeredado: false,
    });
    expect(r.items.map(i => i.producto)).toEqual(['Aluminio', 'Cobre']);
    expect(r.items[1]).toMatchObject({ kgActual: 10, kgCompradoPeriodo: 4 });
    expect(r.totales).toEqual({ kgActual: 30, kgCompradoPeriodo: 4 });
    expect(r.aproximado).toBe(false);
    expect(r.nota).toBeNull();
  });

  it('incluye productos comprados en el periodo que ya no tienen stock, y omite saldos negativos', () => {
    const r = armarComposicion({
      nombreLote: 'Lote 1', productos, stockTotalKg: 5,
      stockPorProducto: [{ productoId: A, stock: 5 }, { productoId: B, stock: -3 }],
      comprado: { ...sinComprado, porProducto: new Map([[B, 8]]) }, stockHeredado: false,
    });
    expect(r.items.find(i => i.productoId === B)).toMatchObject({ kgActual: 0, kgCompradoPeriodo: 8 });
  });

  it('nunca inventa productos que no están en el catálogo leído', () => {
    const r = armarComposicion({
      nombreLote: 'Lote 1', productos, stockTotalKg: 5,
      stockPorProducto: [{ productoId: 'fantasma', stock: 5 }], comprado: sinComprado, stockHeredado: false,
    });
    expect(r.items).toEqual([]);
  });

  it('marca aproximado y explica en español la parte por transformación', () => {
    const r = armarComposicion({
      nombreLote: 'Lote 1', productos, stockTotalKg: 100,
      stockPorProducto: [{ productoId: A, stock: 60 }, { productoId: B, stock: 40 }],
      comprado: { porProducto: new Map([[A, 60], [B, 40]]), kgProporcional: 100, kgSinProducto: 0 }, stockHeredado: true,
    });
    expect(r.aproximado).toBe(true);
    expect(r.nota).toContain('Del Lote 1, 100 kg llegaron por transformación');
    expect(r.nota).toContain('en proporción a lo que entró');
  });

  it('avisa los kilos del stock sin producto asignado', () => {
    const r = armarComposicion({
      nombreLote: 'Lote 2', productos, stockTotalKg: 50,
      stockPorProducto: [{ productoId: A, stock: 30 }], comprado: sinComprado, stockHeredado: false,
    });
    expect(r.aproximado).toBe(false);
    expect(r.nota).toContain('20 kg del stock del Lote 2 no tienen producto asignado');
  });
});

describe('composicionLoteQuerySchema', () => {
  it('acepta almacenId y el alias almacen', () => {
    expect(composicionLoteQuerySchema.parse({ almacenId: G1 }).almacenId).toBe(G1);
    expect(composicionLoteQuerySchema.parse({ almacen: G1 }).almacenId).toBe(G1);
  });
  it('exige desde y hasta juntos, en orden', () => {
    expect(composicionLoteQuerySchema.safeParse({ desde: '2026-10-01' }).success).toBe(false);
    expect(composicionLoteQuerySchema.safeParse({ desde: '2026-10-05', hasta: '2026-10-01' }).success).toBe(false);
    expect(composicionLoteQuerySchema.safeParse({ desde: '2026-10-01', hasta: '2026-10-04' }).success).toBe(true);
  });
  it('rechaza un almacén que no es uuid', () => {
    expect(composicionLoteQuerySchema.safeParse({ almacenId: 'x; drop' }).success).toBe(false);
  });
});

// ---- ruta + servicio con base falsa ----------------------------------------------------------------------------

describe('GET /api/inventario/pantalla/lotes/:loteId/composicion', () => {
  beforeEach(() => {
    for (const k of Object.keys(usuarios)) delete usuarios[k];
    usuarios.admin = { rol: 'superadmin', permisos: null, activo: true };
    usuarios.trabajador = { rol: 'trabajador', permisos: null, activo: true };
    bd.rpcLlamadas.length = 0;
    bd.tablas.lotes = f => (f.id === LOTE ? [{ id: LOTE, nombre: 'LOTE 1' }] : []);
    bd.tablas.productos = () => [
      { id: A, nombre: 'Cobre', tipos_material: { nombre: 'No ferroso' } },
      { id: B, nombre: 'Aluminio', tipos_material: null },
    ];
    bd.tablas.detalle_tickets_pesaje = () => [
      { producto_id: A, peso_neto: 25, tickets_pesaje: { fecha: '2026-09-20', almacen_id: G1 } },
      { producto_id: A, peso_neto: 5, tickets_pesaje: { fecha: '2026-10-02', almacen_id: G1 } },
    ];
    bd.tablas.transformacion_salida_detalle = () => [
      { transformacion_id: 't1', producto_id: null, peso_neto: 100, almacen_id: G1, transformaciones: { estado: 'completa', fecha: '2026-10-01', almacen_id: G1 } },
    ];
    bd.tablas.transformacion_entrada_detalle = () => [
      { transformacion_id: 't1', producto_id: B, peso_kg: 80 },
      { transformacion_id: 't1', producto_id: A, peso_kg: 20 },
    ];
    bd.rpc.stock_lote_por_producto = () => [{ producto_id: A, stock: 40 }, { producto_id: B, stock: 80 }];
    bd.rpc.stock_lote_almacen_por_producto = () => [{ producto_id: A, stock: 10 }];
    bd.rpc.stock_lote_total = () => 120;
    bd.rpc.stock_lote_almacen_total = () => 10;
  });

  it('sin sesión: 401', async () => {
    expect((await pedir(`${LOTE}/composicion`, null)).status).toBe(401);
  });

  it('lote con id inválido: 400; lote inexistente: 404', async () => {
    expect((await pedir('no-es-uuid/composicion', 'admin')).status).toBe(400);
    expect((await pedir('99999999-9999-4999-8999-999999999999/composicion', 'admin')).status).toBe(404);
  });

  it('rango incompleto: 400', async () => {
    expect((await pedir(`${LOTE}/composicion?desde=2026-10-01`, 'admin')).status).toBe(400);
  });

  it('devuelve el contrato con stock actual, comprado del periodo y nota de aproximación', async () => {
    const r = await pedir(`${LOTE}/composicion?desde=2026-09-15&hasta=2026-10-04`, 'trabajador');
    expect(r.status).toBe(200);
    const c = r.json!.composicion;
    expect(c.loteId).toBe(LOTE);
    expect(c.aproximado).toBe(true);
    expect(c.totales).toEqual({ kgActual: 120, kgCompradoPeriodo: 130 });
    expect(c.items.find((i: any) => i.productoId === B)).toMatchObject({ producto: 'Aluminio', categoria: 'Sin categoría', kgActual: 80, kgCompradoPeriodo: 80 });
    expect(c.items.find((i: any) => i.productoId === A)).toMatchObject({ producto: 'Cobre', categoria: 'No ferroso', kgActual: 40, kgCompradoPeriodo: 50 });
    expect(c.nota).toContain('Del LOTE 1, 100 kg llegaron por transformación');
    expect(bd.rpcLlamadas).toContain('stock_lote_por_producto');
  });

  it('cambiar el rango cambia lo comprado y deja igual el stock actual', async () => {
    const r = await pedir(`${LOTE}/composicion?desde=2026-10-02&hasta=2026-10-04`, 'admin');
    const c = r.json!.composicion;
    expect(c.totales).toEqual({ kgActual: 120, kgCompradoPeriodo: 5 });
    expect(c.aproximado).toBe(true);
  });

  it('con almacén usa el stock del almacén', async () => {
    const r = await pedir(`${LOTE}/composicion?almacenId=${G1}`, 'admin');
    expect(r.json!.composicion.totales.kgActual).toBe(10);
    expect(bd.rpcLlamadas).toContain('stock_lote_almacen_por_producto');
    expect(bd.rpcLlamadas).not.toContain('stock_lote_por_producto');
  });
});
