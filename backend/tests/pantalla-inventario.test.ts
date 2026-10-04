import { describe, it, expect } from 'vitest';
import {
  armarDetalle,
  separarClasificaciones,
  construirFilasDetalle,
  construirFilasDetalleConAvisos,
  construirTarjetas,
  filtrarFilas,
  rendimientoPorCategoria,
  type EntradaFilas,
} from '../src/utils/pantalla-inventario.js';
import { construirResumenInventario, type InventarioAlmacenEntrada } from '../src/utils/resumen-inventario.js';
import { configuracionPorDefecto } from '../src/schemas/configuracion-inventario.js';
import type { MovimientosInventario } from '../src/utils/movimientos-pantalla.js';

const G1 = 'g1';
const G2 = 'g2';
const HOY = '2026-10-04';
const RANGO = { desde: '2026-09-04', hasta: HOY };

const art = (productoId: string, nombre: string, stock: number, loteId: string | null = null) => ({
  productoId, nombre, destinoTipo: loteId ? ('lote' as const) : ('mpp' as const), loteId, stock,
});

const almacenes: InventarioAlmacenEntrada[] = [
  {
    almacenId: G1, nombre: 'ALMACEN G1',
    grupos: [
      { tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso', articulos: [art('p-alu', 'ALUMINIO', 100)] },
      { tipoMaterialId: null, nombreCategoria: 'Lotes', articulos: [art('__lote_adj__L1', 'LOTE 1', 1000, 'L1')] },
    ],
  },
  {
    almacenId: G2, nombre: 'ALMACEN G2',
    grupos: [
      { tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso', articulos: [art('p-alu', 'ALUMINIO', 50), art('p-cobre', 'COBRE', 20)] },
      { tipoMaterialId: 'tm-pcb', nombreCategoria: 'PCB', articulos: [art('p-tel', 'TELEFONO', 30)] },
      { tipoMaterialId: 'tm-raee', nombreCategoria: 'RAEE', articulos: [art('p-raee', 'DESARME RAEE', 10)] },
      {
        tipoMaterialId: null, nombreCategoria: 'Lotes',
        articulos: [art('__lote_adj__L1', 'LOTE 1', 500, 'L1'), art('__lote_adj__B', 'BGPP', 200, 'B'), art('__lote_adj__L4', 'LOTE 4', 20, 'L4')],
      },
    ],
  },
];

const lotes = [
  { id: 'L1', nombre: 'LOTE 1', activo: true, clase: 'exportacion' as const, precioEstimadoKg: 2, precioEstimadoActualizadoEn: null },
  { id: 'L4', nombre: 'LOTE 4', activo: true, clase: 'exportacion' as const, precioEstimadoKg: null, precioEstimadoActualizadoEn: null },
  { id: 'B', nombre: 'BGPP', activo: true, clase: 'trabajo' as const, precioEstimadoKg: null, precioEstimadoActualizadoEn: null },
  { id: 'X', nombre: 'VIEJO', activo: false, clase: 'otro' as const, precioEstimadoKg: null, precioEstimadoActualizadoEn: null },
];

const movimientos: MovimientosInventario = {
  productos: [
    { id: 'p-alu', nombre: 'ALUMINIO', tipoMaterialId: 'tm-nf', categoria: 'No Ferroso' },
    { id: 'p-cobre', nombre: 'COBRE', tipoMaterialId: 'tm-nf', categoria: 'No Ferroso' },
    { id: 'p-tel', nombre: 'TELEFONO', tipoMaterialId: 'tm-pcb', categoria: 'PCB' },
    { id: 'p-raee', nombre: 'DESARME RAEE', tipoMaterialId: 'tm-raee', categoria: 'RAEE' },
  ],
  tickets: [
    { tipo: 'compra', fecha: '2026-10-02', almacenId: G2, detalle: [{ productoId: 'p-alu', pesoNeto: 60, loteId: null }] },
    { tipo: 'venta', fecha: '2026-10-01', almacenId: G2, detalle: [{ productoId: 'p-cobre', pesoNeto: 15, loteId: null }] },
    { tipo: 'venta', fecha: '2026-07-01', almacenId: G2, detalle: [{ productoId: 'p-cobre', pesoNeto: 999, loteId: null }] },
  ],
  transformaciones: [
    {
      id: 't1', numero: 1, categoria: 'ferroso_no_ferroso', estado: 'bruto', fecha: '2026-10-03', almacenId: G2, loteOrigenId: null,
      pesoNeto: 12, entradas: [{ productoId: 'p-alu', pesoKg: 12 }], salidas: [], merma: [],
    },
  ],
  ajustes: [{ productoId: 'p-alu', loteId: null, almacenId: G1, diferencia: 500, fecha: '2026-09-16' }],
  embalajes: [],
};

const base: EntradaFilas = {
  almacenes,
  lotes,
  embalajes: [{ loteId: 'L1', almacenId: null, pesoKg: 400, anulado: false }],
  costos: new Map([['p-alu', { costoPromedioKg: 1.5, kgFacturados: 1000 }]]),
  movimientos,
  hoy: HOY,
  rango: RANGO,
  almacenId: null,
  valorOculto: false,
};

const porId = (filas: ReturnType<typeof construirFilasDetalle>, id: string) => filas.find(f => f.id === id);

describe('construirFilasDetalle', () => {
  const filas = construirFilasDetalle(base);

  it('el stock de la tabla suma lo mismo que el resumen (sin contar doble los lotes)', () => {
    const resumen = construirResumenInventario({
      almacenes, lotes, embalajes: [{ loteId: 'L1', almacenId: null, pesoKg: 400, anulado: false }],
      productosNoVendibles: new Set(), costos: base.costos, config: configuracionPorDefecto(),
    });
    const enGalpon = filas.filter(f => f.enGalpon).reduce((a, f) => a + f.kg, 0);
    expect(enGalpon).toBeCloseTo(resumen.totalKg, 3);
    expect(enGalpon).toBe(1930);
    expect(filas.filter(f => f.enGalpon && f.tipo === 'lote').reduce((a, f) => a + f.kg, 0)).toBeCloseTo(resumen.lotes.totalKg, 3);
  });

  it('material: kg por almacen, costo, valor a costo y vista/etapa', () => {
    const alu = porId(filas, 'mat:p-alu')!;
    expect(alu).toMatchObject({
      tipo: 'material', enGalpon: true, kg: 150, vista: 'venta_nacional', etapa: 'listo', categoria: 'No Ferroso',
      costoPromedioKg: 1.5, valorCostoUsd: 225, valorEstimadoUsd: null, embaladoKg: null,
    });
    expect(alu.porAlmacen).toEqual([{ almacenId: G1, almacenNombre: 'ALMACEN G1', kg: 100 }, { almacenId: G2, almacenNombre: 'ALMACEN G2', kg: 50 }]);
    expect(alu.kgPorEtapa).toEqual({ recibido: 0, enProceso: 0, listo: 150, despachado: 0 });
  });

  it('material sin costo: valores null (no se inventa)', () => {
    expect(porId(filas, 'mat:p-cobre')).toMatchObject({ kg: 20, costoPromedioKg: null, valorCostoUsd: null });
  });

  it('PCB y RAEE (sin lote) estan recibidos; RAEE va a trabajo interno y PCB a exportacion', () => {
    expect(porId(filas, 'mat:p-tel')).toMatchObject({ vista: 'exportacion', etapa: 'recibido' });
    expect(porId(filas, 'mat:p-raee')).toMatchObject({ vista: 'trabajo_interno', etapa: 'recibido' });
  });

  it('lote de exportacion: embalado = listo, resto en saca = en proceso, valor ESTIMADO (no costo)', () => {
    const l1 = porId(filas, 'lote:L1')!;
    expect(l1).toMatchObject({
      tipo: 'lote', clase: 'exportacion', vista: 'exportacion', etapa: 'en_proceso', kg: 1500, embaladoKg: 400, enSacaKg: 1100,
      precioEstimadoKg: 2, valorEstimadoUsd: 3000, valorCostoUsd: null, costoPromedioKg: null, categoriaClave: 'lotes:exportacion',
    });
    expect(l1.kgPorEtapa).toEqual({ recibido: 0, enProceso: 1100, listo: 400, despachado: 0 });
    expect(l1.porAlmacen.map(a => a.kg)).toEqual([1000, 500]);
  });

  it('lote de trabajo por procesar (BGPP): recibido, trabajo interno, fase por nombre; lote sin precio: valor null; lote archivado sin stock no aparece', () => {
    expect(porId(filas, 'lote:B')).toMatchObject({ vista: 'trabajo_interno', etapa: 'recibido', fase: 'por_procesar', kg: 200, valorEstimadoUsd: null });
    expect(porId(filas, 'lote:L4')).toMatchObject({ precioEstimadoKg: null, valorEstimadoUsd: null });
    expect(porId(filas, 'lote:X')).toBeUndefined();
  });

  it('antiguedad estimada: el stock se explica con las entradas mas recientes (compra del 10-02 antes que la toma fisica)', () => {
    const alu = porId(filas, 'mat:p-alu')!;
    // 150 kg = 60 (compra 2 dias) + 90 (de los 500 del ajuste del 09-16, 18 dias)
    expect(alu.dias).toMatchObject({ estimado: true, kgConFecha: 150, kgSinFecha: 0, fechaEntradaMasAntigua: '2026-09-16', fechaEntradaMasReciente: '2026-10-02' });
    expect(alu.dias?.diasPromedio).toBe(((60 * 2 + 90 * 18) / 150));
    // Sin ninguna entrada registrada: no se inventa
    expect(porId(filas, 'mat:p-cobre')!.dias).toBeNull();
  });

  it('kg en transformacion bruto: fila informativa en proceso, fuera del galpon', () => {
    const t = porId(filas, 'transf:p:p-alu')!;
    expect(t).toMatchObject({ enGalpon: false, etapa: 'en_proceso', kg: 12, kgPorEtapa: { enProceso: 12 }, dias: null });
  });

  it('despachado: solo los tickets de venta del periodo', () => {
    const d = filas.filter(f => f.etapa === 'despachado');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id: 'desp:p:p-cobre', enGalpon: false, kg: 15, kgPorEtapa: { despachado: 15 } });
  });

  it('valorOculto: ningun costo, precio ni valor sale en las filas', () => {
    const ocultas = construirFilasDetalle({ ...base, valorOculto: true });
    for (const f of ocultas) {
      expect(f.costoPromedioKg).toBeNull();
      expect(f.valorCostoUsd).toBeNull();
      expect(f.precioEstimadoKg).toBeNull();
      expect(f.valorEstimadoUsd).toBeNull();
    }
    expect(ocultas.find(f => f.id === 'mat:p-alu')!.kg).toBe(150);
  });

  it('filtro por almacen: kg, embalado y despachos de ESE almacen', () => {
    const g1 = construirFilasDetalle({ ...base, almacenId: G1 });
    expect(g1.filter(f => f.enGalpon).reduce((a, f) => a + f.kg, 0)).toBe(1100);
    expect(porId(g1, 'mat:p-alu')).toMatchObject({ kg: 100, porAlmacen: [{ almacenId: G1, kg: 100 }] });
    expect(porId(g1, 'mat:p-tel')).toBeUndefined();
    expect(g1.some(f => !f.enGalpon)).toBe(false);
    const g2 = construirFilasDetalle({ ...base, almacenId: G2 });
    // los embalajes sin almacen no se atribuyen a ningun almacen concreto
    expect(porId(g2, 'lote:L1')).toMatchObject({ kg: 500, embaladoKg: 0, enSacaKg: 500 });
    expect(g2.filter(f => f.enGalpon).reduce((a, f) => a + f.kg, 0)).toBe(830);
  });

  it('no muta las entradas', () => {
    const copia = JSON.stringify({ almacenes, lotes, movimientos });
    construirFilasDetalle(base);
    expect(JSON.stringify({ almacenes, lotes, movimientos })).toBe(copia);
  });
});

describe('filtrarFilas', () => {
  const filas = construirFilasDetalle(base);
  it('por categoria (nombre o clave), vista y texto sin tildes', () => {
    expect(filtrarFilas(filas, { categoria: 'no ferroso' }).every(f => f.categoria === 'No Ferroso')).toBe(true);
    expect(filtrarFilas(filas, { categoria: 'lotes:exportacion' }).map(f => f.material).sort()).toEqual(['LOTE 1', 'LOTE 4']);
    expect(new Set(filtrarFilas(filas, { vista: 'trabajo_interno' }).map(f => f.vista))).toEqual(new Set(['trabajo_interno']));
    expect(filtrarFilas(filas, { q: 'telefono' }).map(f => f.material)).toEqual(['TELEFONO']);
    expect(filtrarFilas(filas, { q: 'zzz' })).toEqual([]);
  });
});

describe('armarDetalle', () => {
  const filas = construirFilasDetalle(base);
  it('ordena por categoria y kg, agrupa y recorta sin perder los totales', () => {
    const d = armarDetalle(filas, 3, false);
    expect(d.filas).toHaveLength(3);
    expect(d.limite).toEqual({ maxFilas: 3, totalFilas: filas.length, truncado: true });
    expect(d.totales.kgEnGalpon).toBe(1930);
    expect(d.totales.kgEnTransformacion).toBe(12);
    expect(d.totales.kgDespachado).toBe(15);
    expect(d.totales.valorCostoUsd).toBe(225);
    expect(d.totales.valorEstimadoUsd).toBe(3000);
    expect(d.grupos.find(g => g.categoriaClave === 'tm-nf')).toMatchObject({ kg: 170, filas: 4, valorCostoUsd: 225 });
    expect(d.grupos.reduce((a, g) => a + g.kg, 0)).toBe(1930);
  });
  it('valorOculto: totales de valor null', () => {
    const d = armarDetalle(construirFilasDetalle({ ...base, valorOculto: true }), 100, true);
    expect(d.totales.valorCostoUsd).toBeNull();
    expect(d.totales.valorEstimadoUsd).toBeNull();
    expect(d.grupos.every(g => g.valorCostoUsd === null && g.valorEstimadoUsd === null)).toBe(true);
  });
});

describe('construirTarjetas', () => {
  const filas = construirFilasDetalle(base);
  const transf = [
    { id: 't9', numero: 9, categoria: 'pcb', estado: 'completa' as const, fecha: '2026-10-01', almacenId: G2, loteOrigenId: 'L1', pesoNeto: 100,
      entradas: [], salidas: [{ productoId: null, loteDestinoId: 'L4', pesoNeto: 90 }], merma: [] },
    { id: 't8', numero: 8, categoria: 'pcb', estado: 'completa' as const, fecha: '2026-01-01', almacenId: G2, loteOrigenId: 'L1', pesoNeto: 500,
      entradas: [], salidas: [], merma: [] },
  ];
  const rend = rendimientoPorCategoria(transf, RANGO);
  const r = construirTarjetas(filas, rend, false);

  it('la suma de las tarjetas es el stock total (el del resumen) y cada vista reparte sin perder kg', () => {
    expect(r.totalKgEnGalpon).toBe(1930);
    expect(r.tarjetas.reduce((a, t) => a + t.kgEnGalpon, 0)).toBeCloseTo(1930, 3);
    expect(r.vistas.reduce((a, v) => a + v.kgEnGalpon, 0)).toBeCloseTo(1930, 3);
  });

  it('barra por etapa: recibido + en proceso + listo = galpon + en transformacion', () => {
    for (const t of r.tarjetas) {
      expect(t.etapas.recibidoKg + t.etapas.enProcesoKg + t.etapas.listoKg).toBeCloseTo(t.kgEnGalpon + t.enTransformacionKg, 3);
    }
    const nf = r.tarjetas.find(t => t.clave === 'tm-nf')!;
    expect(nf).toMatchObject({ kgEnGalpon: 170, enTransformacionKg: 12, despachadoKg: 15 });
    expect(nf.etapas).toEqual({ recibidoKg: 0, enProcesoKg: 12, listoKg: 170 });
  });

  it('valor a costo en materiales y estimado en lotes, nunca mezclados', () => {
    const nf = r.tarjetas.find(t => t.clave === 'tm-nf')!;
    expect(nf).toMatchObject({ tipo: 'categoria', valorCostoUsd: 225, kgSinCosto: 20, costoPromedioKg: 1.5, valorEstimadoUsd: null, precioPromedioEstimadoKg: null });
    const lotesExp = r.tarjetas.find(t => t.clave === 'lotes:exportacion')!;
    expect(lotesExp).toMatchObject({ tipo: 'lotes', kgEnGalpon: 1520, valorEstimadoUsd: 3000, kgSinPrecio: 20, precioPromedioEstimadoKg: 2, valorCostoUsd: null, costoPromedioKg: null });
    expect(lotesExp.etapas).toEqual({ recibidoKg: 0, enProcesoKg: 1120, listoKg: 400 });
  });

  it('rendimiento y merma solo en exportacion y solo con transformaciones del periodo (no se inventan)', () => {
    const pcb = r.tarjetas.find(t => t.nombre === 'PCB')!;
    expect(pcb.rendimiento).toMatchObject({ kgEntrada: 100, kgSalida: 90, kgMerma: 10, mermaPct: 10, rendimientoPct: 90, transformaciones: 1 });
    expect(pcb.sinTransformaciones).toBe(false);
    // RAEE (trabajo interno) y venta nacional: sin rendimiento
    expect(r.tarjetas.find(t => t.nombre === 'RAEE')).toMatchObject({ rendimiento: null, sinTransformaciones: false });
    expect(r.tarjetas.find(t => t.clave === 'tm-nf')).toMatchObject({ rendimiento: null, sinTransformaciones: false });
    // sin transformaciones PCB: null + sinTransformaciones
    const sin = construirTarjetas(filas, new Map(), false).tarjetas.find(t => t.nombre === 'PCB')!;
    expect(sin).toMatchObject({ rendimiento: null, sinTransformaciones: true });
  });

  it('dias estimados por tarjeta, ponderados por kg', () => {
    expect(r.tarjetas.find(t => t.clave === 'tm-nf')!.dias).toMatchObject({ estimado: true });
    expect(r.vistas.find(v => v.vista === 'exportacion')!.rendimiento).toMatchObject({ mermaPct: 10 });
    expect(r.vistas.find(v => v.vista === 'venta_nacional')!.rendimiento).toBeNull();
  });

  it('las cuatro vistas siempre estan, aunque una vista este vacia', () => {
    expect(r.vistas.map(v => v.vista)).toEqual(['exportacion', 'venta_nacional', 'trabajo_interno', 'otras']);
    expect(r.vistas.find(v => v.vista === 'otras')).toMatchObject({ kgEnGalpon: 0, tarjetas: 0, dias: null });
  });

  it('valorOculto: ni costos ni valores en las tarjetas', () => {
    const o = construirTarjetas(construirFilasDetalle({ ...base, valorOculto: true }), rend, true);
    for (const t of [...o.tarjetas, ...o.vistas]) {
      expect(t.valorCostoUsd).toBeNull();
      expect(t.valorEstimadoUsd).toBeNull();
      expect(t.costoPromedioKg).toBeNull();
      expect(t.precioPromedioEstimadoKg).toBeNull();
      expect(t.kgSinCosto).toBeNull();
      expect(t.kgSinPrecio).toBeNull();
    }
    expect(o.totalKgEnGalpon).toBe(1930);
  });
});

describe('PCB: lotes de trabajo por fase, clasificaciones, limpieza y basura', () => {
  const alm: InventarioAlmacenEntrada[] = [{
    almacenId: G1, nombre: 'ALMACEN G1',
    grupos: [
      { tipoMaterialId: 'tm-pcb', nombreCategoria: 'PCB', articulos: [art('p-tel', 'TELEFONO', 7)] },
      {
        tipoMaterialId: 'tm-nf', nombreCategoria: 'No Ferroso',
        articulos: [art('p-s', 'PERFIL SUCIO', 30), art('p-l', 'BRONCE LIMPIO', 10), art('p-x', 'ALUMINIO DURO', 5)],
      },
      {
        tipoMaterialId: 'tm-bas', nombreCategoria: 'Basura',
        articulos: [art('p-b1', 'BASURA BUENA', 100), art('p-b2', 'DESECHOS', 400), art('p-b3', 'PANTALLAS', 8)],
      },
      {
        tipoMaterialId: null, nombreCategoria: 'Lotes',
        articulos: [art('__lote_adj__B', 'BGPP', 300, 'B'), art('__lote_adj__Y', 'BGYP', 120, 'Y'), art('__lote_adj__M', 'LOTE MPP', 80, 'M'), art('__lote_adj__Z', 'RARO', 5, 'Z')],
      },
    ],
  }];
  const lotesFase = [
    { id: 'B', nombre: 'BGPP', activo: true, clase: 'trabajo' as const, precioEstimadoKg: null, precioEstimadoActualizadoEn: null },
    { id: 'Y', nombre: 'BGYP', activo: true, clase: 'trabajo' as const, precioEstimadoKg: null, precioEstimadoActualizadoEn: null, fase: 'procesado' },
    { id: 'M', nombre: 'LOTE MPP', activo: true, clase: 'trabajo' as const, precioEstimadoKg: null, precioEstimadoActualizadoEn: null, fase: 'por_procesar' },
    { id: 'Z', nombre: 'RARO', activo: true, clase: 'trabajo' as const, precioEstimadoKg: null, precioEstimadoActualizadoEn: null },
  ];
  const e: EntradaFilas = { ...base, almacenes: alm, lotes: lotesFase, embalajes: [], costos: new Map(), movimientos: { ...movimientos, tickets: [], transformaciones: [], ajustes: [], productos: [] } };
  const filas = construirFilasDetalle(e);

  it('la etapa del PCB sale de la fase del lote: por procesar = recibido, procesado = en proceso', () => {
    expect(porId(filas, 'lote:B')).toMatchObject({ fase: 'por_procesar', etapa: 'recibido', kgPorEtapa: { recibido: 300, enProceso: 0 } });
    expect(porId(filas, 'lote:M')).toMatchObject({ fase: 'por_procesar', etapa: 'recibido' });
    expect(porId(filas, 'lote:Y')).toMatchObject({ fase: 'procesado', etapa: 'en_proceso', kgPorEtapa: { enProceso: 120, recibido: 0 } });
    expect(porId(filas, 'lote:Z')).toMatchObject({ fase: null, etapa: 'recibido' });
  });

  it('la tarjeta de lotes de trabajo reparte los kg por fase', () => {
    const t = construirTarjetas(filas, new Map(), false).tarjetas.find(x => x.clave === 'lotes:trabajo')!;
    expect(t.desgloseFase).toEqual({ porProcesarKg: 380, procesadoKg: 120, sinFaseKg: 5 });
    expect(t.etapas).toEqual({ recibidoKg: 385, enProcesoKg: 120, listoKg: 0 });
    expect(t.desgloseLimpieza).toBeNull();
  });

  it('un producto PCB sin lote es una clasificacion de compra: se separa y sus kg se informan aparte', () => {
    expect(porId(filas, 'mat:p-tel')).toMatchObject({ esClasificacionCompra: true, kg: 7 });
    const { visibles, kgOcultos, valorOcultoUsd } = separarClasificaciones(filas);
    expect(kgOcultos).toBe(7);
    expect(valorOcultoUsd === null || typeof valorOcultoUsd === 'number').toBe(true);
    expect(visibles.some(f => f.id === 'mat:p-tel')).toBe(false);
    const total = filas.filter(f => f.enGalpon).reduce((a, f) => a + f.kg, 0);
    expect(visibles.filter(f => f.enGalpon).reduce((a, f) => a + f.kg, 0) + kgOcultos).toBeCloseTo(total, 3);
    expect(armarDetalle(visibles, 100, false, kgOcultos).totales.kgClasificacionesCompraOcultas).toBe(7);
    expect(armarDetalle(visibles, 100, false, kgOcultos, 21.5).totales.valorClasificacionesCompraOcultasUsd).toBe(21.5);
    expect(armarDetalle(visibles, 100, true, kgOcultos, 21.5).totales.valorClasificacionesCompraOcultasUsd).toBeNull();
  });

  it('No ferroso: limpio / sucio / sin clasificar derivados del nombre', () => {
    expect(porId(filas, 'mat:p-s')).toMatchObject({ limpieza: 'sucio' });
    expect(porId(filas, 'mat:p-l')).toMatchObject({ limpieza: 'limpio' });
    expect(porId(filas, 'mat:p-x')).toMatchObject({ limpieza: null });
    const t = construirTarjetas(filas, new Map(), false).tarjetas.find(x => x.clave === 'tm-nf')!;
    expect(t.desgloseLimpieza).toEqual({ limpioKg: 10, sucioKg: 30, sinClasificarKg: 5 });
    expect(t.desgloseBasura).toBeNull();
  });

  it('Basura: recuperable / desecho / sin clasificar derivados del nombre', () => {
    expect(porId(filas, 'mat:p-b1')).toMatchObject({ destinoBasura: 'recuperable' });
    expect(porId(filas, 'mat:p-b2')).toMatchObject({ destinoBasura: 'desecho' });
    const t = construirTarjetas(filas, new Map(), false).tarjetas.find(x => x.clave === 'tm-bas')!;
    expect(porId(filas, 'mat:p-b3')).toMatchObject({ destinoBasura: 'recuperable' });
    expect(t.desgloseBasura).toEqual({ recuperableKg: 108, desechoKg: 400, sinClasificarKg: 0 });
  });

  it('estado_limpieza del producto manda sobre el nombre; si es null cae al nombre; indica el origen', () => {
    const productos = [
      { id: 'p-s', nombre: 'PERFIL SUCIO', tipoMaterialId: 'tm-nf', categoria: 'No Ferroso', estadoLimpieza: 'limpio' as const }, // el producto contradice al nombre
      { id: 'p-l', nombre: 'BRONCE LIMPIO', tipoMaterialId: 'tm-nf', categoria: 'No Ferroso', estadoLimpieza: null },
      { id: 'p-x', nombre: 'ALUMINIO DURO', tipoMaterialId: 'tm-nf', categoria: 'No Ferroso', estadoLimpieza: 'sucio' as const },
      { id: 'p-b1', nombre: 'BASURA BUENA', tipoMaterialId: 'tm-bas', categoria: 'Basura', estadoLimpieza: 'sucio' as const }, // no aplica a Basura
    ];
    const f2 = construirFilasDetalle({ ...e, movimientos: { ...e.movimientos, productos } });
    expect(porId(f2, 'mat:p-s')).toMatchObject({ limpieza: 'limpio', limpiezaOrigen: 'producto' });
    expect(porId(f2, 'mat:p-l')).toMatchObject({ limpieza: 'limpio', limpiezaOrigen: 'nombre' });
    expect(porId(f2, 'mat:p-x')).toMatchObject({ limpieza: 'sucio', limpiezaOrigen: 'producto' });
    expect(porId(f2, 'mat:p-b1')).toMatchObject({ limpieza: null, limpiezaOrigen: null });
    const t = construirTarjetas(f2, new Map(), false).tarjetas.find(x => x.clave === 'tm-nf')!;
    expect(t.desgloseLimpieza).toEqual({ limpioKg: 40, sucioKg: 5, sinClasificarKg: 0 });
  });

  it('sin estado ni pista en el nombre queda sin definir (limpiezaOrigen null)', () => {
    expect(porId(filas, 'mat:p-x')).toMatchObject({ limpieza: null, limpiezaOrigen: null });
    expect(porId(filas, 'mat:p-s')).toMatchObject({ limpiezaOrigen: 'nombre' });
  });

  it('las marcas derivadas solo aplican a su categoria', () => {
    expect(porId(filas, 'mat:p-b1')!.limpieza).toBeNull();
    expect(porId(filas, 'mat:p-s')!.destinoBasura).toBeNull();
    expect(porId(filas, 'lote:B')).toMatchObject({ limpieza: null, destinoBasura: null, esClasificacionCompra: false });
  });
});

describe('antiguedad con filtro de almacen', () => {
  const AVISO = 'antigüedad aproximada con filtro de almacén';
  const aluDias = (filas: ReturnType<typeof construirFilasDetalle>) => porId(filas, 'mat:p-alu')!.dias;

  it('solo cuenta las entradas de ese almacen (no las de los demas)', () => {
    // G1 (100 kg): su unica entrada es el ajuste del 09-16 (18 dias); la compra del 10-02 es de G2
    expect(aluDias(construirFilasDetalle({ ...base, almacenId: G1 }))).toMatchObject({
      kgConFecha: 100, kgSinFecha: 0, diasPromedio: 18, fechaEntradaMasAntigua: '2026-09-16', fechaEntradaMasReciente: '2026-09-16',
    });
    // G2 (50 kg): la compra del 10-02 (2 dias); el ajuste del 09-16 es de G1
    expect(aluDias(construirFilasDetalle({ ...base, almacenId: G2 }))).toMatchObject({
      kgConFecha: 50, kgSinFecha: 0, diasPromedio: 2, fechaEntradaMasAntigua: '2026-10-02', fechaEntradaMasReciente: '2026-10-02',
    });
  });

  it('si las entradas de ese almacen no explican el stock, el resto queda sin fecha (no se inventa)', () => {
    const sinAjuste = { ...movimientos, ajustes: [] };
    expect(aluDias(construirFilasDetalle({ ...base, movimientos: sinAjuste, almacenId: G1 }))).toBeNull();
  });

  it('una entrada sin almacen conocido cuenta como sin fecha para ese almacen y se avisa', () => {
    const conHuerfana = { ...movimientos, tickets: [...movimientos.tickets, { tipo: 'compra' as const, fecha: '2026-10-03', almacenId: null, detalle: [{ productoId: 'p-alu', pesoNeto: 30, loteId: null }] }] };
    const r = construirFilasDetalleConAvisos({ ...base, movimientos: conHuerfana, almacenId: G1 });
    expect(r.avisos).toEqual([AVISO]);
    // la compra huerfana (10-03) NO se usa: G1 sigue explicada solo por el ajuste del 09-16
    expect(r.filas.find(f => f.id === 'mat:p-alu')!.dias).toMatchObject({ kgConFecha: 100, fechaEntradaMasReciente: '2026-09-16' });
  });

  it('sin filtro de almacen: se usan todas las entradas y no hay aviso', () => {
    const r = construirFilasDetalleConAvisos(base);
    expect(r.avisos).toEqual([]);
    expect(r.filas.find(f => f.id === 'mat:p-alu')!.dias).toMatchObject({ fechaEntradaMasReciente: '2026-10-02' });
  });

  it('con filtro y todas las entradas con almacen conocido: sin aviso', () => {
    expect(construirFilasDetalleConAvisos({ ...base, almacenId: G1 }).avisos).toEqual([]);
  });

  it('lotes: las salidas de transformacion cuentan en el almacen de la transformacion', () => {
    const mov: MovimientosInventario = {
      ...movimientos,
      transformaciones: [
        { id: 'tl', numero: 2, categoria: 'pcb', estado: 'completa', fecha: '2026-10-01', almacenId: G2, loteOrigenId: null, pesoNeto: 500, entradas: [], salidas: [{ productoId: null, loteDestinoId: 'L1', pesoNeto: 500 }], merma: [] },
      ],
    };
    const g2 = construirFilasDetalle({ ...base, movimientos: mov, almacenId: G2 }).find(f => f.id === 'lote:L1')!;
    expect(g2.dias).toMatchObject({ kgConFecha: 500, fechaEntradaMasReciente: '2026-10-01' });
    const g1 = construirFilasDetalle({ ...base, movimientos: mov, almacenId: G1 }).find(f => f.id === 'lote:L1')!;
    expect(g1.dias).toBeNull();
  });
});
