import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});

const {
  calcularSaldos, obtenerSaldos, invalidarCacheSaldos, cargarDatosSaldos, TTL_CACHE_SALDOS_MS,
} = await import('../src/services/saldos-service.js');
const { construirEstadoCuenta, agruparPagos } = await import('../src/services/estado-cuenta-service.js');

const AHORA = new Date('2026-10-04T12:00:00Z');
const dias = (n: number) => new Date(AHORA.getTime() - n * 86_400_000).toISOString();

const entidades = [
  { id: 'p1', nombre: 'Alfa', activo: true },
  { id: 'p2', nombre: 'Beta', activo: false },
  { id: 'p3', nombre: 'Sin movimientos', activo: true },
];

function datosBase() {
  return {
    facturas: [
      { entidadId: 'p1', id: 'f1', total: 100, montoPagado: 0, estado: 'emitida', fecha: dias(30) },
      { entidadId: 'p1', id: 'f2', total: 50, montoPagado: 20, estado: 'emitida', fecha: dias(5) },
      { entidadId: 'p1', id: 'f3', total: 80, montoPagado: 80, estado: 'pagada', fecha: dias(60) },
      { entidadId: 'p2', id: 'f4', total: 10, montoPagado: 0, estado: 'emitida', fecha: dias(2) },
    ],
    pagos: [
      { entidadId: 'p1', id: 'm1', monto: 60, montoUsd: null, fecha: dias(10), subtipo: 'pago' as const, grupoId: 'g1' },
      // pago repartido en dos bancas (misma operación) + una en Bs con equivalente USD
      { entidadId: 'p1', id: 'm2', monto: 1000, montoUsd: 25, fecha: dias(10), subtipo: 'pago' as const, grupoId: 'g1' },
      { entidadId: 'p1', id: 'm3', monto: 40, montoUsd: null, fecha: dias(8), subtipo: 'adelanto' as const, grupoId: 'g2' },
      { entidadId: 'p2', id: 'm4', monto: 30, montoUsd: null, fecha: dias(1), subtipo: 'adelanto' as const, grupoId: null },
    ],
    notas: [
      { entidadId: 'p1', id: 'n1', tipo: 'credito' as const, monto: 15, anulada: false, pagada: false, fecha: dias(7) },
      { entidadId: 'p1', id: 'n2', tipo: 'credito' as const, monto: 99, anulada: true, pagada: false, fecha: dias(3) },
      { entidadId: 'p1', id: 'n3', tipo: 'debito' as const, monto: 12, anulada: false, pagada: false, fecha: dias(4) },
      { entidadId: 'p1', id: 'n4', tipo: 'credito' as const, monto: 5, anulada: false, pagada: true, fecha: dias(20) },
    ],
    aplicadoPorAdelanto: new Map<string, number>([['g2', 10]]),
  };
}

describe('calcularSaldos (puro)', () => {
  it('devuelve una fila por entidad, incluidas las que no tienen movimientos', () => {
    const r = calcularSaldos('proveedor', entidades, datosBase(), AHORA);
    expect(r.saldos.map(s => s.entidadId)).toEqual(['p1', 'p2', 'p3']);
    const vacio = r.saldos[2];
    expect(vacio).toMatchObject({
      facturado: 0, pagado: 0, saldo: 0, adelantoDisponible: 0, notasCreditoDisponibles: 0,
      ultimaOperacion: null, cantidadFacturasPendientes: 0, antiguedadMasVieja: null,
    });
  });

  it('el saldo coincide con totales.saldo del estado de cuenta (misma fuente)', () => {
    const d = datosBase();
    const r = calcularSaldos('proveedor', entidades, d, AHORA);
    const p1 = r.saldos[0];
    const ec = construirEstadoCuenta(
      { id: 'p1', tipo: 'proveedor', nombre: 'Alfa' },
      d.facturas.filter(f => f.entidadId === 'p1').map(f => ({ id: f.id, total: f.total, descripcion: null, fecha: f.fecha })),
      agruparPagos(d.pagos.filter(p => p.entidadId === 'p1').map(p => ({
        id: p.id, monto: p.montoUsd ?? p.monto, descripcion: null, referencia: null, fecha: p.fecha, subtipo: p.subtipo, grupoId: p.grupoId,
      }))),
      d.notas.filter(n => n.entidadId === 'p1').map(n => ({ id: n.id, tipo: n.tipo, monto: n.monto, motivo: '', anulada: n.anulada, pagada: n.pagada, fecha: n.fecha })),
      { cruces: [], adelantoAplicadoPorId: d.aplicadoPorAdelanto }
    );
    expect(p1.saldo).toBeCloseTo(ec.totales.saldo, 2);
    expect(p1.facturado).toBeCloseTo(ec.totales.facturado, 2);
    expect(p1.pagado).toBeCloseTo(ec.totales.pagado, 2);
    // 100+50+80 facturas + 12 debito = 242; pagos 60+25 + adelanto 40 + notas credito vigentes 15+5 = 145
    expect(p1.facturado).toBe(242);
    expect(p1.pagado).toBe(145);
    expect(p1.saldo).toBe(97);
  });

  it('usa monto_usd cuando existe y agrupa filas de una misma operacion', () => {
    const r = calcularSaldos('proveedor', entidades, datosBase(), AHORA);
    // 60 + 25 (no 1000) + 40 adelanto
    expect(r.saldos[0].pagado - 15 - 5).toBe(125);
  });

  it('notas anuladas no cuentan; notas de credito disponibles = vigentes sin aplicar', () => {
    const p1 = calcularSaldos('proveedor', entidades, datosBase(), AHORA).saldos[0];
    expect(p1.notasCreditoDisponibles).toBe(15);
  });

  it('adelanto disponible = adelanto menos lo aplicado a facturas', () => {
    const r = calcularSaldos('proveedor', entidades, datosBase(), AHORA);
    expect(r.saldos[0].adelantoDisponible).toBe(30);
    expect(r.saldos[1].adelantoDisponible).toBe(30);
  });

  it('facturas pendientes y antiguedad de la mas vieja pendiente (las pagadas no cuentan)', () => {
    const p1 = calcularSaldos('proveedor', entidades, datosBase(), AHORA).saldos[0];
    expect(p1.cantidadFacturasPendientes).toBe(2);
    expect(p1.antiguedadMasVieja).toBe(30);
  });

  it('ultimaOperacion = fecha mas reciente entre facturas, pagos y notas vigentes (ignora anuladas)', () => {
    const p1 = calcularSaldos('proveedor', entidades, datosBase(), AHORA).saldos[0];
    // la nota de debito de hace 4 dias es lo mas reciente; la nota anulada de hace 3 dias no cuenta
    expect(p1.ultimaOperacion).toBe(dias(4).slice(0, 10));
  });

  it('saldo negativo (a favor) y totales: porPagar suma solo positivos, aFavor los negativos', () => {
    const r = calcularSaldos('proveedor', entidades, datosBase(), AHORA);
    expect(r.saldos[1].saldo).toBe(-20);
    expect(r.totales).toMatchObject({ facturado: 252, pagado: 175, saldo: 77, porPagar: 97, aFavor: 20 });
    expect(r.totales.porCobrar).toBeUndefined();
  });

  it('clientes: usa porCobrar y no porPagar', () => {
    const r = calcularSaldos('cliente', [{ id: 'p1', nombre: 'C', activo: true }], datosBase(), AHORA);
    expect(r.totales.porCobrar).toBe(97);
    expect(r.totales.porPagar).toBeUndefined();
  });

  it('ignora movimientos de entidades desconocidas', () => {
    const d = datosBase();
    d.pagos.push({ entidadId: 'zzz', id: 'mx', monto: 999, montoUsd: null, fecha: dias(1), subtipo: 'pago', grupoId: null });
    const r = calcularSaldos('proveedor', entidades, d, AHORA);
    expect(r.saldos).toHaveLength(3);
    expect(r.totales.pagado).toBe(175);
  });

  it('calculadoEn es la fecha de calculo', () => {
    expect(calcularSaldos('proveedor', entidades, datosBase(), AHORA).calculadoEn).toBe(AHORA.toISOString());
  });
});

describe('cargarDatosSaldos / obtenerSaldos (con BD falsa)', () => {
  beforeEach(() => {
    bdFalsa.reiniciar();
    invalidarCacheSaldos();
    bdFalsa.tablas.proveedores = [{ id: 'p1', nombre: 'Alfa', activo: true }, { id: 'p2', nombre: 'Beta', activo: true }];
    bdFalsa.tablas.facturas_compra = [
      { id: 'f1', proveedor_id: 'p1', total: 100, monto_pagado: 0, estado: 'emitida', created_at: '2026-09-01T10:00:00Z' },
      { id: 'f2', proveedor_id: 'p1', total: 50, monto_pagado: 0, estado: 'anulada', created_at: '2026-09-02T10:00:00Z' },
    ];
    bdFalsa.tablas.movimientos = [
      { id: 'm1', proveedor_id: 'p1', cliente_id: null, tipo: 'egreso', monto: 30, monto_usd: null, fecha: '2026-09-10', subtipo: 'pago', grupo_id: null, anulado: false },
      { id: 'm2', proveedor_id: null, cliente_id: 'c1', tipo: 'ingreso', monto: 500, monto_usd: null, fecha: '2026-09-10', subtipo: 'cobro', grupo_id: null, anulado: false },
      { id: 'm3', proveedor_id: null, cliente_id: null, tipo: 'egreso', monto: 7, monto_usd: null, fecha: '2026-09-10', subtipo: null, grupo_id: null, anulado: false },
    ];
    bdFalsa.tablas.notas_ajuste_proveedor = [
      { id: 'n1', proveedor_id: 'p1', tipo: 'credito', monto: 10, anulada: false, pagada: false, fecha: '2026-09-11' },
    ];
    bdFalsa.tablas.pago_aplicaciones = [];
  });

  it('lee todo una vez por tabla y calcula (factura anulada y movimientos sin entidad quedan fuera)', async () => {
    const r = await obtenerSaldos('proveedor', { ahora: AHORA });
    expect(r.saldos.find(s => s.entidadId === 'p1')).toMatchObject({ facturado: 100, pagado: 40, saldo: 60, cantidadFacturasPendientes: 1 });
    expect(r.saldos.find(s => s.entidadId === 'p2')?.saldo).toBe(0);
  });

  it('cargarDatosSaldos pagina cuando una tabla supera 1000 filas', async () => {
    bdFalsa.tablas.movimientos = Array.from({ length: 2300 }, (_, i) => ({
      id: `m${i}`, proveedor_id: 'p1', cliente_id: null, tipo: 'egreso', monto: 1, monto_usd: null, fecha: '2026-09-10', subtipo: 'pago', grupo_id: null, anulado: false,
    }));
    const d = await cargarDatosSaldos('proveedor');
    expect(d.pagos).toHaveLength(2300);
  });

  it('si una lectura falla, lanza (no hay saldos parciales) y no cachea el fallo', async () => {
    bdFalsa.errores.movimientos = { message: 'boom' };
    await expect(obtenerSaldos('proveedor', { ahora: AHORA })).rejects.toThrow();
    delete bdFalsa.errores.movimientos;
    const r = await obtenerSaldos('proveedor', { ahora: AHORA });
    expect(r.saldos).toHaveLength(2);
  });

  it('si supera el presupuesto de tiempo, lanza un error de tiempo', async () => {
    const original = bdFalsa.cliente.from;
    bdFalsa.cliente.from = (t: string) => {
      const b = original.call(bdFalsa.cliente, t) as { then: (...a: unknown[]) => unknown };
      if (t === 'proveedores') b.then = () => new Promise(() => {});
      return b;
    };
    try {
      await expect(obtenerSaldos('proveedor', { ahora: AHORA, presupuestoMs: 20 })).rejects.toThrow(/tiempo/i);
    } finally {
      bdFalsa.cliente.from = original;
    }
  });

  it('usa caché dentro del TTL y la invalidacion fuerza recalcular', async () => {
    expect(TTL_CACHE_SALDOS_MS).toBe(20_000);
    const a = await obtenerSaldos('proveedor');
    bdFalsa.tablas.movimientos.push({ id: 'm9', proveedor_id: 'p1', cliente_id: null, tipo: 'egreso', monto: 5, monto_usd: null, fecha: '2026-09-12', subtipo: 'pago', grupo_id: null, anulado: false });
    const b = await obtenerSaldos('proveedor');
    expect(b).toBe(a);
    invalidarCacheSaldos();
    const c = await obtenerSaldos('proveedor');
    expect(c.saldos.find(s => s.entidadId === 'p1')?.saldo).toBe(55);
  });

  it('las cachés de proveedor y cliente son independientes', async () => {
    bdFalsa.tablas.clientes = [{ id: 'c1', nombre: 'Cli', activo: true }];
    bdFalsa.tablas.facturas_venta = [];
    bdFalsa.tablas.notas_ajuste_cliente = [];
    const p = await obtenerSaldos('proveedor');
    const c = await obtenerSaldos('cliente');
    expect(p.tipo).toBe('proveedor');
    expect(c.tipo).toBe('cliente');
    expect(c.saldos[0]).toMatchObject({ entidadId: 'c1', pagado: 500, saldo: -500 });
  });
});
