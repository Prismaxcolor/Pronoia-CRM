import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});

const inv = vi.hoisted(() => ({ obtenerInventarioAlmacen: vi.fn() }));
vi.mock('../src/services/inventario-service.js', () => ({ obtenerInventarioAlmacen: inv.obtenerInventarioAlmacen, obtenerInventario: vi.fn() }));

const { obtenerResumenInventario, resolverRangoMerma } = await import('../src/services/inventario-resumen-service.js');
const { invalidarCacheResumen } = await import('../src/services/resumen-cache.js');

const G1 = 'g1';
const G2 = 'g2';
const art = (productoId: string, nombre: string, stock: number, loteId: string | null = null) => ({
  productoId, nombre, destinoTipo: loteId ? 'lote' : 'mpp', loteId, stock,
});

beforeEach(() => {
  invalidarCacheResumen();
  bdFalsa.reiniciar();
  inv.obtenerInventarioAlmacen.mockReset();
  bdFalsa.tablas.almacenes = [{ id: G1, nombre: 'ALMACEN G1', activo: true }, { id: G2, nombre: 'ALMACEN G2', activo: true }];
  bdFalsa.tablas.lotes = [
    { id: 'L1', nombre: 'LOTE 1', activo: true, clase: 'exportacion', precio_estimado_kg: '2' },
    { id: 'L4', nombre: 'LOTE 4', activo: true, clase: 'exportacion', precio_estimado_kg: null },
    { id: 'B', nombre: 'BGPP', activo: true, clase: 'trabajo', precio_estimado_kg: null },
  ];
  bdFalsa.tablas.lote_embalajes = [
    { lote_id: 'L1', almacen_id: null, peso_kg: '400', anulado: false },
    { lote_id: 'L1', almacen_id: null, peso_kg: '999', anulado: true },
  ];
  bdFalsa.tablas.productos = [{ id: 'p-cat', vendible: false }, { id: 'p-basura', vendible: true }];
  bdFalsa.tablas.detalle_facturas_compra = [
    { id: 'd1', producto_id: 'p-basura', peso: '100', subtotal: '10' },
    { id: 'd2', producto_id: 'p-basura', peso: '300', subtotal: '60' },
  ];
  bdFalsa.tablas.configuracion_inventario = [{ clave: 'meta_contenedor_kg', valor: '18000' }];
  inv.obtenerInventarioAlmacen.mockImplementation(async (id: string) =>
    id === G1
      ? [{ tipoMaterialId: null, nombreCategoria: 'Lotes', totalKg: 1000, articulos: [art('__lote_adj__L1', 'LOTE 1', 1000, 'L1')] }]
      : [
          { tipoMaterialId: null, nombreCategoria: 'Lotes', totalKg: 520, articulos: [art('__lote_adj__L1', 'LOTE 1', 500, 'L1'), art('__lote_adj__L4', 'LOTE 4', 20, 'L4')] },
          { tipoMaterialId: 'tm-b', nombreCategoria: 'Basura', totalKg: 200, articulos: [art('p-basura', 'BASURA', 200)] },
          { tipoMaterialId: 'tm-pgm', nombreCategoria: 'PGM', totalKg: 50, articulos: [art('p-cat', 'CATALIZADORES COMPLETOS', 50)] },
        ]
  );
});

describe('obtenerResumenInventario', () => {
  it('arma todo el resumen en una llamada, leyendo el inventario UNA vez por almacen (sin RPC por lote)', async () => {
    const r = await obtenerResumenInventario({ hoy: '2026-10-03', incluirValor: true });
    expect(inv.obtenerInventarioAlmacen).toHaveBeenCalledTimes(2);
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
    expect(r.totalKg).toBe(1770);
    expect(r.almacenes.map(a => [a.nombre, a.totalKg])).toEqual([['ALMACEN G1', 1000], ['ALMACEN G2', 770]]);
    expect(r.lotes.items.find(l => l.nombre === 'LOTE 1')).toMatchObject({ stockKg: 1500, embaladoKg: 400, enSacaKg: 1100, valorEstimadoUsd: 3000 });
    expect(r.exportacion).toEqual({ stockKg: 1520, listoKg: 400, enSacaKg: 1120 });
    expect(r.contenedor).toMatchObject({ metaKg: 18000, listoKg: 400 });
  });

  it('valor a costo (promedio ponderado de facturas) y valor de venta de lotes quedan separados, con kg sin costo / sin precio', async () => {
    const r = await obtenerResumenInventario({ hoy: '2026-10-03', incluirValor: true });
    // basura: (10+60)/(100+300) = 0.175 USD/kg x 200 kg
    expect(r.valor.costoMateriales).toMatchObject({ valorUsd: 35, kgConCosto: 200, kgSinCosto: 50 });
    expect(r.valor.costoMateriales.productosSinCosto).toEqual([{ productoId: 'p-cat', nombre: 'CATALIZADORES COMPLETOS', kg: 50 }]);
    expect(r.valor.ventaEstimadaLotes).toMatchObject({ valorUsd: 3000, kgConPrecio: 1500, kgSinPrecio: 20 });
    expect(r.valor.ventaEstimadaLotes.lotesSinPrecio.map(l => l.nombre)).toEqual(['LOTE 4']);
    expect(r.materiales.kgNoVendible).toBe(50);
  });

  it('el rango por defecto son los ultimos 30 dias y se compara con el periodo anterior de igual duracion', async () => {
    const r = await obtenerResumenInventario({ hoy: '2026-10-03', incluirValor: true });
    expect(r.merma.actual).toMatchObject({ desde: '2026-09-04', hasta: '2026-10-03' });
    expect(r.merma.anterior).toMatchObject({ desde: '2026-08-05', hasta: '2026-09-03' });
    expect(r.merma.umbralPct).toBe(8);
  });

  it('un rango pedido manda sobre el por defecto', async () => {
    const r = await obtenerResumenInventario({ desde: '2026-09-01', hasta: '2026-09-30', incluirValor: true });
    expect(r.merma.actual).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(r.merma.anterior).toMatchObject({ desde: '2026-08-02', hasta: '2026-08-31' });
  });

  it('rango invalido lanza un error claro', async () => {
    await expect(obtenerResumenInventario({ desde: '2026-10-02', hasta: '2026-10-01' })).rejects.toThrow(/Rango de fechas inválido/);
    await expect(obtenerResumenInventario({ desde: '2026-10-02' })).rejects.toThrow(/Rango de fechas inválido/);
  });

  it('tolerante a migraciones pendientes: sin columnas de clase/precio ni tablas nuevas, igual responde (lotes = otro, sin embalado)', async () => {
    bdFalsa.tablas.lotes = [{ id: 'L1', nombre: 'LOTE 1', activo: true }];
    bdFalsa.errores.lote_embalajes = { code: '42P01', message: 'relation does not exist' };
    bdFalsa.errores.configuracion_inventario = { code: '42P01', message: 'relation does not exist' };
    bdFalsa.errores.productos = { code: '42703', message: 'column productos.vendible does not exist' };
    const r = await obtenerResumenInventario({ hoy: '2026-10-03', incluirValor: true });
    expect(r.lotes.items[0]).toMatchObject({ clase: 'otro', precioEstimadoKg: null, embaladoKg: 0 });
    expect(r.contenedor.metaKg).toBe(18000);
    expect(r.materiales.kgNoVendible).toBe(0);
    expect(r.avisos).toEqual([]);
  });

  it('si no se pueden leer los costos avisa en vez de mostrar un valor engañoso', async () => {
    bdFalsa.errores.detalle_facturas_compra = { message: 'timeout' };
    const r = await obtenerResumenInventario({ hoy: '2026-10-03', incluirValor: true });
    expect(r.avisos.join(' ')).toMatch(/costos de compra/);
    expect(r.valor.costoMateriales.kgConCosto).toBe(0);
  });
});

describe('resolverRangoMerma', () => {
  it('ambos extremos o ninguno', () => {
    expect(resolverRangoMerma({ hoy: '2026-10-03' })).toEqual({ desde: '2026-09-04', hasta: '2026-10-03' });
    expect(resolverRangoMerma({ desde: '2026-10-01' })).toBeNull();
    expect(resolverRangoMerma({ desde: '2026-10-05', hasta: '2026-10-01' })).toBeNull();
    expect(resolverRangoMerma({ desde: 'abc', hasta: '2026-10-01' })).toBeNull();
  });
});
