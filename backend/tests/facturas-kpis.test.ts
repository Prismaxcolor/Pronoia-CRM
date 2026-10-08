import { describe, it, expect } from 'vitest';
import {
  antiguedadSaldos, compararTotalFacturado, diasEntre, haySuficientesSemanas, inicioDeSemana, partesPorEstado,
  periodoAnterior, periodoEfectivo, porcentajePagado, resumirFacturas, saldoCompra, severidadAntiguedad,
  textoDesglosePorEstado, topEntidades, totalesPorSemana,
} from '../../frontend/src/lib/facturas-kpis';
import type { FacturaCV } from '../../frontend/src/services/factura-cv-service';

let n = 0;
function fac(p: Partial<FacturaCV> & { peso?: number }): FacturaCV {
  n += 1;
  return {
    id: `f${n}`, numero: n, codigo: `C-${String(n).padStart(4, '0')}`, tipo: 'compra', entidadId: 'e1', nombreEntidad: 'Prov A',
    ticketIds: [], items: [{ id: `i${n}`, productoId: 'p1', nombreProducto: 'Cartón', peso: p.peso ?? 100, precioUnitario: 1, subtotal: p.total ?? 100, descuentoKg: 0 }],
    total: 100, montoPagado: 0, descripcion: null, observaciones: null, estado: 'emitida', createdAt: '2026-09-14T10:00:00Z', ...p,
  };
}

describe('resumirFacturas', () => {
  it('excluye anuladas y borradores del total facturado y calcula pagado/pendiente en compras', () => {
    const lista = [
      fac({ estado: 'pagada', total: 200, montoPagado: 200, peso: 50 }),
      fac({ estado: 'emitida', total: 300, montoPagado: 100, peso: 70 }),
      fac({ estado: 'anulada', total: 999, peso: 999 }),
      fac({ estado: 'borrador', total: 50, peso: 5 }),
    ];
    const r = resumirFacturas(lista, 'compra');
    expect(r.cantidad).toBe(4);
    expect(r.facturadas).toBe(2);
    expect(r.total).toBe(500);
    expect(r.kg).toBe(120);
    expect(r.pagado).toBe(300);
    expect(r.pendiente).toBe(200);
    expect(textoDesglosePorEstado(r)).toBe('1 pagada, 1 emitida, 1 borrador, 1 anulada');
  });

  it('en ventas no inventa cobrado ni pendiente', () => {
    const r = resumirFacturas([fac({ tipo: 'venta', total: 13098 / 2 }), fac({ tipo: 'venta', total: 13098 / 2 })], 'venta');
    expect(r.total).toBe(13098);
    expect(r.totalEmitidas).toBe(13098);
    expect(r.pagado).toBe(0);
    expect(r.pendiente).toBe(0);
  });

  it('saldoCompra solo existe en emitidas y nunca es negativo', () => {
    expect(saldoCompra({ estado: 'pagada', total: 10, montoPagado: 10 })).toBe(0);
    expect(saldoCompra({ estado: 'anulada', total: 10, montoPagado: 0 })).toBe(0);
    expect(saldoCompra({ estado: 'emitida', total: 10, montoPagado: 15 })).toBe(0);
    expect(saldoCompra({ estado: 'emitida', total: 10, montoPagado: 4 })).toBe(6);
  });
});

describe('periodos y comparación', () => {
  it('usa 30 días por defecto, todo el historial al buscar por código y respeta el rango de la URL', () => {
    expect(periodoEfectivo(undefined, undefined, false, '2026-10-04')).toEqual({ desde: '2026-09-05', hasta: '2026-10-04', origen: 'defecto' });
    expect(periodoEfectivo(undefined, undefined, true, '2026-10-04')).toEqual({ origen: 'todo' });
    expect(periodoEfectivo('2026-09-01', '2026-09-10', true, '2026-10-04')).toEqual({ desde: '2026-09-01', hasta: '2026-09-10', origen: 'url' });
    expect(periodoEfectivo('2026-09-10', '2026-09-01', false, '2026-10-04').origen).toBe('defecto');
  });

  it('el periodo anterior tiene la misma duración y termina el día previo', () => {
    expect(periodoAnterior('2026-09-05', '2026-10-04')).toEqual({ desde: '2026-08-06', hasta: '2026-09-04' });
    expect(periodoAnterior('2026-09-10', '2026-09-10')).toEqual({ desde: '2026-09-09', hasta: '2026-09-09' });
    expect(periodoAnterior(undefined, '2026-09-10')).toBeNull();
    expect(periodoAnterior('2026-09-10', '2026-09-01')).toBeNull();
  });

  it('sin facturas en el periodo anterior no hay comparación (no inventa +100 %)', () => {
    const actual = resumirFacturas([fac({ total: 500 })], 'compra');
    expect(compararTotalFacturado(actual, resumirFacturas([], 'compra'), 'compra')).toBeNull();
    expect(compararTotalFacturado(actual, null, 'compra')).toBeNull();
  });

  it('compara contra el periodo anterior; en compras el tono es neutro y en ventas subir es bueno', () => {
    const actual = resumirFacturas([fac({ total: 500 })], 'venta');
    const ant = resumirFacturas([fac({ total: 400 })], 'venta');
    expect(compararTotalFacturado(actual, ant, 'venta')?.tono).toBe('bueno');
    expect(compararTotalFacturado(actual, ant, 'compra')?.tono).toBe('neutro');
    expect(compararTotalFacturado(actual, ant, 'venta')?.deltaPct).toBe(25);
  });
});

describe('gráficas', () => {
  it('agrupa por semana (lunes) y rellena semanas vacías', () => {
    expect(inicioDeSemana('2026-09-14')).toBe('2026-09-14'); // lunes
    expect(inicioDeSemana('2026-09-20')).toBe('2026-09-14'); // domingo
    expect(inicioDeSemana('2026-09-21')).toBe('2026-09-21');
    const semanas = totalesPorSemana([
      fac({ total: 100, createdAt: '2026-09-15T10:00:00Z' }),
      fac({ total: 50, createdAt: '2026-09-16T10:00:00Z' }),
      fac({ total: 70, createdAt: '2026-10-01T10:00:00Z' }),
      fac({ total: 999, estado: 'anulada', createdAt: '2026-10-20T10:00:00Z' }),
    ]);
    expect(semanas.map(s => [s.inicio, s.total, s.cantidad])).toEqual([
      ['2026-09-14', 150, 2], ['2026-09-21', 0, 0], ['2026-09-28', 70, 1],
    ]);
    expect(haySuficientesSemanas(semanas)).toBe(true);
    expect(haySuficientesSemanas(semanas.slice(0, 2))).toBe(false);
    expect(totalesPorSemana([])).toEqual([]);
  });

  it('ranking de entidades por monto y partes por estado', () => {
    const lista = [
      fac({ entidadId: 'a', nombreEntidad: 'Ana', total: 100 }),
      fac({ entidadId: 'b', nombreEntidad: 'Beto', total: 300 }),
      fac({ entidadId: 'a', nombreEntidad: 'Ana', total: 250, estado: 'pagada' }),
      fac({ entidadId: 'c', nombreEntidad: 'Cris', total: 5000, estado: 'anulada' }),
    ];
    expect(topEntidades(lista).map(e => [e.nombre, e.total, e.cantidad])).toEqual([['Ana', 350, 2], ['Beto', 300, 1]]);
    expect(partesPorEstado(lista)).toEqual([
      { estado: 'emitida', cantidad: 2 }, { estado: 'pagada', cantidad: 1 }, { estado: 'anulada', cantidad: 1 },
    ]);
  });
});

describe('antigüedad de facturas emitidas con saldo', () => {
  const hoy = '2026-10-04';

  it('mide desde la emisión, ordena por antigüedad y reparte en tramos', () => {
    const lista = [
      fac({ estado: 'emitida', total: 100, montoPagado: 40, createdAt: '2026-09-14T08:00:00Z' }), // 20 días, saldo 60
      fac({ estado: 'emitida', total: 200, createdAt: '2026-10-01T08:00:00Z' }), // 3 días
      fac({ estado: 'pagada', total: 500, montoPagado: 500, createdAt: '2026-08-01T08:00:00Z' }),
      fac({ estado: 'emitida', total: 80, montoPagado: 80, createdAt: '2026-08-01T08:00:00Z' }), // sin saldo
    ];
    const a = antiguedadSaldos(lista, 'compra', hoy);
    expect(a.facturas.map(f => [f.dias, f.saldo])).toEqual([[20, 60], [3, 200]]);
    expect(a.totalSaldo).toBe(260);
    expect(a.diasMasAntigua).toBe(20);
    expect(a.tramos.map(t => t.cantidad)).toEqual([1, 0, 1, 0]);
    expect(a.tramos[2].monto).toBe(60);
  });

  it('en ventas el saldo es el total emitido (sin registro de cobros) y la severidad es solo informativa', () => {
    const a = antiguedadSaldos([fac({ tipo: 'venta', total: 9000, createdAt: '2026-08-01T08:00:00Z' })], 'venta', hoy);
    expect(a.totalSaldo).toBe(9000);
    expect(severidadAntiguedad('venta', a.diasMasAntigua)).toBe('info');
  });

  it('severidad en compras: info hasta 15 días, amarilla hasta 30, roja después', () => {
    expect(severidadAntiguedad('compra', 15)).toBe('info');
    expect(severidadAntiguedad('compra', 16)).toBe('amarilla');
    expect(severidadAntiguedad('compra', 30)).toBe('amarilla');
    expect(severidadAntiguedad('compra', 31)).toBe('roja');
  });

  it('diasEntre nunca es negativo y porcentajePagado se acota', () => {
    expect(diasEntre('2026-10-04', '2026-09-01')).toBe(0);
    expect(diasEntre('2026-09-14', '2026-10-04')).toBe(20);
    expect(porcentajePagado(0, 10)).toBe(0);
    expect(porcentajePagado(200, 50)).toBe(25);
    expect(porcentajePagado(100, 500)).toBe(100);
  });
});

describe('porcentajeEntero', () => {
  it('no muestra 100 mientras quede saldo', async () => {
    const { porcentajeEntero } = await import('../../frontend/src/lib/facturas-kpis');
    expect(porcentajeEntero(99.97)).toBe(99);
    expect(porcentajeEntero(100)).toBe(100);
    expect(porcentajeEntero(0)).toBe(0);
    expect(porcentajeEntero(Number.NaN)).toBe(0);
  });
});
