import { describe, it, expect } from 'vitest';
import * as back from '../src/utils/nomina-calculo';
import * as front from '../../shared/types/nomina-calculo';

const base = {
  diasTrabajados: 5, montoBaseUsd: 20, bonificacionUsd: 0, descuentoTrabajoUsd: 0, descuentoPrestamoUsd: 0, monedaPago: 'USD' as const,
};

describe('calcularLinea', () => {
  it('bruto = días x monto base; ref Bs = bruto x tasa', () => {
    const l = back.calcularLinea(base, 40);
    expect(l.totalBrutoUsd).toBe(100);
    expect(l.montoRefBs).toBe(4000);
    expect(l.totalUsd).toBe(100);
    expect(l.totalBs).toBe(4000);
    expect(l.negativo).toBe(false);
  });

  it('total = bruto + bonificación - descuentos (trabajo + préstamo)', () => {
    const l = back.calcularLinea({ ...base, bonificacionUsd: 15, descuentoTrabajoUsd: 5, descuentoPrestamoUsd: 10 }, 40);
    expect(l.descuentosUsd).toBe(15);
    expect(l.totalUsd).toBe(100);
    expect(l.montoRefBs).toBe(4000); // la referencia es solo del bruto
    expect(l.totalBs).toBe(4000);
  });

  it('sin tasa: los montos en Bs son null, no 0', () => {
    const l = back.calcularLinea(base, null);
    expect(l.montoRefBs).toBeNull();
    expect(l.totalBs).toBeNull();
    expect(l.totalUsd).toBe(100);
  });

  it('medios días y sin error de coma flotante', () => {
    const l = back.calcularLinea({ ...base, diasTrabajados: 4.5, montoBaseUsd: 17.3 }, null);
    expect(l.totalBrutoUsd).toBe(77.85);
    const m = back.calcularLinea({ ...base, diasTrabajados: 3, montoBaseUsd: 0.1, bonificacionUsd: 0.2, descuentoTrabajoUsd: 0.5 }, null);
    expect(m.totalUsd).toBe(0);
  });

  it('redondea el Bs al centavo', () => {
    const l = back.calcularLinea({ ...base, diasTrabajados: 1, montoBaseUsd: 10.01 }, 36.4567);
    expect(l.totalBs).toBe(364.93);
  });

  it('total negativo se marca', () => {
    const l = back.calcularLinea({ ...base, diasTrabajados: 1, descuentoPrestamoUsd: 50 }, null);
    expect(l.totalUsd).toBe(-30);
    expect(l.negativo).toBe(true);
  });

  it('cero días: bruto 0', () => {
    expect(back.calcularLinea({ ...base, diasTrabajados: 0 }, 40).totalUsd).toBe(0);
  });

  it('no muta la entrada', () => {
    const e = { ...base };
    const copia = JSON.stringify(e);
    back.calcularLinea(e, 40);
    expect(JSON.stringify(e)).toBe(copia);
  });
});

const linea = (monedaPago: 'USD' | 'BS', totalUsd: number, tasa: number | null) =>
  ({ monedaPago, ...back.calcularLinea({ ...base, diasTrabajados: 1, montoBaseUsd: totalUsd, monedaPago }, tasa) });

describe('calcularTotales', () => {
  it('vacío: todo en cero', () => {
    const t = back.calcularTotales([], 40);
    expect(t).toMatchObject({ cantidad: 0, totalDivisasUsd: 0, totalBs: 0, equivalenteUsdDeBs: 0, totalCombinadoUsd: 0, totalCombinadoBs: 0 });
  });

  it('separa divisas y bolívares y combina', () => {
    const t = back.calcularTotales([linea('USD', 100, 40), linea('USD', 50, 40), linea('BS', 30, 40)], 40);
    expect(t.cantidadDivisas).toBe(2);
    expect(t.cantidadBs).toBe(1);
    expect(t.totalDivisasUsd).toBe(150);
    expect(t.totalBs).toBe(1200);
    expect(t.equivalenteUsdDeBs).toBe(30);
    expect(t.totalCombinadoUsd).toBe(180);
    expect(t.totalCombinadoBs).toBe(7200); // 1200 + 150 x 40
  });

  it('sin tasa y con renglones en Bs: el total en Bs es null; sin renglones en Bs sigue calculable', () => {
    const conBs = back.calcularTotales([linea('USD', 10, null), linea('BS', 10, null)], null);
    expect(conBs.totalBs).toBeNull();
    expect(conBs.totalCombinadoBs).toBeNull();
    expect(conBs.totalCombinadoUsd).toBe(20);
    const soloUsd = back.calcularTotales([linea('USD', 10, null)], null);
    expect(soloUsd.totalBs).toBe(0);
    expect(soloUsd.totalCombinadoBs).toBeNull();
  });

  it('el equivalente en USD no arrastra redondeo del Bs', () => {
    const t = back.calcularTotales([linea('BS', 10.01, 36.4567), linea('BS', 20.02, 36.4567)], 36.4567);
    expect(t.equivalenteUsdDeBs).toBe(30.03);
  });
});

describe('sumarTotales (general de la semana)', () => {
  it('suma administrativo + operativo', () => {
    const a = back.calcularTotales([linea('USD', 100, 40)], 40);
    const o = back.calcularTotales([linea('BS', 50, 42)], 42);
    const g = back.sumarTotales([a, o]);
    expect(g.cantidad).toBe(2);
    expect(g.totalDivisasUsd).toBe(100);
    expect(g.totalBs).toBe(2100);
    expect(g.equivalenteUsdDeBs).toBe(50);
    expect(g.totalCombinadoUsd).toBe(150);
    expect(g.totalCombinadoBs).toBe(4000 + 2100);
  });

  it('si alguna parte no tiene Bs calculables, el combinado en Bs es null', () => {
    const a = back.calcularTotales([linea('USD', 100, null)], null);
    const o = back.calcularTotales([linea('USD', 10, 40)], 40);
    expect(back.sumarTotales([a, o]).totalCombinadoBs).toBeNull();
  });
});

describe('semanas', () => {
  it('esLunes', () => {
    expect(back.esLunes('2026-10-05')).toBe(true);
    expect(back.esLunes('2026-10-06')).toBe(false);
    expect(back.esLunes('2026-13-40')).toBe(false);
    expect(back.esLunes('basura')).toBe(false);
  });
  it('lunesDe: cualquier día cae en el lunes de su semana', () => {
    expect(back.lunesDe('2026-10-05')).toBe('2026-10-05');
    expect(back.lunesDe('2026-10-11')).toBe('2026-10-05'); // domingo
    expect(back.lunesDe('2026-10-12')).toBe('2026-10-12');
    expect(back.lunesDe('2026-01-01')).toBe('2025-12-29'); // cruce de año
  });
  it('domingoDe', () => expect(back.domingoDe('2026-10-05')).toBe('2026-10-11'));
});

describe('préstamos', () => {
  it('cuota sugerida: la cuota semanal limitada al saldo; sin cuota => 0', () => {
    expect(back.cuotaSugerida({ saldoUsd: 100, cuotaSemanalUsd: 20 })).toBe(20);
    expect(back.cuotaSugerida({ saldoUsd: 12.5, cuotaSemanalUsd: 20 })).toBe(12.5);
    expect(back.cuotaSugerida({ saldoUsd: 100, cuotaSemanalUsd: null })).toBe(0);
  });

  it('validarCuotas acepta cuotas dentro del saldo', () => {
    const r = back.validarCuotas(
      [{ trabajadorId: 't1', cuotas: [{ prestamoId: 'p1', montoUsd: 10 }] }],
      [{ id: 'p1', trabajadorId: 't1', saldoUsd: 10, estado: 'ACTIVO' }],
    );
    expect(r).toBeNull();
  });

  it('validarCuotas rechaza: saldo insuficiente, préstamo ajeno, inactivo o inexistente', () => {
    const p = { id: 'p1', trabajadorId: 't1', saldoUsd: 10, estado: 'ACTIVO' };
    const una = (trabajadorId: string, montoUsd: number) => [{ trabajadorId, cuotas: [{ prestamoId: 'p1', montoUsd }] }];
    expect(back.validarCuotas(una('t1', 10.01), [p])).toMatch(/saldo/i);
    expect(back.validarCuotas(una('t2', 5), [p])).toMatch(/no es de este trabajador/i);
    expect(back.validarCuotas(una('t1', 5), [{ ...p, estado: 'PAGADO' }])).toMatch(/activo/i);
    expect(back.validarCuotas(una('t1', 5), [])).toMatch(/no existe/i);
  });

  it('sumarCuotas en centavos exactos', () => {
    expect(back.sumarCuotas([{ montoUsd: 0.1 }, { montoUsd: 0.2 }])).toBe(0.3);
  });
});

describe('lineasNegativas', () => {
  it('devuelve los índices con total negativo', () => {
    const l = [back.calcularLinea(base, null), back.calcularLinea({ ...base, descuentoTrabajoUsd: 500 }, null)];
    expect(back.lineasNegativas(l)).toEqual([1]);
  });
});

// El frontend usa una copia espejo (el alias @shared no resuelve en runtime del backend): ambas deben dar lo mismo.
describe('paridad backend / shared', () => {
  const casos = [
    { ...base },
    { ...base, diasTrabajados: 4.5, montoBaseUsd: 17.3, bonificacionUsd: 3.15, descuentoTrabajoUsd: 1.1, descuentoPrestamoUsd: 2.2 },
    { ...base, diasTrabajados: 1, montoBaseUsd: 10.01, monedaPago: 'BS' as const },
    { ...base, diasTrabajados: 0.25, descuentoPrestamoUsd: 99 },
  ];
  it.each([null, 36.4567, 1])('calcularLinea y calcularTotales con tasa %s', tasa => {
    const b = casos.map(c => ({ monedaPago: c.monedaPago, ...back.calcularLinea(c, tasa) }));
    const f = casos.map(c => ({ monedaPago: c.monedaPago, ...front.calcularLinea(c, tasa) }));
    expect(f).toEqual(b);
    expect(front.calcularTotales(f, tasa)).toEqual(back.calcularTotales(b, tasa));
    expect(front.sumarTotales([front.calcularTotales(f, tasa)])).toEqual(back.sumarTotales([back.calcularTotales(b, tasa)]));
  });
  it('semanas, cuotas y negativos', () => {
    for (const d of ['2026-10-05', '2026-10-11', '2026-01-01', 'x']) {
      expect(front.esLunes(d)).toBe(back.esLunes(d));
    }
    expect(front.lunesDe('2026-01-01')).toBe(back.lunesDe('2026-01-01'));
    expect(front.domingoDe('2026-10-05')).toBe(back.domingoDe('2026-10-05'));
    expect(front.cuotaSugerida({ saldoUsd: 12.5, cuotaSemanalUsd: 20 })).toBe(back.cuotaSugerida({ saldoUsd: 12.5, cuotaSemanalUsd: 20 }));
    expect(front.sumarCuotas([{ montoUsd: 0.1 }, { montoUsd: 0.2 }])).toBe(0.3);
  });
});

describe('préstamo frente a lo ganado', () => {
  const e = { ...base, diasTrabajados: 1, montoBaseUsd: 20, bonificacionUsd: 5 };
  it.each([['backend', back], ['shared', front]] as const)('%s: ganado = bruto + bonificación; el tope es inclusivo', (_n, m) => {
    expect(m.gananciaDeLinea(e)).toBe(25);
    expect(m.prestamoExcedeGanado({ ...e, descuentoPrestamoUsd: 25 })).toBe(false);
    expect(m.prestamoExcedeGanado({ ...e, descuentoPrestamoUsd: 25.01 })).toBe(true);
    expect(m.calcularLinea({ ...e, descuentoPrestamoUsd: 30 }, null).prestamoExcedeGanado).toBe(true);
    expect(m.calcularLinea({ ...e, descuentoPrestamoUsd: 10 }, null).prestamoExcedeGanado).toBe(false);
  });
  it('el descuento por trabajo no cuenta para este tope (eso lo cubre el aviso de total negativo)', () => {
    expect(back.prestamoExcedeGanado({ ...e, descuentoPrestamoUsd: 25 })).toBe(false);
    expect(back.calcularLinea({ ...e, descuentoPrestamoUsd: 25, descuentoTrabajoUsd: 5 }, null)).toMatchObject({ negativo: true, prestamoExcedeGanado: false });
  });
});
