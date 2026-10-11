import { describe, it, expect } from 'vitest';
import {
  construirMovimientosAlmacen,
  type DatosMovimientosAlmacen,
} from '../src/utils/movimientos-almacen.js';
import { calcularDesgloseAlmacen } from '../src/services/inventario-almacen-desglose.js';
import {
  avisosSaldo,
  embalajesVigentesAl,
  filtrarMovimientosAl,
  primerRegistro,
  resolverCorte,
} from '../src/utils/saldo-fecha.js';
import type { MovimientosInventario, TransformacionMov } from '../src/utils/movimientos-pantalla.js';

const G1 = 'alm-g1';
const G2 = 'alm-g2';
const CHATARRA = 'prod-chatarra';
const COBRE = 'prod-cobre';
const LOTE = 'lote-1';

const vacio: DatosMovimientosAlmacen = { tickets: [], traslados: [], transformaciones: [], salidas: [], ajustes: [] };

const lineas = (almacenId: string, datos: Partial<DatosMovimientosAlmacen>, rango = {}) =>
  calcularDesgloseAlmacen(construirMovimientosAlmacen(almacenId, { ...vacio, ...datos }, rango));
const kgProducto = (ls: ReturnType<typeof lineas>, id: string) => ls.find(l => l.productoId === id && !l.loteId)?.stock ?? 0;
const kgLote = (ls: ReturnType<typeof lineas>, id: string) => ls.find(l => l.loteId === id)?.stock ?? 0;

const ticket = (tipo: 'compra' | 'venta', kg: number, fecha: string, extra = {}) => ({
  tipo,
  fecha,
  detalle_tickets_pesaje: [{ producto_id: CHATARRA, peso_neto: kg, destino_tipo: 'mpp', lote_id: null, ...extra }],
});

describe('resolverCorte', () => {
  it('una fecha anterior a hoy es un corte histórico', () => {
    expect(resolverCorte('2026-10-01', '2026-10-05')).toBe('2026-10-01');
  });
  it('hoy, el futuro o sin fecha significan stock actual (null)', () => {
    expect(resolverCorte('2026-10-05', '2026-10-05')).toBeNull();
    expect(resolverCorte('2026-12-31', '2026-10-05')).toBeNull();
    expect(resolverCorte(undefined, '2026-10-05')).toBeNull();
  });
});

describe('saldo al cierre de un día (movimientos hasta la fecha, inclusive)', () => {
  const datos: Partial<DatosMovimientosAlmacen> = {
    tickets: [ticket('compra', 1000, '2026-10-01'), ticket('venta', 300, '2026-10-03'), ticket('compra', 50, '2026-10-06')],
  };

  it('incluye el día de corte y excluye lo posterior', () => {
    expect(kgProducto(lineas(G1, datos, { hasta: '2026-10-01' }), CHATARRA)).toBe(1000);
    expect(kgProducto(lineas(G1, datos, { hasta: '2026-10-03' }), CHATARRA)).toBe(700);
    expect(kgProducto(lineas(G1, datos, { hasta: '2026-10-05' }), CHATARRA)).toBe(700);
  });

  it('antes del primer movimiento el saldo es 0', () => {
    expect(kgProducto(lineas(G1, datos, { hasta: '2026-09-30' }), CHATARRA)).toBe(0);
  });

  it('un ajuste de toma física de la noche cuenta en su día de negocio (Caracas), no en el día UTC', () => {
    // 2026-10-03T02:00Z = 2026-10-02 22:00 en Caracas (UTC-4)
    const ajustes = [{ producto_id: CHATARRA, lote_id: null, diferencia: 25, created_at: '2026-10-03T02:00:00.000Z' }];
    expect(kgProducto(lineas(G1, { ajustes }, { hasta: '2026-10-02' }), CHATARRA)).toBe(25);
    expect(kgProducto(lineas(G1, { ajustes }, { hasta: '2026-10-01' }), CHATARRA)).toBe(0);
  });

  it('traslado: la salida cuenta desde que se crea; la entrada solo desde que se completa', () => {
    const traslados = [{
      almacen_origen_id: G1, almacen_destino_id: G2, estado: 'completo',
      created_at: '2026-10-02T15:00:00.000Z', completado_en: '2026-10-05T15:00:00.000Z',
      detalle_traslado: [{ producto_id: CHATARRA, lote_id: null, peso_neto: 200, peso_recibido: 195 }],
    }];
    const tickets = [ticket('compra', 500, '2026-10-01')];
    // Al 03: ya salió del origen, todavía no llegó al destino (en tránsito).
    expect(kgProducto(lineas(G1, { tickets, traslados }, { hasta: '2026-10-03' }), CHATARRA)).toBe(300);
    expect(kgProducto(lineas(G2, { traslados }, { hasta: '2026-10-03' }), CHATARRA)).toBe(0);
    // Al 05 ya llegó, por lo recibido.
    expect(kgProducto(lineas(G2, { traslados }, { hasta: '2026-10-05' }), CHATARRA)).toBe(195);
  });

  it('transformación: el retiro cuenta en su fecha; la salida solo desde el día en que se completó', () => {
    const transformaciones = [{
      categoria: 'ferroso_no_ferroso', fecha: '2026-10-02', lote_origen_id: null, peso_neto: 100,
      transformacion_entrada_detalle: [{ producto_id: CHATARRA, peso_kg: 100 }],
    }];
    const salidas = [{
      producto_id: COBRE, lote_destino_id: null, peso_neto: 90,
      transformaciones: { estado: 'completa', fecha: '2026-10-02', completado_en: '2026-10-04T16:00:00.000Z' },
    }];
    const tickets = [ticket('compra', 100, '2026-10-01')];
    const al03 = lineas(G1, { tickets, transformaciones, salidas }, { hasta: '2026-10-03' });
    expect(kgProducto(al03, CHATARRA)).toBe(0);
    expect(kgProducto(al03, COBRE)).toBe(0); // el material estaba en proceso
    const al04 = lineas(G1, { tickets, transformaciones, salidas }, { hasta: '2026-10-04' });
    expect(kgProducto(al04, COBRE)).toBe(90);
  });

  it('sin completado_en la salida se fecha con la fecha de la transformación', () => {
    const salidas = [{
      producto_id: COBRE, lote_destino_id: null, peso_neto: 90,
      transformaciones: { estado: 'completa', fecha: '2026-10-02' },
    }];
    expect(kgProducto(lineas(G1, { salidas }, { hasta: '2026-10-02' }), COBRE)).toBe(90);
    expect(kgProducto(lineas(G1, { salidas }, { hasta: '2026-10-01' }), COBRE)).toBe(0);
  });
});

describe('consistencia: el saldo reconstruido cuadra con el stock actual', () => {
  const datos: Partial<DatosMovimientosAlmacen> = {
    tickets: [
      ticket('compra', 1000, '2026-10-01'),
      ticket('venta', 120, '2026-10-02'),
      ticket('compra', 400, '2026-10-03', { destino_tipo: 'lote', lote_id: LOTE }),
      ticket('venta', 80, '2026-10-06'),
    ],
    traslados: [{
      almacen_origen_id: G1, almacen_destino_id: G2, estado: 'completo',
      created_at: '2026-10-02T10:00:00.000Z', completado_en: '2026-10-04T10:00:00.000Z',
      detalle_traslado: [{ producto_id: CHATARRA, lote_id: null, peso_neto: 200, peso_recibido: 190 }],
    }],
    transformaciones: [{
      categoria: 'ferroso_no_ferroso', fecha: '2026-10-03', lote_origen_id: null, peso_neto: 300,
      transformacion_entrada_detalle: [{ producto_id: CHATARRA, peso_kg: 300 }],
    }],
    salidas: [{
      producto_id: COBRE, lote_destino_id: null, peso_neto: 280,
      transformaciones: { estado: 'completa', fecha: '2026-10-03', completado_en: '2026-10-05T12:00:00.000Z' },
    }],
    ajustes: [
      { producto_id: CHATARRA, lote_id: null, diferencia: -7, created_at: '2026-10-05T03:00:00.000Z' },
      { producto_id: null, lote_id: LOTE, diferencia: 11, created_at: '2026-10-07T20:00:00.000Z' },
    ],
  };
  const DIAS = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
  const claves = (ls: ReturnType<typeof lineas>) => ls.map(l => `${l.productoId ?? ''}|${l.loteId ?? ''}`);

  it('saldo al último día con movimientos = stock actual (sin rango), línea por línea', () => {
    const actual = lineas(G1, datos);
    const alFinal = lineas(G1, datos, { hasta: '2026-12-31' });
    expect(claves(alFinal).sort()).toEqual(claves(actual).sort());
    for (const l of actual) {
      const igual = alFinal.find(x => x.productoId === l.productoId && x.loteId === l.loteId);
      expect(igual?.stock).toBeCloseTo(l.stock, 6);
    }
  });

  it.each(DIAS)('saldo al %s + neto de lo posterior = stock actual', dia => {
    const siguiente = new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const actual = lineas(G1, datos);
    const hasta = lineas(G1, datos, { hasta: dia });
    const despues = lineas(G1, datos, { desde: siguiente });
    for (const l of actual) {
      const a = hasta.find(x => x.productoId === l.productoId && x.loteId === l.loteId)?.stock ?? 0;
      const b = despues.find(x => x.productoId === l.productoId && x.loteId === l.loteId)?.stock ?? 0;
      expect(a + b).toBeCloseTo(l.stock, 6);
    }
    expect(kgLote(hasta, LOTE) + kgLote(despues, LOTE)).toBeCloseTo(kgLote(actual, LOTE), 6);
  });
});

describe('embalajesVigentesAl', () => {
  const filas = [
    { loteId: 'L1', almacenId: null, pesoKg: 400, marcadoEn: '2026-10-02T15:00:00.000Z', anulado: false, anuladoEn: null },
    { loteId: 'L1', almacenId: null, pesoKg: 100, marcadoEn: '2026-10-04T15:00:00.000Z', anulado: true, anuladoEn: '2026-10-06T15:00:00.000Z' },
    { loteId: 'L2', almacenId: G1, pesoKg: 50, marcadoEn: '2026-10-08T15:00:00.000Z', anulado: false, anuladoEn: null },
  ];

  it('cuenta lo marcado hasta el corte y no anulado a esa fecha', () => {
    expect(embalajesVigentesAl(filas, '2026-10-01')).toEqual([]);
    expect(embalajesVigentesAl(filas, '2026-10-05').map(e => e.pesoKg)).toEqual([400, 100]); // el 100 se anuló el 06
    expect(embalajesVigentesAl(filas, '2026-10-06').map(e => e.pesoKg)).toEqual([400]);
    expect(embalajesVigentesAl(filas, '2026-10-09').map(e => e.pesoKg)).toEqual([400, 50]);
  });

  it('devuelve filas con la forma que usa el resumen y no muta la entrada', () => {
    const copia = JSON.parse(JSON.stringify(filas));
    const r = embalajesVigentesAl(filas, '2026-10-09');
    expect(r[0]).toEqual({ loteId: 'L1', almacenId: null, pesoKg: 400, anulado: false });
    expect(filas).toEqual(copia);
  });
});

describe('primerRegistro y filtrarMovimientosAl', () => {
  const transf = (over: Partial<TransformacionMov>): TransformacionMov => ({
    id: 't1', numero: 1, categoria: 'ferroso_no_ferroso', estado: 'completa', fecha: '2026-10-02', almacenId: G1,
    loteOrigenId: null, pesoNeto: 100, entradas: [], salidas: [], merma: [], ...over,
  });
  const mov: MovimientosInventario = {
    productos: [],
    tickets: [
      { tipo: 'compra', fecha: '2026-10-01', almacenId: G1, detalle: [] },
      { tipo: 'venta', fecha: '2026-10-05', almacenId: G1, detalle: [] },
    ],
    transformaciones: [transf({}), transf({ id: 't2', fecha: '2026-10-06' })],
    ajustes: [{ productoId: CHATARRA, loteId: null, almacenId: G1, diferencia: 5, fecha: '2026-09-16' }],
    embalajes: [],
  };

  it('primerRegistro es la fecha más antigua entre tickets, transformaciones y ajustes', () => {
    expect(primerRegistro(mov)).toBe('2026-09-16');
    expect(primerRegistro({ tickets: [], transformaciones: [], ajustes: [] })).toBeNull();
  });

  it('descarta lo posterior al corte', () => {
    const f = filtrarMovimientosAl(mov, '2026-10-03', new Map());
    expect(f.tickets).toHaveLength(1);
    expect(f.transformaciones.map(t => t.id)).toEqual(['t1']);
  });

  it('una transformación completada después del corte se considera todavía en proceso (bruto)', () => {
    const f = filtrarMovimientosAl(mov, '2026-10-03', new Map([['t1', '2026-10-04']]));
    expect(f.transformaciones[0].estado).toBe('bruto');
    const g = filtrarMovimientosAl(mov, '2026-10-04', new Map([['t1', '2026-10-04']]));
    expect(g.transformaciones[0].estado).toBe('completa');
  });

  it('no muta el original', () => {
    const copia = JSON.parse(JSON.stringify(mov));
    filtrarMovimientosAl(mov, '2026-10-03', new Map([['t1', '2026-10-04']]));
    expect(mov).toEqual(copia);
  });
});

describe('avisosSaldo', () => {
  const alm = (articulos: Array<{ nombre: string; stock: number }>) => ({
    almacenId: G1, nombre: 'G1',
    grupos: [{ tipoMaterialId: null, nombreCategoria: 'X', totalKg: 0, articulos: articulos.map(a => ({ productoId: 'p', destinoTipo: 'mpp' as const, loteId: null, ...a })) }],
  });
  const base = { corte: '2026-10-01', primerRegistro: '2026-09-16', almacenes: [alm([{ nombre: 'A', stock: 10 }])], completadoEnDisponible: true, valorSolicitado: false };

  it('sin problemas no hay avisos', () => {
    expect(avisosSaldo(base)).toEqual([]);
  });

  it('avisa si la fecha es anterior al primer registro del sistema', () => {
    const a = avisosSaldo({ ...base, corte: '2026-09-01' });
    expect(a.some(x => /2026-09-16|16\/09\/2026/.test(x) && /anterior|antes/i.test(x))).toBe(true);
  });

  it('avisa los saldos negativos con el nombre del material', () => {
    const a = avisosSaldo({ ...base, almacenes: [alm([{ nombre: 'COBRE', stock: -30 }, { nombre: 'OK', stock: 5 }])] });
    expect(a.some(x => x.includes('COBRE') && /negativ/i.test(x))).toBe(true);
    expect(a.some(x => x.includes('OK'))).toBe(false);
  });

  it('avisa que los costos se ocultan cuando se había pedido valor', () => {
    expect(avisosSaldo({ ...base, valorSolicitado: true }).some(x => /costo|valor/i.test(x))).toBe(true);
  });

  it('avisa si no se pudo leer la fecha de finalización de las transformaciones', () => {
    expect(avisosSaldo({ ...base, completadoEnDisponible: false }).some(x => /transformaci/i.test(x))).toBe(true);
  });
});
