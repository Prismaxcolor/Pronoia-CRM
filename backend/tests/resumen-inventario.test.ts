import { describe, it, expect } from 'vitest';
import {
  construirResumenInventario,
  ocultarValor,
  costoPromedioPorProducto,
  rangoAnterior,
  rangoPorDefecto,
  type EntradaResumen,
  type GrupoEntrada,
} from '../src/utils/resumen-inventario.js';
import { configuracionPorDefecto } from '../src/schemas/configuracion-inventario.js';

const art = (productoId: string, nombre: string, stock: number, loteId: string | null = null) => ({
  productoId, nombre, destinoTipo: (loteId ? 'lote' : 'mpp') as 'lote' | 'mpp', loteId, stock,
});
const grupo = (nombreCategoria: string, tipoMaterialId: string | null, articulos: GrupoEntrada['articulos']): GrupoEntrada => ({
  tipoMaterialId, nombreCategoria, articulos,
});
const lote = (id: string, nombre: string, clase: 'exportacion' | 'trabajo' | 'otro', precio: number | null = null, activo = true) => ({
  id, nombre, activo, clase, precioEstimadoKg: precio, precioEstimadoActualizadoEn: precio != null ? '2026-10-03T10:00:00Z' : null,
});

function base(over: Partial<EntradaResumen> = {}): EntradaResumen {
  return {
    almacenes: [
      {
        almacenId: 'g1', nombre: 'ALMACEN G1',
        grupos: [grupo('Lotes', null, [art('__lote_adj__L1', 'LOTE 1', 3000, 'L1'), art('__lote_adj__L2', 'LOTE 2', 500, 'L2')])],
      },
      {
        almacenId: 'g2', nombre: 'ALMACEN G2',
        grupos: [
          grupo('Lotes', null, [art('__lote_adj__L2', 'LOTE 2', 1500, 'L2'), art('__lote_adj__L4', 'LOTE 4', 20.5, 'L4'), art('__lote_adj__B', 'BGPP', 800, 'B')]),
          grupo('Basura', 'tm-basura', [art('p-basura', 'BASURA', 1000)]),
          grupo('PGM', 'tm-pgm', [art('p-cat', 'CATALIZADORES COMPLETOS', 50), art('p-polvo', 'POLVO DE CATALIZADOR', 5)]),
        ],
      },
    ],
    lotes: [
      lote('L1', 'LOTE 1', 'exportacion', 2), lote('L2', 'LOTE 2', 'exportacion', 1.5), lote('L4', 'LOTE 4', 'exportacion'),
      lote('B', 'BGPP', 'trabajo', null), lote('X', 'LOTE XXXXX', 'otro', null, false),
    ],
    embalajes: [
      { loteId: 'L2', almacenId: 'g2', pesoKg: 1200, anulado: false },
      { loteId: 'L1', almacenId: null, pesoKg: 1000, anulado: false },
      { loteId: 'L1', almacenId: null, pesoKg: 999, anulado: true },
    ],
    productosNoVendibles: new Set(['p-cat']),
    costos: new Map([['p-basura', { costoPromedioKg: 0.1, kgFacturados: 5000 }]]),
    config: configuracionPorDefecto(),
    ...over,
  };
}

describe('construirResumenInventario - kilos', () => {
  const r = construirResumenInventario(base());

  it('totales por almacen y total general = materiales sin lote + lotes (sin contar doble)', () => {
    expect(r.almacenes).toEqual([
      { almacenId: 'g1', nombre: 'ALMACEN G1', activo: true, totalKg: 3500 },
      { almacenId: 'g2', nombre: 'ALMACEN G2', activo: true, totalKg: 3375.5 },
    ]);
    expect(r.materiales.totalKg).toBe(1055);
    expect(r.lotes.totalKg).toBe(5820.5);
    expect(r.totalKg).toBe(6875.5);
    expect(r.totalKg).toBe(r.almacenes.reduce((a, x) => a + x.totalKg, 0));
  });
  it('un lote repartido en dos almacenes suma sus porciones', () => {
    const l2 = r.lotes.items.find(l => l.nombre === 'LOTE 2')!;
    expect(l2.stockKg).toBe(2000);
    expect(l2.porAlmacen).toEqual(expect.arrayContaining([{ almacenId: 'g1', stockKg: 500 }, { almacenId: 'g2', stockKg: 1500 }]));
  });
  it('kilos por categoria y por clase de lote', () => {
    expect(r.materiales.porCategoria.map(c => [c.nombre, c.kg])).toEqual([['Basura', 1000], ['PGM', 55]]);
    expect(r.lotes.porClase).toEqual([
      { clase: 'exportacion', kg: 5020.5, lotes: 3 },
      { clase: 'trabajo', kg: 800, lotes: 1 },
      { clase: 'otro', kg: 0, lotes: 0 },
    ]);
  });
  it('el lote archivado sin stock no aparece; los activos si', () => {
    expect(r.lotes.items.map(l => l.nombre)).toEqual(['BGPP', 'LOTE 1', 'LOTE 2', 'LOTE 4']);
  });
  it('el catalizador entero se informa como no vendible', () => {
    expect(r.materiales.kgNoVendible).toBe(50);
  });
});

describe('construirResumenInventario - embalado y contenedor', () => {
  const r = construirResumenInventario(base());
  it('embalado vigente y en saca por lote (los anulados no cuentan)', () => {
    const l1 = r.lotes.items.find(l => l.nombre === 'LOTE 1')!;
    expect(l1).toMatchObject({ stockKg: 3000, embaladoKg: 1000, enSacaKg: 2000, embaladoMayorQueStock: false });
    const l2 = r.lotes.items.find(l => l.nombre === 'LOTE 2')!;
    expect(l2).toMatchObject({ embaladoKg: 1200, enSacaKg: 800 });
  });
  it('kg en lotes de exportacion y kg listos', () => {
    expect(r.exportacion).toEqual({ stockKg: 5020.5, listoKg: 2200, enSacaKg: 2820.5 });
  });
  it('progreso del contenedor contra la meta configurable, con desglose por lote', () => {
    expect(r.contenedor.metaKg).toBe(18000);
    expect(r.contenedor.listoKg).toBe(2200);
    expect(r.contenedor.faltanKg).toBe(15800);
    expect(r.contenedor.progresoPct).toBe(12.2);
    expect(r.contenedor.porLote.map(l => [l.nombre, l.listoKg])).toEqual([['LOTE 1', 1000], ['LOTE 2', 1200], ['LOTE 4', 0]]);
  });
  it('si cambia la meta cambia el progreso; nunca pasa de 100 %', () => {
    const chico = construirResumenInventario(base({ config: { ...configuracionPorDefecto(), metaContenedorKg: 2000 } }));
    expect(chico.contenedor.progresoPct).toBe(100);
    expect(chico.contenedor.faltanKg).toBe(0);
  });
  it('si el stock baja de lo embalado, recorta y avisa', () => {
    const e = construirResumenInventario(base({ embalajes: [{ loteId: 'L4', almacenId: null, pesoKg: 100, anulado: false }] }));
    const l4 = e.lotes.items.find(l => l.nombre === 'LOTE 4')!;
    expect(l4).toMatchObject({ embaladoKg: 20.5, embaladoMarcadoKg: 100, enSacaKg: 0, embaladoMayorQueStock: true });
    expect(e.contenedor.listoKg).toBe(20.5);
  });
});

describe('construirResumenInventario - valor (dos cifras separadas)', () => {
  const r = construirResumenInventario(base());
  it('materiales a costo: solo los kg con costo registrado, y los kg sin costo se informan aparte', () => {
    expect(r.valor.costoMateriales).toMatchObject({ valorUsd: 100, kgConCosto: 1000, kgSinCosto: 55 });
    expect(r.valor.costoMateriales.productosSinCosto.map(p => p.nombre)).toEqual(['CATALIZADORES COMPLETOS', 'POLVO DE CATALIZADOR']);
    const basura = r.materiales.porCategoria.find(c => c.nombre === 'Basura')!;
    expect(basura).toMatchObject({ kgConCosto: 1000, kgSinCosto: 0, valorCostoUsd: 100 });
  });
  it('lotes a precio estimado de venta: solo lotes con precio; los demas se listan', () => {
    // LOTE 1: 3000 x 2 = 6000; LOTE 2: 2000 x 1.5 = 3000
    expect(r.valor.ventaEstimadaLotes.valorUsd).toBe(9000);
    expect(r.valor.ventaEstimadaLotes.kgConPrecio).toBe(5000);
    expect(r.valor.ventaEstimadaLotes.kgSinPrecio).toBe(820.5);
    expect(r.valor.ventaEstimadaLotes.lotesSinPrecio.map(l => l.nombre)).toEqual(['BGPP', 'LOTE 4']);
  });
  it('un lote sin precio no inventa valor', () => {
    const l4 = r.lotes.items.find(l => l.nombre === 'LOTE 4')!;
    expect(l4.valorEstimadoUsd).toBeNull();
  });
  it('precio 0 es un precio (valor 0), no "sin precio"', () => {
    const e = construirResumenInventario(base({ lotes: [lote('L4', 'LOTE 4', 'exportacion', 0)] }));
    expect(e.lotes.items[0].valorEstimadoUsd).toBe(0);
    expect(e.valor.ventaEstimadaLotes.lotesSinPrecio).toEqual([]);
  });
  it('stock negativo de material no se valora y se informa', () => {
    const e = construirResumenInventario(base({
      almacenes: [{ almacenId: 'g2', nombre: 'G2', grupos: [grupo('Basura', 'tm-basura', [art('p-basura', 'BASURA', -40)])] }],
      lotes: [],
    }));
    expect(e.valor.costoMateriales).toMatchObject({ valorUsd: 0, kgConCosto: 0, kgNegativos: -40 });
  });
  it('un mismo producto en dos almacenes se acumula antes de valorar', () => {
    const e = construirResumenInventario(base({
      almacenes: [
        { almacenId: 'g1', nombre: 'G1', grupos: [grupo('Basura', 'tm-basura', [art('p-basura', 'BASURA', 300)])] },
        { almacenId: 'g2', nombre: 'G2', grupos: [grupo('Basura', 'tm-basura', [art('p-basura', 'BASURA', 700)])] },
      ],
      lotes: [],
    }));
    expect(e.materiales.porCategoria).toHaveLength(1);
    expect(e.valor.costoMateriales).toMatchObject({ valorUsd: 100, kgConCosto: 1000 });
  });
});

describe('ocultarValor (usuario sin permiso de facturacion)', () => {
  const completo = construirResumenInventario(base());
  const oculto = ocultarValor(completo);
  it('marca valorOculto y elimina el bloque de valor completo', () => {
    expect(completo.valorOculto).toBe(false);
    expect(oculto.valorOculto).toBe(true);
    expect(oculto.valor).toBeNull();
  });
  it('no deja costos ni precios en ninguna parte del resumen', () => {
    const json = JSON.stringify(oculto);
    for (const campo of ['valorCostoUsd', 'kgConCosto', 'kgSinCosto', 'costoMateriales', 'ventaEstimadaLotes', 'valorUsd']) {
      expect(json, campo).not.toContain(campo);
    }
    for (const l of oculto.lotes.items) {
      expect(l.precioEstimadoKg).toBeNull();
      expect(l.valorEstimadoUsd).toBeNull();
      expect(l.precioEstimadoActualizadoEn).toBeNull();
    }
  });
  it('los kilos, el embalado y el contenedor no cambian', () => {
    expect(oculto.totalKg).toBe(completo.totalKg);
    expect(oculto.materiales.porCategoria.map(c => [c.nombre, c.kg])).toEqual(completo.materiales.porCategoria.map(c => [c.nombre, c.kg]));
    expect(oculto.lotes.items.map(l => [l.nombre, l.stockKg, l.embaladoKg])).toEqual(completo.lotes.items.map(l => [l.nombre, l.stockKg, l.embaladoKg]));
    expect(oculto.contenedor).toEqual(completo.contenedor);
    expect(oculto.exportacion).toEqual(completo.exportacion);
  });
  it('no muta el resumen original', () => {
    expect(completo.valor).not.toBeNull();
    expect(completo.lotes.items.find(l => l.nombre === 'LOTE 1')!.precioEstimadoKg).toBe(2);
  });
});

describe('almacenes inactivos', () => {
  it('un almacen inactivo con stock cuenta en el total del lote y se marca como inactivo', () => {
    const r = construirResumenInventario(base({
      almacenes: [
        { almacenId: 'g1', nombre: 'G1', activo: true, grupos: [grupo('Lotes', null, [art('__lote_adj__L1', 'LOTE 1', 100, 'L1')])] },
        { almacenId: 'viejo', nombre: 'VIEJO', activo: false, grupos: [grupo('Lotes', null, [art('__lote_adj__L1', 'LOTE 1', 40, 'L1')])] },
      ],
      embalajes: [],
    }));
    expect(r.lotes.items.find(l => l.nombre === 'LOTE 1')!.stockKg).toBe(140);
    expect(r.almacenes.map(a => [a.nombre, a.totalKg, a.activo])).toEqual([['G1', 100, true], ['VIEJO', 40, false]]);
    expect(r.totalKg).toBe(140);
  });
});

describe('costoPromedioPorProducto', () => {
  it('promedio ponderado por kilos, no promedio de precios', () => {
    const m = costoPromedioPorProducto([
      { productoId: 'a', peso: 100, subtotal: 100 }, // 1.00
      { productoId: 'a', peso: 300, subtotal: 600 }, // 2.00
    ]);
    expect(m.get('a')?.costoPromedioKg).toBeCloseTo(1.75, 6);
    expect(m.get('a')?.kgFacturados).toBe(400);
  });
  it('ignora lineas sin peso o con valores invalidos', () => {
    const m = costoPromedioPorProducto([
      { productoId: 'a', peso: 0, subtotal: 10 }, { productoId: 'b', peso: Number.NaN, subtotal: 1 }, { productoId: 'c', peso: 5, subtotal: -1 },
    ]);
    expect(m.size).toBe(0);
  });
});

describe('rangos de merma', () => {
  it('el periodo anterior tiene la misma duracion y termina el dia previo', () => {
    expect(rangoAnterior({ desde: '2026-09-20', hasta: '2026-09-30' })).toEqual({ desde: '2026-09-09', hasta: '2026-09-19' });
    expect(rangoAnterior({ desde: '2026-10-01', hasta: '2026-10-01' })).toEqual({ desde: '2026-09-30', hasta: '2026-09-30' });
  });
  it('cruza meses y años', () => {
    expect(rangoAnterior({ desde: '2026-01-01', hasta: '2026-01-31' })).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
  });
  it('rango por defecto: ultimos N dias incluyendo hoy', () => {
    expect(rangoPorDefecto('2026-10-03', 30)).toEqual({ desde: '2026-09-04', hasta: '2026-10-03' });
  });
});

describe('armarResumenMerma', () => {
  const rep = (kgEntrada: number, kgMerma: number, filas: Array<{ id: string; pct: number }> = []) => ({
    totales: { transformaciones: filas.length, kgEntrada, kgSalida: kgEntrada - kgMerma, kgMerma, pctMerma: kgEntrada > 0 ? Math.round((kgMerma / kgEntrada) * 10000) / 100 : 0 },
    porTipo: {
      transformaciones: filas.length, kgEntrada, kgMerma,
      tipos: [], sinClasificar: { kg: kgMerma, pctDeMerma: kgMerma > 0 ? 100 : 0, pctDeEntrada: 0 },
    },
    filas: filas.map(f => ({
      id: f.id, numero: 1, codigo: `TR-${f.id}`, categoria: 'pcb', fecha: '2026-10-01', almacenId: null, entrada: 'x',
      kgEntrada: 100, kgSalida: 100 - f.pct, kgMerma: f.pct, pctMerma: f.pct,
      mermaPorTipo: { basura: 0, plastico: 0, tierra: 0, hierro: 0, otro: 0 }, kgTipificado: 0, kgSinClasificar: f.pct, kgTipificadoExcede: 0,
    })),
  });
  const R1 = { desde: '2026-09-04', hasta: '2026-10-03' };
  const R0 = rangoAnterior(R1);

  it('compara con el periodo anterior y marca si supera el umbral', async () => {
    const { armarResumenMerma } = await import('../src/utils/resumen-inventario.js');
    const r = armarResumenMerma(R1, rep(1000, 100, [{ id: 'a', pct: 12 }, { id: 'b', pct: 3 }]), R0, rep(800, 40), 8);
    expect(r.actual.pctMerma).toBe(10);
    expect(r.anterior.pctMerma).toBe(5);
    expect(r.variacion).toEqual({ kgMerma: 60, pctMermaPuntos: 5 });
    expect(r.sobreUmbral).toBe(true);
    expect(r.transformacionesAltas.map(t => t.id)).toEqual(['a']);
  });
  it('sin entrada en el periodo anterior no hay variacion en puntos y sin datos no marca umbral', async () => {
    const { armarResumenMerma } = await import('../src/utils/resumen-inventario.js');
    const r = armarResumenMerma(R1, rep(0, 0), R0, rep(0, 0), 8);
    expect(r.variacion.pctMermaPuntos).toBeNull();
    expect(r.sobreUmbral).toBe(false);
  });
});
