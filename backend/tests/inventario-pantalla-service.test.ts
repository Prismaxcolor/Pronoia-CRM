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
}));
vi.mock('../src/services/inventario-pantalla-datos.js', () => datos);

const { obtenerResumenInventario } = await import('../src/services/inventario-resumen-service.js');
const { obtenerAlertasPantalla, obtenerCategoriasPantalla, obtenerDetallePantalla, TTL_CACHE_PANTALLA_MS, TTL_CACHE_PARCIAL_MS } = await import(
  '../src/services/inventario-pantalla-service.js'
);
const { invalidarCacheResumen } = await import('../src/services/resumen-cache.js');
const { actualizarCostosReferencia, obtenerCostosInventario } = await import('../src/services/inventario-costos-service.js');

const G1 = 'g1';
const G2 = 'g2';
const HOY = '2026-10-04';
const art = (productoId: string, nombre: string, stock: number, loteId: string | null = null) => ({
  productoId, nombre, destinoTipo: loteId ? 'lote' : 'mpp', loteId, stock,
});

beforeEach(() => {
  invalidarCacheResumen();
  bdFalsa.reiniciar();
  for (const f of [inv.obtenerInventarioAlmacen, ...Object.values(datos)]) f.mockReset();
  bdFalsa.tablas.almacenes = [{ id: G1, nombre: 'ALMACEN G1', activo: true }, { id: G2, nombre: 'ALMACEN G2', activo: true }];
  bdFalsa.tablas.lotes = [
    { id: 'L1', nombre: 'LOTE 1', activo: true, clase: 'exportacion', precio_estimado_kg: '2' },
    { id: 'B', nombre: 'BGPP', activo: true, clase: 'trabajo', precio_estimado_kg: null, fase: 'por_procesar' },
  ];
  bdFalsa.tablas.lote_embalajes = [{ lote_id: 'L1', almacen_id: null, peso_kg: '400', anulado: false }];
  bdFalsa.tablas.productos = [{ id: 'p-cat', vendible: false }];
  bdFalsa.tablas.detalle_facturas_compra = [{ id: 'd1', producto_id: 'p-alu', peso: '100', subtotal: '150' }];
  bdFalsa.tablas.configuracion_inventario = [{ clave: 'meta_contenedor_kg', valor: '18000' }];
  inv.obtenerInventarioAlmacen.mockImplementation(async (id: string) =>
    id === G1
      ? [
          { tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso', totalKg: 100, articulos: [art('p-alu', 'ALUMINIO SUCIO', 100)] },
          { tipoMaterialId: null, nombreCategoria: 'Lotes', totalKg: 1000, articulos: [art('__lote_adj__L1', 'LOTE 1', 1000, 'L1')] },
        ]
      : [
          { tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso', totalKg: 50, articulos: [art('p-alu', 'ALUMINIO SUCIO', 50)] },
          { tipoMaterialId: 'tm-pcb', nombreCategoria: 'PCB', totalKg: 7, articulos: [art('p-tel', 'TELEFONO', 7)] },
          { tipoMaterialId: null, nombreCategoria: 'Lotes', totalKg: 700, articulos: [art('__lote_adj__L1', 'LOTE 1', 500, 'L1'), art('__lote_adj__B', 'BGPP', 200, 'B')] },
        ]
  );
  datos.leerProductos.mockResolvedValue([
    { id: 'p-alu', nombre: 'ALUMINIO SUCIO', tipoMaterialId: 'tm-nf', categoria: 'No Ferroso' },
    { id: 'p-tel', nombre: 'TELEFONO', tipoMaterialId: 'tm-pcb', categoria: 'PCB' },
  ]);
  datos.leerTickets.mockResolvedValue([
    { tipo: 'compra', fecha: '2026-10-02', almacenId: G2, detalle: [{ productoId: 'p-alu', pesoNeto: 60, loteId: null }] },
    { tipo: 'venta', fecha: '2026-10-03', almacenId: G2, detalle: [{ productoId: 'p-alu', pesoNeto: 5, loteId: null }] },
  ]);
  datos.leerTransformaciones.mockResolvedValue({ transformaciones: [], sinMermaTipificada: false });
  datos.leerAjustes.mockResolvedValue([{ productoId: 'p-alu', loteId: null, almacenId: G1, diferencia: 500, fecha: '2026-09-16' }]);
  datos.leerEmbalajesConContenedor.mockResolvedValue([{ loteId: 'L1', pesoKg: 400, contenedor: null }]);
});

const opts = { hoy: HOY, incluirValor: true };

describe('cifras que deben cuadrar con el resumen', () => {
  it('stock de la tabla de detalle = tarjetas = total del resumen (sin contar doble los lotes); aparte quedan las clasificaciones PCB', async () => {
    const resumen = await obtenerResumenInventario({ hoy: HOY, incluirValor: true });
    const detalle = await obtenerDetallePantalla(opts);
    const tarjetas = await obtenerCategoriasPantalla(opts);
    expect(resumen.totalKg).toBe(1857);
    expect(detalle.totales.kgEnGalpon + detalle.totales.kgClasificacionesCompraOcultas).toBeCloseTo(resumen.totalKg, 3);
    expect(tarjetas.totalKgEnGalpon + tarjetas.kgClasificacionesCompraOcultas).toBeCloseTo(resumen.totalKg, 3);
    expect(tarjetas.tarjetas.reduce((a, t) => a + t.kgEnGalpon, 0)).toBeCloseTo(tarjetas.totalKgEnGalpon, 3);
    expect(tarjetas.vistas.reduce((a, v) => a + v.kgEnGalpon, 0)).toBeCloseTo(tarjetas.totalKgEnGalpon, 3);
    expect(detalle.totales.kgClasificacionesCompraOcultas).toBe(7);
    // por almacen
    const g1 = await obtenerDetallePantalla({ ...opts, almacen: G1 });
    expect(g1.totales.kgEnGalpon).toBe(resumen.almacenes.find(a => a.almacenId === G1)!.totalKg);
    const g2 = await obtenerDetallePantalla({ ...opts, almacen: G2 });
    expect(g2.totales.kgEnGalpon + g2.totales.kgClasificacionesCompraOcultas).toBe(resumen.almacenes.find(a => a.almacenId === G2)!.totalKg);
  });

  it('el valor a costo y el estimado de los lotes coinciden con el resumen y siguen separados', async () => {
    const resumen = await obtenerResumenInventario({ hoy: HOY, incluirValor: true });
    const d = await obtenerDetallePantalla(opts);
    expect(d.totales.valorCostoUsd).toBe(resumen.valor.costoMateriales.valorUsd);
    expect(d.totales.valorEstimadoUsd).toBe(resumen.valor.ventaEstimadaLotes.valorUsd);
    expect(d.totales.valorEstimadoUsd).toBe(3000);
    const t = await obtenerCategoriasPantalla(opts);
    expect(t.tarjetas.find(x => x.clave === 'tm-nf')).toMatchObject({ valorCostoUsd: 225, valorEstimadoUsd: null });
    expect(t.tarjetas.find(x => x.clave === 'lotes:exportacion')).toMatchObject({ valorEstimadoUsd: 3000, valorCostoUsd: null });
  });

  it('embalado de la tabla = embalado del resumen', async () => {
    const resumen = await obtenerResumenInventario({ hoy: HOY, incluirValor: true });
    const d = await obtenerDetallePantalla(opts);
    expect(d.filas.find(f => f.id === 'lote:L1')).toMatchObject({ embaladoKg: resumen.exportacion.listoKg, enSacaKg: resumen.exportacion.enSacaKg });
  });
});

describe('detalle', () => {
  it('no muestra las clasificaciones de compra PCB salvo que se pidan', async () => {
    const d = await obtenerDetallePantalla(opts);
    expect(d.filas.some(f => f.material === 'TELEFONO')).toBe(false);
    const con = await obtenerDetallePantalla({ ...opts, incluirClasificaciones: true });
    expect(con.filas.find(f => f.material === 'TELEFONO')).toMatchObject({ esClasificacionCompra: true });
    expect(con.totales.kgClasificacionesCompraOcultas).toBe(0);
  });

  it('limita las filas, avisa y los totales cuentan todas', async () => {
    const d = await obtenerDetallePantalla({ ...opts, limite: 1 });
    expect(d.filas).toHaveLength(1);
    expect(d.limite).toMatchObject({ maxFilas: 1, truncado: true });
    expect(d.avisos.some(a => /1 de \d+ filas/.test(a))).toBe(true);
    expect(d.totales.kgEnGalpon).toBeGreaterThan(d.filas[0].kg);
    expect(d.parcial).toBe(false);
  });

  it('filtros de categoria, texto y vista; limpieza derivada del nombre; etapas por fase', async () => {
    const nf = await obtenerDetallePantalla({ ...opts, categoria: 'No Ferroso' });
    expect(nf.filas.filter(f => f.enGalpon).map(f => f.material)).toEqual(['ALUMINIO SUCIO']);
    expect(nf.filas.find(f => f.enGalpon)).toMatchObject({ limpieza: 'sucio', kg: 150, etapa: 'listo' });
    expect((await obtenerDetallePantalla({ ...opts, q: 'bgpp' })).filas.map(f => f.material)).toEqual(['BGPP']);
    const trabajo = await obtenerDetallePantalla({ ...opts, vista: 'trabajo_interno' });
    expect(trabajo.filas.find(f => f.id === 'lote:B')).toMatchObject({ fase: 'por_procesar', etapa: 'recibido' });
  });

  it('antiguedad estimada: compra reciente primero, luego la toma fisica; el ultimo despacho va en la fila', async () => {
    const d = await obtenerDetallePantalla(opts);
    const alu = d.filas.find(f => f.id === 'mat:p-alu')!;
    expect(alu.dias).toMatchObject({ estimado: true, fechaEntradaMasAntigua: '2026-09-16', fechaEntradaMasReciente: '2026-10-02' });
    expect(alu.ultimoDespacho).toEqual({ fecha: '2026-10-03', kg: 5 });
    expect(d.filas.some(f => /^(desp|transf):/.test(f.id))).toBe(false);
    // el total despachado del periodo sigue saliendo de los tickets
    expect(d.totales.kgDespachado).toBe(5);
  });

  it('rango invalido: error (la ruta lo traduce en 400 antes; aqui es defensa en profundidad)', async () => {
    await expect(obtenerDetallePantalla({ ...opts, desde: '2026-10-05', hasta: '2026-10-01' })).rejects.toThrow(/Rango/);
  });
});

describe('permisos de valor', () => {
  it('sin facturacion:ver: valorOculto, ni un costo ni un precio en detalle, tarjetas o alertas (tampoco la referencia manual); los costos ni se consultan', async () => {
    bdFalsa.tablas.productos = [{ id: 'p-alu', costo_referencia_kg: '2' }];
    const o = { hoy: HOY };
    const d = await obtenerDetallePantalla(o);
    const t = await obtenerCategoriasPantalla(o);
    const a = await obtenerAlertasPantalla(o);
    for (const r of [d, t, a]) expect(r.valorOculto).toBe(true);
    for (const fila of d.filas) {
      expect([fila.costoPromedioKg, fila.valorCostoUsd, fila.precioEstimadoKg, fila.valorEstimadoUsd]).toEqual([null, null, null, null]);
      expect([fila.costoFuente, fila.costoReferenciaKg]).toEqual([null, null]);
    }
    expect(JSON.stringify([d, t, a])).not.toMatch(/"costoReferenciaKg":\s*[0-9]/);
    expect(d.totales.valorCostoUsd).toBeNull();
    expect(d.totales.valorEstimadoUsd).toBeNull();
    expect(JSON.stringify(t)).not.toMatch(/"valor(Costo|Estimado)Usd":\s*[1-9]/);
    expect(JSON.stringify(t)).not.toMatch(/"precio\w*":\s*[1-9]/);
    expect(d.totales.kgEnGalpon).toBeGreaterThan(0);
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });

  it('la cache no filtra costos entre usuarios con y sin permiso (en cualquier orden)', async () => {
    const con = await obtenerDetallePantalla(opts);
    const sin = await obtenerDetallePantalla({ hoy: HOY });
    const conOtraVez = await obtenerDetallePantalla(opts);
    expect(con.totales.valorCostoUsd).toBe(225);
    expect(sin.totales.valorCostoUsd).toBeNull();
    expect(conOtraVez.totales.valorCostoUsd).toBe(225);
  });
});

describe('cache compartida y presupuesto', () => {
  it('los endpoints juntos leen el inventario UNA vez por almacen y cada tabla una vez', async () => {
    await Promise.all([obtenerDetallePantalla(opts), obtenerCategoriasPantalla(opts), obtenerAlertasPantalla(opts)]);
    await obtenerDetallePantalla({ ...opts, categoria: 'PCB' });
    expect(inv.obtenerInventarioAlmacen).toHaveBeenCalledTimes(2);
    for (const f of Object.values(datos)) expect(f).toHaveBeenCalledTimes(1);
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
  });

  it('invalidar la cache del resumen vacia tambien la de la pantalla', async () => {
    await obtenerDetallePantalla(opts);
    invalidarCacheResumen();
    await obtenerDetallePantalla(opts);
    expect(inv.obtenerInventarioAlmacen).toHaveBeenCalledTimes(4);
  });

  it('si una lectura falla, devuelve lo calculado con parcial + aviso, sin filtrar el error interno', async () => {
    datos.leerTickets.mockRejectedValueOnce(new Error('boom interno'));
    const d = await obtenerDetallePantalla(opts);
    expect(d.parcial).toBe(true);
    expect(d.avisos.join(' ')).toMatch(/tickets/);
    expect(JSON.stringify(d)).not.toContain('boom');
  });

  it('una base parcial se cachea solo el TTL corto: absorbe la carga y luego se recalcula', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
      datos.leerTickets.mockRejectedValue(new Error('boom interno'));
      expect((await obtenerDetallePantalla(opts)).parcial).toBe(true);
      await Promise.all([obtenerCategoriasPantalla(opts), obtenerAlertasPantalla(opts)]);
      expect(datos.leerTickets).toHaveBeenCalledTimes(1);
      expect(TTL_CACHE_PARCIAL_MS).toBeLessThan(TTL_CACHE_PANTALLA_MS);

      vi.setSystemTime(Date.now() + TTL_CACHE_PARCIAL_MS + 1);
      datos.leerTickets.mockResolvedValue([]);
      const d = await obtenerDetallePantalla(opts);
      expect(datos.leerTickets).toHaveBeenCalledTimes(2);
      expect(d.parcial).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('una base completa sigue cacheada el TTL normal (mas largo que el parcial)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
      await obtenerDetallePantalla(opts);
      vi.setSystemTime(Date.now() + TTL_CACHE_PARCIAL_MS + 1);
      await obtenerDetallePantalla(opts);
      expect(datos.leerTickets).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + TTL_CACHE_PANTALLA_MS);
      await obtenerDetallePantalla(opts);
      expect(datos.leerTickets).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('una lectura que tarda mas que el presupuesto da parcial con aviso', async () => {
    datos.leerAjustes.mockReturnValue(new Promise(() => {}));
    const d = await obtenerDetallePantalla({ ...opts, presupuestoMs: 50 });
    expect(d.parcial).toBe(true);
    expect(d.avisos.join(' ')).toMatch(/ajustes.*tardó demasiado/);
  });

  it('sin la tabla de merma tipificada: aviso INFORMATIVO (no parcial) y se cachea el TTL normal', async () => {
    datos.leerTransformaciones.mockResolvedValue({ transformaciones: [], sinMermaTipificada: true });
    const d = await obtenerDetallePantalla(opts);
    expect(d.parcial).toBe(false);
    expect(d.avisos.join(' ')).toMatch(/merma por tipo/);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + TTL_CACHE_PARCIAL_MS + 1);
      await obtenerCategoriasPantalla(opts);
      expect(datos.leerTransformaciones).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('alertas con los datos de hoy', () => {
  it('con pocos dias de historia no hay alertas de antiguedad; el embalado sin contenedor si avisa', async () => {
    const a = await obtenerAlertasPantalla(opts);
    expect(a.alertas.filter(x => x.tipo === 'antiguedad')).toEqual([]);
    expect(a.alertas).toEqual([expect.objectContaining({ tipo: 'embalado_sin_contenedor', severidad: 'info', loteId: 'L1', valor: 400 })]);
    expect(a.configuracion).toEqual({ alertaDiasAmarilla: 60, alertaDiasRoja: 90, umbralMermaPct: 8, alertaMermaMinKg: 5 });
  });

  it('con la fecha de hoy 82 dias despues: roja por antiguedad estimada (93,6 dias)', async () => {
    // 60 kg de la compra (84 dias) + 90 kg de la toma fisica (100 dias) = 93,6 dias > 90
    const a = await obtenerAlertasPantalla({ ...opts, hoy: '2026-12-25', desde: '2026-12-01', hasta: '2026-12-25' });
    expect(a.alertas.some(x => x.tipo === 'antiguedad' && x.severidad === 'roja' && x.valor === 93.6)).toBe(true);
  });
});

describe('costos de referencia: costo efectivo, GET y PUT', () => {
  beforeEach(() => {
    bdFalsa.tablas.productos = [{ id: 'p-alu', costo_referencia_kg: '2' }, { id: 'p-tel', costo_referencia_kg: null }];
    bdFalsa.tablas.detalle_facturas_compra = [
      { id: 'd1', producto_id: 'p-alu', peso: '100', subtotal: '150' },
      { id: 'd2', producto_id: 'p-tel', peso: '10', subtotal: '30' },
    ];
  });

  it('la referencia manual manda sobre las facturas; el valor del detalle, las tarjetas y el resumen coinciden', async () => {
    const resumen = await obtenerResumenInventario(opts);
    const d = await obtenerDetallePantalla({ ...opts, incluirClasificaciones: true });
    // alu: 150 kg x 2 (manual, no 1,5 de facturas) + tel: 7 kg x 3 (facturas)
    expect(d.filas.find(f => f.id === 'mat:p-alu')).toMatchObject({ costoPromedioKg: 2, costoFuente: 'manual', costoReferenciaKg: 2, valorCostoUsd: 300 });
    expect(d.filas.find(f => f.id === 'mat:p-tel')).toMatchObject({ costoPromedioKg: 3, costoFuente: 'facturas', costoReferenciaKg: null, valorCostoUsd: 21 });
    expect(resumen.valor?.costoMateriales.valorUsd).toBe(321);
    expect(d.totales.valorCostoUsd).toBe(321);
    expect(resumen.valor?.costoMateriales.kgSinCosto).toBe(0);
  });

  it('sin la columna costo_referencia_kg (migracion pendiente) el costo sale solo de las facturas, sin aviso de error', async () => {
    bdFalsa.errores.productos = { code: '42703', message: 'column productos.costo_referencia_kg does not exist' } as never;
    const d = await obtenerDetallePantalla(opts);
    expect(d.filas.find(f => f.id === 'mat:p-alu')).toMatchObject({ costoPromedioKg: 1.5, costoFuente: 'facturas' });
  });

  it('GET: kg en galpon, costo de facturas, referencia, efectivo, fuente y valor; solo productos con stock, ordenados', async () => {
    const c = await obtenerCostosInventario();
    expect(c.productos.map(p => p.productoId)).toEqual(['p-alu', 'p-tel']);
    expect(c.productos[0]).toMatchObject({
      nombre: 'ALUMINIO SUCIO', categoria: 'No Ferroso', categoriaClave: 'tm-nf', vista: 'venta_nacional', kg: 150,
      costoFacturasKg: 1.5, costoReferenciaKg: 2, costoEfectivoKg: 2, fuente: 'manual', valorUsd: 300,
    });
    expect(c.productos[1]).toMatchObject({ kg: 7, costoFacturasKg: 3, costoReferenciaKg: null, costoEfectivoKg: 3, fuente: 'facturas', valorUsd: 21 });
    expect(c.totales).toEqual({ valorUsd: 321, kgSinCosto: 0, productosSinCosto: 0 });
  });

  it('GET: un producto sin referencia ni facturas queda sin costo y sus kg se cuentan aparte', async () => {
    bdFalsa.tablas.detalle_facturas_compra = [];
    bdFalsa.tablas.productos = [];
    const c = await obtenerCostosInventario();
    expect(c.productos.every(p => p.fuente === null && p.valorUsd === null && p.costoEfectivoKg === null)).toBe(true);
    expect(c.totales).toEqual({ valorUsd: null, kgSinCosto: 157, productosSinCosto: 2 });
  });

  it('PUT: solo escribe lo que cambia, deja auditoria, vacia la cache y devuelve los costos nuevos', async () => {
    bdFalsa.rpc.actualizar_costos_referencia = () => 1;
    await obtenerCostosInventario(); // llena la cache
    bdFalsa.tablas.productos = [{ id: 'p-alu', nombre: 'ALUMINIO SUCIO', costo_referencia_kg: '2' }, { id: 'p-tel', nombre: 'TELEFONO', costo_referencia_kg: null }];
    const r = await actualizarCostosReferencia(
      { items: [{ productoId: 'p-alu', costoReferenciaKg: 2 }, { productoId: 'p-tel', costoReferenciaKg: 4 }] },
      { userId: 'u1', email: 'a@b.c' }
    );
    expect(r.ok).toBe(true);
    expect(bdFalsa.llamadasRpc).toEqual([{ nombre: 'actualizar_costos_referencia', args: { p_items: [{ producto_id: 'p-tel', costo: 4 }], p_usuario: 'u1' } }]);
    const auditorias = bdFalsa.escrituras.filter(e => e.tabla === 'auditoria_ediciones');
    expect(auditorias).toHaveLength(1);
    expect(JSON.stringify(auditorias[0])).toContain('producto_costo');
  });

  it('PUT: sin cambios no escribe; producto inexistente = 400; migracion pendiente = 409', async () => {
    bdFalsa.tablas.productos = [{ id: 'p-alu', nombre: 'ALUMINIO SUCIO', costo_referencia_kg: '2' }];
    const igual = await actualizarCostosReferencia({ items: [{ productoId: 'p-alu', costoReferenciaKg: 2 }] }, { userId: 'u1' });
    expect(igual).toMatchObject({ ok: true, cambiados: 0 });
    expect(bdFalsa.llamadasRpc).toHaveLength(0);
    const noExiste = await actualizarCostosReferencia({ items: [{ productoId: 'zzz', costoReferenciaKg: 1 }] }, { userId: 'u1' });
    expect(noExiste).toMatchObject({ ok: false, status: 400 });
    const sinFuncion = await actualizarCostosReferencia({ items: [{ productoId: 'p-alu', costoReferenciaKg: 5 }] }, { userId: 'u1' });
    expect(sinFuncion).toMatchObject({ ok: false, status: 409 });
  });
});
