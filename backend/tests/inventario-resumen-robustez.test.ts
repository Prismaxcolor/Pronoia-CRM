import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});

const inv = vi.hoisted(() => ({ obtenerInventarioAlmacen: vi.fn() }));
vi.mock('../src/services/inventario-service.js', () => ({ obtenerInventarioAlmacen: inv.obtenerInventarioAlmacen, obtenerInventario: vi.fn() }));

const { obtenerResumenInventario } = await import('../src/services/inventario-resumen-service.js');
const { invalidarCacheResumen } = await import('../src/services/resumen-cache.js');

const G1 = 'g1';
const G2 = 'g2';
const HOY = { hoy: '2026-10-03' };
const art = (productoId: string, nombre: string, stock: number, loteId: string | null = null) => ({
  productoId, nombre, destinoTipo: loteId ? 'lote' : 'mpp', loteId, stock,
});
const grupoLote = (stock: number) => [
  { tipoMaterialId: null, nombreCategoria: 'Lotes', totalKg: stock, articulos: [art('__lote_adj__L1', 'LOTE 1', stock, 'L1')] },
];
const tablasLeidas = (espia: { mock: { calls: unknown[][] } }) => espia.mock.calls.map(c => c[0]);

beforeEach(() => {
  invalidarCacheResumen();
  vi.restoreAllMocks();
  bdFalsa.reiniciar();
  inv.obtenerInventarioAlmacen.mockReset();
  bdFalsa.tablas.almacenes = [{ id: G1, nombre: 'ALMACEN G1', activo: true }, { id: G2, nombre: 'ALMACEN G2', activo: true }];
  bdFalsa.tablas.lotes = [{ id: 'L1', nombre: 'LOTE 1', activo: true, clase: 'exportacion', precio_estimado_kg: '2' }];
  bdFalsa.tablas.lote_embalajes = [{ lote_id: 'L1', almacen_id: null, peso_kg: '400', anulado: false }];
  bdFalsa.tablas.productos = [];
  bdFalsa.tablas.detalle_facturas_compra = [{ id: 'd1', producto_id: 'p', peso: '100', subtotal: '10' }];
  bdFalsa.tablas.configuracion_inventario = [{ clave: 'meta_contenedor_kg', valor: '18000' }];
  inv.obtenerInventarioAlmacen.mockImplementation(async (id: string) => grupoLote(id === G1 ? 1000 : 500));
});

describe('valor oculto (usuario sin facturacion:ver)', () => {
  it('por defecto NO incluye valor y ni siquiera consulta los costos de compra', async () => {
    const espia = vi.spyOn(bdFalsa.cliente, 'from');
    const r = await obtenerResumenInventario(HOY);
    expect(r.valorOculto).toBe(true);
    expect(r.valor).toBeNull();
    expect(tablasLeidas(espia)).not.toContain('detalle_facturas_compra');
    expect(JSON.stringify(r)).not.toMatch(/valorCostoUsd|costoMateriales|ventaEstimadaLotes/);
    expect(r.lotes.items[0]).toMatchObject({ stockKg: 1500, precioEstimadoKg: null, valorEstimadoUsd: null });
    expect(r.avisos).toEqual([]);
  });
  it('con permiso incluye el valor y si consulta los costos', async () => {
    const espia = vi.spyOn(bdFalsa.cliente, 'from');
    const r = await obtenerResumenInventario({ ...HOY, incluirValor: true });
    expect(r.valorOculto).toBe(false);
    expect(r.valor?.ventaEstimadaLotes.valorUsd).toBe(3000);
    expect(tablasLeidas(espia)).toContain('detalle_facturas_compra');
  });
});

describe('lecturas fallidas: avisos en vez de ceros silenciosos', () => {
  it('si falla la lectura de embalajes (no por migracion pendiente) avisa y marca parcial', async () => {
    bdFalsa.errores.lote_embalajes = { code: '57014', message: 'statement timeout' };
    const r = await obtenerResumenInventario(HOY);
    expect(r.avisos.join(' ')).toMatch(/embalad/i);
    expect(r.parcial).toBe(true);
    expect(r.lotes.items[0].embaladoKg).toBe(0);
  });
  it('tabla de embalajes inexistente (migracion pendiente) NO es un aviso', async () => {
    bdFalsa.errores.lote_embalajes = { code: '42P01', message: 'relation "lote_embalajes" does not exist' };
    const r = await obtenerResumenInventario(HOY);
    expect(r.avisos).toEqual([]);
    expect(r.parcial).toBe(false);
  });
  it('si falla la lectura del desglose de merma avisa; los totales de merma siguen', async () => {
    bdFalsa.tablas.transformaciones = [
      { id: 't1', estado: 'completa', fecha: '2026-09-20', peso_neto: '100', categoria: 'ferroso_no_ferroso', created_at: '2026-09-20T10:00:00Z', transformacion_salida_detalle: [{ peso_neto: '90' }] },
    ];
    bdFalsa.errores.transformacion_merma_detalle = { code: '57014', message: 'statement timeout' };
    const r = await obtenerResumenInventario(HOY);
    expect(r.avisos.join(' ')).toMatch(/desglose de merma/i);
    expect(r.merma.actual.transformaciones).toBe(1);
    expect(r.merma.actual.kgMerma).toBe(10);
    expect(r.parcial).toBe(true);
  });
  it('si falla un almacen, ese almacen se omite con aviso (y el resto se muestra)', async () => {
    inv.obtenerInventarioAlmacen.mockImplementation(async (id: string) => {
      if (id === G2) throw new Error('timeout');
      return grupoLote(1000);
    });
    const r = await obtenerResumenInventario(HOY);
    expect(r.parcial).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/ALMACEN G2/);
    expect(r.totalKg).toBe(1000);
  });
});

describe('almacenes inactivos (M3)', () => {
  it('un almacen inactivo con stock se incluye (misma cifra que stock_lote_total) y se avisa', async () => {
    bdFalsa.tablas.almacenes = [...bdFalsa.tablas.almacenes, { id: 'viejo', nombre: 'ALMACEN VIEJO', activo: false }];
    inv.obtenerInventarioAlmacen.mockImplementation(async (id: string) => grupoLote(id === 'viejo' ? 300 : id === G1 ? 1000 : 500));
    const r = await obtenerResumenInventario(HOY);
    expect(r.lotes.items[0].stockKg).toBe(1800);
    expect(r.totalKg).toBe(1800);
    expect(r.almacenes.find(a => a.nombre === 'ALMACEN VIEJO')).toMatchObject({ activo: false, totalKg: 300 });
    expect(r.avisos.join(' ')).toMatch(/ALMACEN VIEJO.*inactivo/);
  });
  it('un almacen inactivo sin stock no genera aviso', async () => {
    bdFalsa.tablas.almacenes = [...bdFalsa.tablas.almacenes, { id: 'vacio', nombre: 'ALMACEN VACIO', activo: false }];
    inv.obtenerInventarioAlmacen.mockImplementation(async (id: string) => (id === 'vacio' ? [] : grupoLote(1000)));
    const r = await obtenerResumenInventario(HOY);
    expect(r.avisos).toEqual([]);
  });
});

describe('rendimiento (M4)', () => {
  it('lee transformaciones y almacenes una sola vez para AMBOS periodos', async () => {
    const espia = vi.spyOn(bdFalsa.cliente, 'from');
    await obtenerResumenInventario(HOY);
    const tablas = tablasLeidas(espia);
    expect(tablas.filter(t => t === 'transformaciones')).toHaveLength(1);
    expect(inv.obtenerInventarioAlmacen).toHaveBeenCalledTimes(2);
  });
  it('con transformaciones, el desglose se lee una vez y solo de sus ids', async () => {
    bdFalsa.tablas.transformaciones = [
      { id: 't-actual', estado: 'completa', fecha: '2026-09-20', peso_neto: '100', created_at: '2026-09-20T10:00:00Z', transformacion_salida_detalle: [{ peso_neto: '90' }] },
      { id: 't-previa', estado: 'completa', fecha: '2026-08-20', peso_neto: '100', created_at: '2026-08-20T10:00:00Z', transformacion_salida_detalle: [{ peso_neto: '95' }] },
    ];
    bdFalsa.tablas.transformacion_merma_detalle = [
      { transformacion_id: 't-actual', tipo: 'basura', peso_kg: '6' },
      { transformacion_id: 't-previa', tipo: 'tierra', peso_kg: '5' },
      { transformacion_id: 'ajena', tipo: 'otro', peso_kg: '99' },
    ];
    const espia = vi.spyOn(bdFalsa.cliente, 'from');
    const r = await obtenerResumenInventario(HOY);
    expect(tablasLeidas(espia).filter(t => t === 'transformacion_merma_detalle')).toHaveLength(1);
    expect(r.merma.actual).toMatchObject({ transformaciones: 1, kgMerma: 10 });
    expect(r.merma.anterior).toMatchObject({ transformaciones: 1, kgMerma: 5 });
    expect(r.merma.actual.tipos.find(t => t.tipo === 'basura')?.kg).toBe(6);
    expect(r.merma.actual.tipos.find(t => t.tipo === 'otro')?.kg).toBe(0);
  });
  it('cache de 20 s: la segunda peticion no recalcula; con y sin valor no se mezclan', async () => {
    const a = await obtenerResumenInventario({ ...HOY, incluirValor: true });
    const b = await obtenerResumenInventario({ ...HOY, incluirValor: true });
    expect(b).toBe(a);
    expect(inv.obtenerInventarioAlmacen).toHaveBeenCalledTimes(2);
    const sinValor = await obtenerResumenInventario(HOY);
    expect(sinValor.valor).toBeNull();
    expect(a.valor).not.toBeNull();
    invalidarCacheResumen();
    await obtenerResumenInventario({ ...HOY, incluirValor: true });
    expect(inv.obtenerInventarioAlmacen).toHaveBeenCalledTimes(6);
  });
  it('un resumen con avisos no se guarda en la cache', async () => {
    bdFalsa.errores.lote_embalajes = { code: '57014', message: 'statement timeout' };
    await obtenerResumenInventario(HOY);
    delete bdFalsa.errores.lote_embalajes;
    const r = await obtenerResumenInventario(HOY);
    expect(r.avisos).toEqual([]);
    expect(r.lotes.items[0].embaladoKg).toBe(400);
  });
  it('presupuesto de tiempo: si un almacen no responde devuelve parcial con aviso en vez de colgarse', async () => {
    inv.obtenerInventarioAlmacen.mockImplementation((id: string) =>
      id === G2 ? new Promise(() => {}) : Promise.resolve(grupoLote(1000))
    );
    const t0 = Date.now();
    const r = await obtenerResumenInventario({ ...HOY, presupuestoMs: 80 });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.parcial).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/ALMACEN G2/);
    expect(r.totalKg).toBe(1000);
  });
});
