import { describe, it, expect } from 'vitest';
import { construirFlujo, type EntradaFlujo } from '../src/utils/flujo-inventario.js';
import type { MovimientosInventario, TransformacionMov } from '../src/utils/movimientos-pantalla.js';

const RANGO = { desde: '2026-09-04', hasta: '2026-10-04' };
const lote = (id: string, nombre: string, clase: 'exportacion' | 'trabajo' | 'otro') => ({
  id, nombre, activo: true, clase, precioEstimadoKg: null, precioEstimadoActualizadoEn: null,
});
const lotes = [lote('L1', 'LOTE 1', 'exportacion'), lote('L2', 'LOTE 2', 'exportacion'), lote('B', 'BGPP', 'trabajo'), lote('O', 'PCB LIGADO', 'otro')];

const productos = [
  { id: 'perfil', nombre: 'PERFIL SUCIO', tipoMaterialId: 'nf', categoria: 'No Ferroso' },
  { id: 'plastico', nombre: 'PLASTICO 2', tipoMaterialId: 'nf', categoria: 'No Ferroso' },
  { id: 'raee', nombre: 'DESARME RAEE', tipoMaterialId: 'raee', categoria: 'RAEE' },
  { id: 'tel', nombre: 'TELEFONO', tipoMaterialId: 'pcb', categoria: 'PCB' },
  { id: 'desecho', nombre: 'DESECHOS', tipoMaterialId: 'bas', categoria: 'Basura' },
];

const transf = (parcial: Partial<TransformacionMov> & { id: string }): TransformacionMov => ({
  numero: 1, categoria: 'ferroso_no_ferroso', estado: 'completa', fecha: '2026-10-02', almacenId: 'g2', loteOrigenId: null,
  pesoNeto: 0, entradas: [], salidas: [], merma: [], ...parcial,
});

const mov = (parcial: Partial<MovimientosInventario>): MovimientosInventario => ({
  productos, tickets: [], transformaciones: [], ajustes: [], embalajes: [], ...parcial,
});

const entrada = (m: MovimientosInventario, extra: Partial<EntradaFlujo> = {}): EntradaFlujo => ({
  movimientos: m, lotes, rango: RANGO, almacenId: null, categoria: null,
  categoriasConActividad: [
    { clave: 'pcb', nombre: 'PCB', vista: 'exportacion' },
    { clave: 'nf', nombre: 'No Ferroso', vista: 'venta_nacional' },
    { clave: 'raee', nombre: 'RAEE', vista: 'trabajo_interno' },
  ],
  ...extra,
});

const enlace = (r: ReturnType<typeof construirFlujo>, origen: string, destino: string) =>
  r.enlaces.find(e => e.origen === origen && e.destino === destino)?.kg;

describe('construirFlujo: sin movimientos no se inventa nada', () => {
  it('sin datos: nodos y enlaces vacios, con mensaje y las categorias de exportacion/trabajo sin transformaciones', () => {
    const r = construirFlujo(entrada(mov({})));
    expect(r.sinDatos).toBe(true);
    expect(r.nodos).toEqual([]);
    expect(r.enlaces).toEqual([]);
    expect(r.mensajeSinDatos).toMatch(/No hay compras, transformaciones ni despachos/);
    expect(r.categoriasSinTransformaciones.map(c => c.nombre)).toEqual(['PCB', 'RAEE']);
    expect(r.tramosSinDatos).toEqual([
      { desde: 'Lotes de trabajo', hacia: 'Lotes de exportación', motivo: expect.stringMatching(/transformaciones registradas/) },
      { desde: 'RAEE', hacia: 'Transformación (desarme o polvo)', motivo: expect.any(String) },
    ]);
    expect(r.totales).toEqual({ kgComprado: 0, kgTransformado: 0, kgMerma: 0, kgDespachado: 0, transformaciones: 0 });
  });

  it('solo compras (PCB/PGM sin transformaciones): se ven las compras, sinTransformaciones=true y el aviso', () => {
    const r = construirFlujo(entrada(mov({ tickets: [{ tipo: 'compra', fecha: '2026-10-01', almacenId: 'g2', detalle: [{ productoId: 'tel', pesoNeto: 80, loteId: null }] }] })));
    expect(r.sinDatos).toBe(false);
    expect(r.sinTransformaciones).toBe(true);
    expect(enlace(r, 'compra', 'clas:tel')).toBe(80);
    expect(r.mensajeSinDatos).toMatch(/Aún no hay transformaciones/);
    expect(r.categoriasSinTransformaciones.map(c => c.nombre)).toContain('PCB');
  });
});

describe('construirFlujo: compras, ajustes y despachos', () => {
  const m = mov({
    tickets: [
      { tipo: 'compra', fecha: '2026-10-01', almacenId: 'g2', detalle: [{ productoId: 'perfil', pesoNeto: 100, loteId: null }, { productoId: 'tel', pesoNeto: 50, loteId: 'L1' }] },
      { tipo: 'venta', fecha: '2026-10-02', almacenId: 'g2', detalle: [{ productoId: 'plastico', pesoNeto: 30, loteId: null }, { productoId: 'tel', pesoNeto: 20, loteId: 'L1' }] },
      { tipo: 'compra', fecha: '2026-01-01', almacenId: 'g2', detalle: [{ productoId: 'perfil', pesoNeto: 999, loteId: null }] },
    ],
    ajustes: [
      { productoId: 'perfil', loteId: null, almacenId: 'g1', diferencia: 200, fecha: '2026-09-16' },
      { productoId: null, loteId: 'L2', almacenId: 'g1', diferencia: 70, fecha: '2026-09-16' },
      { productoId: 'perfil', loteId: null, almacenId: 'g1', diferencia: -5, fecha: '2026-09-17' },
    ],
  });
  const r = construirFlujo(entrada(m));

  it('compra -> categoria; PCB se agrupa por clasificacion de compra y de ahi va al lote', () => {
    expect(enlace(r, 'compra', 'cat:nf')).toBe(100);
    expect(enlace(r, 'compra', 'clas:tel')).toBe(50);
    expect(enlace(r, 'clas:tel', 'lote:L1')).toBe(50);
  });
  it('ajustes positivos son una fuente aparte; los negativos y los fuera de rango no cuentan', () => {
    expect(enlace(r, 'ajuste', 'cat:nf')).toBe(200);
    expect(enlace(r, 'ajuste', 'lote:L2')).toBe(70);
    expect(r.enlaces.some(e => e.kg === 999)).toBe(false);
  });
  it('ventas: categoria o lote -> despachado', () => {
    expect(enlace(r, 'cat:nf', 'despacho')).toBe(30);
    expect(enlace(r, 'lote:L1', 'despacho')).toBe(20);
    expect(r.totales.kgDespachado).toBe(50);
    expect(r.totales.kgComprado).toBe(150);
  });
  it('las columnas hacen que todo enlace vaya hacia adelante (sin ciclos)', () => {
    const col = new Map(r.nodos.map(n => [n.id, n.columna]));
    for (const e of r.enlaces) expect(col.get(e.origen)!).toBeLessThan(col.get(e.destino)!);
  });
});

describe('construirFlujo: transformaciones', () => {
  const t1 = transf({
    id: 't1', pesoNeto: 100,
    entradas: [{ productoId: 'perfil', pesoKg: 60 }, { productoId: 'raee', pesoKg: 40 }],
    salidas: [
      { productoId: 'perfil', loteDestinoId: 'L2', pesoNeto: 20 },
      { productoId: null, loteDestinoId: 'B', pesoNeto: 30 },
      { productoId: 'plastico', loteDestinoId: null, pesoNeto: 40 },
    ],
    merma: [{ tipo: 'basura', pesoKg: 6 }],
  });
  const r = construirFlujo(entrada(mov({ transformaciones: [t1] })));

  it('reparte cada salida entre los origenes en proporcion a lo que aportaron (60/40)', () => {
    expect(enlace(r, 'cat:nf', 'lote:L2')).toBe(12);
    expect(enlace(r, 'cat:raee', 'lote:L2')).toBe(8);
    expect(enlace(r, 'cat:nf', 'lote:B')).toBe(18);
    expect(enlace(r, 'cat:raee', 'lote:B')).toBe(12);
    expect(enlace(r, 'cat:nf', 'venta:nf')).toBe(24);
    expect(enlace(r, 'cat:raee', 'venta:nf')).toBe(16);
  });
  it('la merma se abre por tipo y lo no tipificado queda sin clasificar', () => {
    expect(enlace(r, 'cat:nf', 'merma:basura')).toBe(3.6);
    expect(enlace(r, 'cat:nf', 'merma:sin_clasificar')).toBe(2.4);
    expect(r.totales.kgMerma).toBe(10);
  });
  it('conserva los kg: lo que entra a la transformacion = lo que sale por todos los destinos', () => {
    const salidoDeCategorias = r.enlaces.filter(e => e.origen.startsWith('cat:')).reduce((a, e) => a + e.kg, 0);
    expect(salidoDeCategorias).toBeCloseTo(100, 3);
    expect(r.totales).toMatchObject({ kgTransformado: 100, transformaciones: 1 });
    expect(r.sinTransformaciones).toBe(false);
    expect(r.mensajeSinDatos).toBeNull();
  });
  it('los lotes llevan su tipo y columna segun la clase; la merma y la venta directa son la ultima columna', () => {
    const n = (id: string) => r.nodos.find(x => x.id === id)!;
    expect(n('lote:L2')).toMatchObject({ tipo: 'lote_exportacion', columna: 4, loteId: 'L2', nombre: 'LOTE 2' });
    expect(n('lote:B')).toMatchObject({ tipo: 'lote_trabajo', columna: 2 });
    expect(n('venta:nf')).toMatchObject({ tipo: 'venta_directa', columna: 5 });
    expect(n('merma:basura')).toMatchObject({ tipo: 'merma', columna: 5 });
    expect(n('cat:nf').kg).toBeCloseTo(60, 3);
  });
  it('la categoria transformada deja de aparecer como sin transformaciones', () => {
    expect(r.categoriasSinTransformaciones.map(c => c.nombre)).toEqual(['PCB']);
  });

  it('PCB: el origen es el LOTE del que se retiro (trabajo -> exportacion + merma)', () => {
    const pcb = transf({
      id: 't2', categoria: 'pcb', loteOrigenId: 'B', pesoNeto: 200,
      entradas: [{ productoId: 'tel', pesoKg: 5 }, { productoId: null, pesoKg: 195 }],
      salidas: [{ productoId: null, loteDestinoId: 'L1', pesoNeto: 150 }, { productoId: null, loteDestinoId: 'L2', pesoNeto: 30 }],
      merma: [{ tipo: 'tierra', pesoKg: 20 }],
    });
    const f = construirFlujo(entrada(mov({ transformaciones: [pcb] })));
    expect(enlace(f, 'lote:B', 'lote:L1')).toBe(150);
    expect(enlace(f, 'lote:B', 'lote:L2')).toBe(30);
    expect(enlace(f, 'lote:B', 'merma:tierra')).toBe(20);
    expect(f.categoriasSinTransformaciones.map(c => c.nombre)).not.toContain('PCB');
  });

  it('ignora transformaciones en estado bruto, fuera del periodo o de otro almacen', () => {
    const base = { entradas: [{ productoId: 'perfil', pesoKg: 10 }], salidas: [{ productoId: 'plastico', loteDestinoId: null, pesoNeto: 10 }], pesoNeto: 10 };
    const f = construirFlujo(entrada(mov({
      transformaciones: [transf({ id: 'a', estado: 'bruto', ...base }), transf({ id: 'b', fecha: '2026-01-01', ...base }), transf({ id: 'c', almacenId: 'g1', ...base })],
    }), { almacenId: 'g2' }));
    expect(f.sinDatos).toBe(true);
    expect(f.totales.transformaciones).toBe(0);
  });

  it('no esconde lo que no se puede dibujar: un lote de exportacion como origen hacia otro lote de exportacion se informa', () => {
    const rara = transf({
      id: 't3', categoria: 'pcb', loteOrigenId: 'L1', pesoNeto: 50,
      salidas: [{ productoId: null, loteDestinoId: 'L2', pesoNeto: 50 }],
    });
    const f = construirFlujo(entrada(mov({ transformaciones: [rara] })));
    expect(f.enlaces).toEqual([]);
    expect(f.enlacesOmitidos).toEqual([expect.objectContaining({ origen: 'lote:L1', destino: 'lote:L2', kg: 50, motivo: expect.stringMatching(/lotes de exportación/) })]);
  });

  it('un lote de exportacion como origen hacia basura es valido (ultima columna)', () => {
    const t = transf({
      id: 't4', categoria: 'pcb', loteOrigenId: 'L1', pesoNeto: 215,
      salidas: [{ productoId: 'desecho', loteDestinoId: null, pesoNeto: 215 }],
    });
    const f = construirFlujo(entrada(mov({ transformaciones: [t] })));
    expect(enlace(f, 'lote:L1', 'venta:bas')).toBe(215);
    expect(f.enlacesOmitidos).toEqual([]);
  });

  it('una ganancia de peso (salida > entrada) no genera merma negativa', () => {
    const t = transf({ id: 't5', pesoNeto: 10, entradas: [{ productoId: 'perfil', pesoKg: 10 }], salidas: [{ productoId: 'plastico', loteDestinoId: null, pesoNeto: 12 }] });
    const f = construirFlujo(entrada(mov({ transformaciones: [t] })));
    expect(f.totales.kgMerma).toBe(0);
    expect(enlace(f, 'cat:nf', 'venta:nf')).toBe(12);
  });
});

describe('construirFlujo: filtro por categoria', () => {
  const m = mov({
    tickets: [
      { tipo: 'compra', fecha: '2026-10-01', almacenId: 'g2', detalle: [{ productoId: 'perfil', pesoNeto: 100, loteId: null }, { productoId: 'tel', pesoNeto: 50, loteId: null }] },
    ],
    transformaciones: [
      transf({ id: 't1', pesoNeto: 100, entradas: [{ productoId: 'perfil', pesoKg: 100 }], salidas: [{ productoId: null, loteDestinoId: 'B', pesoNeto: 100 }] }),
      transf({ id: 't2', categoria: 'pcb', loteOrigenId: 'B', pesoNeto: 100, entradas: [{ productoId: 'tel', pesoKg: 100 }], salidas: [{ productoId: null, loteDestinoId: 'L1', pesoNeto: 90 }] }),
    ],
  });

  it('por nombre o clave: lo que entra a esa categoria y todo lo que sale hacia adelante', () => {
    const r = construirFlujo(entrada(m, { categoria: 'no ferroso' }));
    expect(enlace(r, 'compra', 'cat:nf')).toBe(100);
    expect(enlace(r, 'cat:nf', 'lote:B')).toBe(100);
    expect(enlace(r, 'lote:B', 'lote:L1')).toBe(90);
    expect(enlace(r, 'compra', 'clas:tel')).toBeUndefined();
    expect(construirFlujo(entrada(m, { categoria: 'nf' })).enlaces).toEqual(r.enlaces);
  });
  it('una categoria sin movimientos devuelve sinDatos con el mensaje de esa categoria', () => {
    const r = construirFlujo(entrada(m, { categoria: 'RAEE' }));
    expect(r.sinDatos).toBe(true);
    expect(r.mensajeSinDatos).toMatch(/esa categoría/);
  });
  it('una categoria solo comprada (sin transformaciones) avisa que faltan', () => {
    const r = construirFlujo(entrada(mov({ tickets: m.tickets }), { categoria: 'PCB' }));
    expect(r.sinDatos).toBe(false);
    expect(r.sinTransformaciones).toBe(true);
    expect(r.mensajeSinDatos).toMatch(/transformaciones registradas de esa categoría/);
    expect(r.nodos.map(n => n.id).sort()).toEqual(['clas:tel', 'compra']);
  });
});

describe('construirFlujo: PCB por clasificacion de compra y tramos sin datos', () => {
  it('las compras de PCB se agrupan por clasificacion (nodo clasificacion en la columna 1) y van al lote de trabajo', () => {
    const m = mov({
      productos: [...productos, { id: 'ram', nombre: 'MEMORIA RAM DORADA', tipoMaterialId: 'pcb', categoria: 'PCB' }],
      tickets: [{ tipo: 'compra', fecha: '2026-10-01', almacenId: 'g2', detalle: [
        { productoId: 'tel', pesoNeto: 40, loteId: 'B' }, { productoId: 'ram', pesoNeto: 25, loteId: 'B' }, { productoId: 'tel', pesoNeto: 10, loteId: 'B' },
      ] }],
    });
    const r = construirFlujo(entrada(m));
    expect(enlace(r, 'compra', 'clas:tel')).toBe(50);
    expect(enlace(r, 'compra', 'clas:ram')).toBe(25);
    expect(enlace(r, 'clas:tel', 'lote:B')).toBe(50);
    expect(r.nodos.find(n => n.id === 'clas:ram')).toMatchObject({ tipo: 'clasificacion', columna: 1, nombre: 'MEMORIA RAM DORADA', categoriaClave: 'pcb' });
    expect(r.nodos.some(n => n.id === 'cat:pcb')).toBe(false);
    // sin transformaciones: el tramo trabajo -> exportacion se marca sin datos, sin inventar enlaces
    expect(r.tramosSinDatos.map(t => t.desde)).toContain('Lotes de trabajo');
    expect(r.enlaces.some(e => e.origen === 'lote:B')).toBe(false);
  });

  it('con una transformacion que mueve de trabajo a exportacion, ese tramo ya no esta sin datos', () => {
    const t = transf({ id: 'p1', categoria: 'pcb', loteOrigenId: 'B', pesoNeto: 10, salidas: [{ productoId: null, loteDestinoId: 'L1', pesoNeto: 10 }] });
    expect(construirFlujo(entrada(mov({ transformaciones: [t] }))).tramosSinDatos.map(x => x.desde)).not.toContain('Lotes de trabajo');
  });

  it('el filtro por la categoria PCB muestra sus clasificaciones y lo que sigue', () => {
    const m = mov({
      tickets: [{ tipo: 'compra', fecha: '2026-10-01', almacenId: 'g2', detalle: [{ productoId: 'tel', pesoNeto: 40, loteId: 'B' }, { productoId: 'perfil', pesoNeto: 9, loteId: null }] }],
    });
    const r = construirFlujo(entrada(m, { categoria: 'pcb' }));
    expect(r.nodos.map(n => n.id).sort()).toEqual(['clas:tel', 'compra', 'lote:B']);
  });
});

describe('construirFlujo: lote de trabajo -> lote de trabajo (por procesar -> procesado -> exportacion)', () => {
  const lotesPc = [
    lote('PCPP', 'PCPP', 'trabajo'), lote('BGYP', 'BGYP', 'trabajo'), lote('L1', 'LOTE 1', 'exportacion'), lote('L2', 'LOTE 2', 'exportacion'),
    lote('RARO', 'RARO', 'trabajo'), lote('O', 'PCB LIGADO', 'otro'),
  ];
  const t = (parcial: Partial<TransformacionMov> & { id: string }) => transf({ categoria: 'pcb', ...parcial });
  const conLotes = (m: MovimientosInventario) => entrada(m, { lotes: lotesPc });

  it('PCPP -> BGYP -> LOTE 1 se dibuja completo, en columnas 2, 3 y 4, sin omitidos', () => {
    const m = mov({ transformaciones: [
      t({ id: 'a', loteOrigenId: 'PCPP', pesoNeto: 100, salidas: [{ productoId: null, loteDestinoId: 'BGYP', pesoNeto: 90 }], merma: [{ tipo: 'tierra', pesoKg: 10 }] }),
      t({ id: 'b', loteOrigenId: 'BGYP', pesoNeto: 90, salidas: [{ productoId: null, loteDestinoId: 'L1', pesoNeto: 80 }, { productoId: 'desecho', loteDestinoId: null, pesoNeto: 10 }] }),
    ] });
    const r = construirFlujo(conLotes(m));
    expect(enlace(r, 'lote:PCPP', 'lote:BGYP')).toBe(90);
    expect(enlace(r, 'lote:BGYP', 'lote:L1')).toBe(80);
    expect(enlace(r, 'lote:PCPP', 'merma:tierra')).toBe(10);
    expect(enlace(r, 'lote:BGYP', 'venta:bas')).toBe(10);
    expect(r.enlacesOmitidos).toEqual([]);
    const col = (id: string) => r.nodos.find(n => n.id === id)!.columna;
    expect([col('lote:PCPP'), col('lote:BGYP'), col('lote:L1')]).toEqual([2, 3, 4]);
    expect(col('merma:tierra')).toBe(5);
  });

  it('sin ciclos: todo enlace dibujado va a una columna mayor', () => {
    const m = mov({ transformaciones: [
      t({ id: 'a', loteOrigenId: 'PCPP', pesoNeto: 100, salidas: [{ productoId: null, loteDestinoId: 'BGYP', pesoNeto: 100 }] }),
      t({ id: 'b', loteOrigenId: 'BGYP', pesoNeto: 100, salidas: [{ productoId: null, loteDestinoId: 'PCPP', pesoNeto: 5 }, { productoId: null, loteDestinoId: 'L1', pesoNeto: 95 }] }),
    ] });
    const r = construirFlujo(conLotes(m));
    const col = new Map(r.nodos.map(n => [n.id, n.columna]));
    for (const e of r.enlaces) expect(col.get(e.origen)!).toBeLessThan(col.get(e.destino)!);
  });

  it('procesado -> por procesar (retroceso de fase) se omite con motivo de fase, no uno generico', () => {
    const m = mov({ transformaciones: [t({ id: 'b', loteOrigenId: 'BGYP', pesoNeto: 5, salidas: [{ productoId: null, loteDestinoId: 'PCPP', pesoNeto: 5 }] })] });
    const r = construirFlujo(conLotes(m));
    expect(r.enlaces).toEqual([]);
    expect(r.enlacesOmitidos).toEqual([expect.objectContaining({ origen: 'lote:BGYP', destino: 'lote:PCPP', kg: 5, motivo: expect.stringMatching(/procesado.*por procesar/) })]);
  });

  it('dos lotes de trabajo de la misma fase se omiten con motivo propio', () => {
    const m = mov({ transformaciones: [t({ id: 'c', loteOrigenId: 'PCPP', pesoNeto: 5, salidas: [{ productoId: null, loteDestinoId: 'RARO', pesoNeto: 5 }] })] });
    const r = construirFlujo(conLotes(m));
    expect(r.enlacesOmitidos).toEqual([expect.objectContaining({ origen: 'lote:PCPP', destino: 'lote:RARO', motivo: expect.stringMatching(/misma fase/) })]);
  });

  it('trabajo -> otro se dibuja; otro -> exportacion se omite con motivo especifico', () => {
    const m = mov({ transformaciones: [
      t({ id: 'd', loteOrigenId: 'BGYP', pesoNeto: 7, salidas: [{ productoId: null, loteDestinoId: 'O', pesoNeto: 7 }] }),
      t({ id: 'e', loteOrigenId: 'O', pesoNeto: 3, salidas: [{ productoId: null, loteDestinoId: 'L2', pesoNeto: 3 }] }),
    ] });
    const r = construirFlujo(conLotes(m));
    expect(enlace(r, 'lote:BGYP', 'lote:O')).toBe(7);
    expect(r.enlacesOmitidos).toEqual([expect.objectContaining({ origen: 'lote:O', destino: 'lote:L2', motivo: expect.stringMatching(/otro.*exportación/i) })]);
    for (const o of r.enlacesOmitidos) expect(o.motivo).not.toMatch(/^El destino no está después del origen/);
  });

  it('un lote sin fase definida cae en por procesar (columna 2)', () => {
    const r = construirFlujo(conLotes(mov({ transformaciones: [t({ id: 'f', loteOrigenId: 'RARO', pesoNeto: 4, salidas: [{ productoId: null, loteDestinoId: 'BGYP', pesoNeto: 4 }] })] })));
    expect(enlace(r, 'lote:RARO', 'lote:BGYP')).toBe(4);
  });
});

describe('construirFlujo: enlaces menores a 0,5 kg', () => {
  const grande = transf({ id: 'g', categoria: 'ferroso_no_ferroso', pesoNeto: 100, entradas: [{ productoId: 'perfil', pesoKg: 100 }], salidas: [{ productoId: 'plastico', loteDestinoId: null, pesoNeto: 99.7 }] });
  const tiny = transf({ id: 'p', categoria: 'ferroso_no_ferroso', pesoNeto: 0.4, entradas: [{ productoId: 'raee', pesoKg: 0.4 }], salidas: [{ productoId: 'raee', loteDestinoId: null, pesoNeto: 0.4 }] });

  it('no se dibujan, se informan en enlacesOmitidos con su motivo y los nodos sin enlaces desaparecen', () => {
    const r = construirFlujo(entrada(mov({ transformaciones: [grande, tiny] })));
    expect(r.enlaces.every(e => e.kg >= 0.5)).toBe(true);
    expect(enlace(r, 'cat:raee', 'venta:raee')).toBeUndefined();
    expect(r.nodos.some(n => n.id === 'venta:raee')).toBe(false);
    expect(r.enlacesOmitidos).toContainEqual({ origen: 'cat:raee', destino: 'venta:raee', kg: 0.4, motivo: 'menor a 0,5 kg' });
  });

  it('los totales siguen contando los enlaces despreciables (merma 0,3 kg no se pierde)', () => {
    const r = construirFlujo(entrada(mov({ transformaciones: [grande] })));
    expect(r.enlacesOmitidos).toEqual([expect.objectContaining({ destino: 'merma:sin_clasificar', kg: 0.3, motivo: 'menor a 0,5 kg' })]);
    expect(r.totales.kgMerma).toBe(0.3);
    expect(r.totales.kgTransformado).toBe(100);
  });

  it('un enlace de exactamente 0,5 kg se dibuja', () => {
    const t = transf({ id: 'e', pesoNeto: 0.5, entradas: [{ productoId: 'perfil', pesoKg: 0.5 }], salidas: [{ productoId: 'plastico', loteDestinoId: null, pesoNeto: 0.5 }] });
    const r = construirFlujo(entrada(mov({ transformaciones: [t] })));
    expect(enlace(r, 'cat:nf', 'venta:nf')).toBe(0.5);
    expect(r.enlacesOmitidos).toEqual([]);
  });
});
