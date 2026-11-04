import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});

const inv = vi.hoisted(() => ({ obtenerInventarioAlmacen: vi.fn() }));
vi.mock('../src/services/inventario-service.js', () => ({ obtenerInventarioAlmacen: inv.obtenerInventarioAlmacen, obtenerInventario: vi.fn() }));

const datos = vi.hoisted(() => ({
  leerProductos: vi.fn(),
  leerTickets: vi.fn(),
  leerTransformaciones: vi.fn(),
  leerAjustes: vi.fn(),
  leerEmbalajesConContenedor: vi.fn(),
  leerCompletadoEnTransformaciones: vi.fn(),
  leerPrimerRegistro: vi.fn(),
}));
vi.mock('../src/services/inventario-pantalla-datos.js', () => datos);

const { obtenerResumenInventario } = await import('../src/services/inventario-resumen-service.js');
const { obtenerAlertasPantalla, obtenerCategoriasPantalla, obtenerDetallePantalla } = await import(
  '../src/services/inventario-pantalla-service.js'
);
const { invalidarCacheResumen } = await import('../src/services/resumen-cache.js');

const G1 = 'g1';
const HOY = '2026-10-04';
const CORTE = '2026-10-01';
const art = (productoId: string, nombre: string, stock: number, loteId: string | null = null) => ({
  productoId, nombre, destinoTipo: loteId ? 'lote' : 'mpp', loteId, stock,
});

/** Stock actual y saldo al corte: el servicio debe pedir el saldo con { hasta } y no mezclar ambos. */
const gruposActuales = [
  { tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso', totalKg: 150, articulos: [art('p-alu', 'ALUMINIO SUCIO', 150)] },
  { tipoMaterialId: null, nombreCategoria: 'Lotes', totalKg: 1000, articulos: [art('__lote_adj__L1', 'LOTE 1', 1000, 'L1')] },
];
const gruposAlCorte = [
  { tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso', totalKg: 90, articulos: [art('p-alu', 'ALUMINIO SUCIO', 90)] },
  { tipoMaterialId: null, nombreCategoria: 'Lotes', totalKg: 600, articulos: [art('__lote_adj__L1', 'LOTE 1', 600, 'L1')] },
];

beforeEach(() => {
  invalidarCacheResumen();
  bdFalsa.reiniciar();
  for (const f of [inv.obtenerInventarioAlmacen, ...Object.values(datos)]) f.mockReset();
  bdFalsa.tablas.almacenes = [{ id: G1, nombre: 'ALMACEN G1', activo: true }];
  bdFalsa.tablas.lotes = [{ id: 'L1', nombre: 'LOTE 1', activo: true, clase: 'exportacion', precio_estimado_kg: '2' }];
  bdFalsa.tablas.lote_embalajes = [
    { lote_id: 'L1', almacen_id: null, peso_kg: '400', marcado_en: '2026-09-20T15:00:00Z', anulado: false, anulado_en: null },
    { lote_id: 'L1', almacen_id: null, peso_kg: '300', marcado_en: '2026-10-02T15:00:00Z', anulado: false, anulado_en: null },
  ];
  bdFalsa.tablas.productos = [];
  bdFalsa.tablas.detalle_facturas_compra = [{ id: 'd1', producto_id: 'p-alu', peso: '100', subtotal: '150' }];
  bdFalsa.tablas.configuracion_inventario = [{ clave: 'meta_contenedor_kg', valor: '18000' }];
  inv.obtenerInventarioAlmacen.mockImplementation(async (_id: string, filtros?: { hasta?: string }) =>
    filtros?.hasta ? gruposAlCorte : gruposActuales
  );
  datos.leerProductos.mockResolvedValue([{ id: 'p-alu', nombre: 'ALUMINIO SUCIO', tipoMaterialId: 'tm-nf', categoria: 'No Ferroso' }]);
  datos.leerTickets.mockResolvedValue([
    { tipo: 'compra', fecha: '2026-09-20', almacenId: G1, detalle: [{ productoId: 'p-alu', pesoNeto: 90, loteId: null }] },
    { tipo: 'venta', fecha: '2026-10-03', almacenId: G1, detalle: [{ productoId: 'p-alu', pesoNeto: 5, loteId: null }] },
  ]);
  datos.leerTransformaciones.mockResolvedValue({ transformaciones: [], sinMermaTipificada: false });
  datos.leerAjustes.mockResolvedValue([{ productoId: 'p-alu', loteId: null, almacenId: G1, diferencia: 60, fecha: '2026-09-16' }]);
  datos.leerEmbalajesConContenedor.mockResolvedValue([{ loteId: 'L1', pesoKg: 700, contenedor: null }]);
  datos.leerCompletadoEnTransformaciones.mockResolvedValue({ porId: new Map(), disponible: true });
  datos.leerPrimerRegistro.mockResolvedValue('2026-09-01');
});

describe('sin fecha: el comportamiento no cambia (stock actual)', () => {
  it('pide el inventario de cada almacén sin filtros de fecha y no marca saldoAl', async () => {
    const d = await obtenerDetallePantalla({ hoy: HOY });
    expect(inv.obtenerInventarioAlmacen).toHaveBeenCalledTimes(1);
    expect(inv.obtenerInventarioAlmacen.mock.calls[0]).toEqual([G1]);
    expect(d.saldoAl).toBeNull();
    expect(d.totales.kgEnGalpon).toBe(1150);
    expect(datos.leerCompletadoEnTransformaciones).not.toHaveBeenCalled();
  });

  it('una fecha de corte igual o posterior a hoy es el stock actual', async () => {
    for (const al of [HOY, '2026-12-31']) {
      invalidarCacheResumen();
      inv.obtenerInventarioAlmacen.mockClear();
      const d = await obtenerDetallePantalla({ hoy: HOY, al });
      expect(inv.obtenerInventarioAlmacen.mock.calls[0]).toEqual([G1]);
      expect(d.saldoAl).toBeNull();
      expect(d.totales.kgEnGalpon).toBe(1150);
    }
  });
});

describe('con fecha de corte: saldo en kilos al cierre del día', () => {
  const opts = { hoy: HOY, al: CORTE };

  it('pide a cada almacén sus movimientos hasta la fecha y rotula saldoAl', async () => {
    const d = await obtenerDetallePantalla(opts);
    expect(inv.obtenerInventarioAlmacen.mock.calls[0]).toEqual([G1, { hasta: CORTE }]);
    expect(d.saldoAl).toBe(CORTE);
    expect(d.totales.kgEnGalpon).toBe(690);
    expect(d.filas.find(f => f.id === 'mat:p-alu')?.kg).toBe(90);
    expect(d.filas.find(f => f.id === 'lote:L1')?.kg).toBe(600);
  });

  it('no mezcla el saldo con el stock actual en la caché (ni en un orden ni en el otro)', async () => {
    const actual = await obtenerDetallePantalla({ hoy: HOY });
    const alCorte = await obtenerDetallePantalla(opts);
    const actualOtraVez = await obtenerDetallePantalla({ hoy: HOY });
    expect(actual.totales.kgEnGalpon).toBe(1150);
    expect(alCorte.totales.kgEnGalpon).toBe(690);
    expect(actualOtraVez.totales.kgEnGalpon).toBe(1150);
  });

  it('el embalado es el vigente a esa fecha (lo marcado después no cuenta)', async () => {
    const d = await obtenerDetallePantalla(opts);
    expect(d.filas.find(f => f.id === 'lote:L1')).toMatchObject({ embaladoKg: 400, enSacaKg: 200 });
    const actual = await obtenerDetallePantalla({ hoy: HOY });
    expect(actual.filas.find(f => f.id === 'lote:L1')).toMatchObject({ embaladoKg: 700, enSacaKg: 300 });
  });

  it('el último despacho no incluye ventas posteriores al corte', async () => {
    const d = await obtenerDetallePantalla(opts);
    expect(d.filas.find(f => f.id === 'mat:p-alu')?.ultimoDespacho).toBeNull();
  });

  it('solo kilos: aunque se pida valor, no hay costos ni precios y se avisa', async () => {
    const d = await obtenerDetallePantalla({ ...opts, incluirValor: true });
    expect(d.valorOculto).toBe(true);
    expect(d.totales.valorCostoUsd).toBeNull();
    expect(d.totales.valorEstimadoUsd).toBeNull();
    expect(d.avisos.join(' ')).toMatch(/solo kilos/i);
  });

  it('antes del primer registro avisa que el 0 es falta de datos', async () => {
    const d = await obtenerDetallePantalla({ hoy: HOY, al: '2026-09-01' });
    expect(d.avisos.join(' ')).toMatch(/No hay movimientos registrados antes de 01\/09\/2026/);
  });

  it('un saldo negativo se muestra y se avisa, no se oculta', async () => {
    inv.obtenerInventarioAlmacen.mockImplementation(async (_id: string, f?: { hasta?: string }) =>
      f?.hasta
        ? [{ tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso', totalKg: -20, articulos: [art('p-alu', 'ALUMINIO SUCIO', -20)] }]
        : gruposActuales
    );
    const d = await obtenerDetallePantalla(opts);
    expect(d.filas.find(f => f.id === 'mat:p-alu')?.kg).toBe(-20);
    expect(d.avisos.join(' ')).toMatch(/negativo.*ALUMINIO SUCIO/);
  });

  it('si no se puede leer completado_en lo avisa y sigue', async () => {
    datos.leerCompletadoEnTransformaciones.mockResolvedValue({ porId: new Map(), disponible: false });
    const d = await obtenerDetallePantalla(opts);
    expect(d.avisos.join(' ')).toMatch(/transformaciones/);
    expect(d.totales.kgEnGalpon).toBe(690);
  });

  it('las tarjetas por categoría suman el mismo saldo que el detalle', async () => {
    const t = await obtenerCategoriasPantalla(opts);
    const d = await obtenerDetallePantalla(opts);
    expect(t.saldoAl).toBe(CORTE);
    expect(t.totalKgEnGalpon).toBeCloseTo(d.totales.kgEnGalpon, 3);
  });

  it('las alertas no aplican a una fecha pasada: vienen vacías con un aviso', async () => {
    const a = await obtenerAlertasPantalla(opts);
    expect(a.saldoAl).toBe(CORTE);
    expect(a.alertas).toEqual([]);
    expect(a.avisos.join(' ')).toMatch(/alertas/i);
  });

  it('el resumen (KPIs) usa el saldo a la fecha y no pide costos', async () => {
    const r = await obtenerResumenInventario({ hoy: HOY, al: CORTE, incluirValor: true });
    expect(r.saldoAl).toBe(CORTE);
    expect(r.totalKg).toBe(690);
    expect(r.valorOculto).toBe(true);
    expect(r.exportacion.listoKg).toBe(400);
    const actual = await obtenerResumenInventario({ hoy: HOY, incluirValor: true });
    expect(actual.saldoAl).toBeNull();
    expect(actual.totalKg).toBe(1150);
  });
});
