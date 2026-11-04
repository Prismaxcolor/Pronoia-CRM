import { describe, it, expect } from 'vitest';
import * as back from '../src/utils/nomina-calculo';
import * as front from '../../shared/types/nomina-calculo';

const base = {
  diasTrabajados: 5, montoBaseUsd: 20, montoBaseBs: 0, bonificacionUsd: 0, descuentoTrabajoUsd: 0, descuentoPrestamoUsd: 0,
};

describe('calcularLinea (solo sueldo en divisas, como antes)', () => {
  it('bruto = días x sueldo en divisas; ref Bs = bruto x tasa', () => {
    const l = back.calcularLinea(base, 40);
    expect(l.totalBrutoUsd).toBe(100);
    expect(l.montoRefBs).toBe(4000);
    expect(l.pagarUsd).toBe(100);
    expect(l.pagarBs).toBe(0);
    expect(l.totalUsd).toBe(100);
    expect(l.totalBs).toBe(4000);
    expect(l.monedaPago).toBe('USD');
    expect(l.negativo).toBe(false);
    expect(l.faltaTasa).toBe(false);
  });

  it('total = bruto + bonificación - descuentos (trabajo + préstamo)', () => {
    const l = back.calcularLinea({ ...base, bonificacionUsd: 15, descuentoTrabajoUsd: 5, descuentoPrestamoUsd: 10 }, 40);
    expect(l.descuentosUsd).toBe(15);
    expect(l.pagarUsd).toBe(100);
    expect(l.totalUsd).toBe(100);
    expect(l.montoRefBs).toBe(4000); // la referencia es solo del bruto
  });

  it('sin tasa y sin sueldo en Bs: no hace falta la tasa; lo que depende de ella es null', () => {
    const l = back.calcularLinea(base, null);
    expect(l.montoRefBs).toBeNull();
    expect(l.totalBs).toBeNull();
    expect(l.pagarBs).toBe(0);
    expect(l.equivalenteBsUsd).toBe(0);
    expect(l.totalUsd).toBe(100);
    expect(l.faltaTasa).toBe(false);
  });

  it('medios días y sin error de coma flotante', () => {
    expect(back.calcularLinea({ ...base, diasTrabajados: 4.5, montoBaseUsd: 17.3 }, null).totalBrutoUsd).toBe(77.85);
    const m = back.calcularLinea({ ...base, diasTrabajados: 3, montoBaseUsd: 0.1, bonificacionUsd: 0.2, descuentoTrabajoUsd: 0.5 }, null);
    expect(m.totalUsd).toBe(0);
  });

  it('redondea el Bs de referencia al centavo', () => {
    expect(back.calcularLinea({ ...base, diasTrabajados: 1, montoBaseUsd: 10.01 }, 36.4567).totalBs).toBe(364.93);
  });

  it('total negativo se marca (sin sueldo en Bs no hay a dónde cargar el sobrante)', () => {
    const l = back.calcularLinea({ ...base, diasTrabajados: 1, descuentoPrestamoUsd: 50 }, null);
    expect(l.pagarUsd).toBe(-30);
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

describe('calcularLinea con los dos sueldos (divisas + Bs como referencia en USD)', () => {
  // "Sueldo en Bs = 8" son 8 USD por día de referencia, pagados en Bs a la tasa de la nómina (no 8 Bs).
  const dos = { ...base, diasTrabajados: 5, montoBaseUsd: 20, montoBaseBs: 8 };

  it('el número del sueldo en Bs es USD de referencia: 8 por día x 5 días = 40 USD = 1600 Bs a tasa 40', () => {
    const l = back.calcularLinea(dos, 40);
    expect(l.pagarUsd).toBe(100);
    expect(l.brutoBsRefUsd).toBe(40);
    expect(l.brutoBs).toBe(1600);
    expect(l.pagarBs).toBe(1600);
    expect(l.equivalenteBsUsd).toBe(40);
    expect(l.totalBrutoUsd).toBe(140);
    expect(l.montoRefBs).toBe(5600);
    expect(l.totalUsd).toBe(140);
    expect(l.totalBs).toBe(5600);
    expect(l.monedaPago).toBe('MIXTO');
  });

  it('el valor en USD de la parte en Bs no cambia con la tasa; los Bs sí', () => {
    const a = back.calcularLinea(dos, 40);
    const b = back.calcularLinea(dos, 50);
    expect(b.equivalenteBsUsd).toBe(a.equivalenteBsUsd);
    expect(b.totalUsd).toBe(a.totalUsd);
    expect(b.pagarBs).toBe(2000);
  });

  it('solo sueldo en Bs: se paga en bolívares', () => {
    const l = back.calcularLinea({ ...dos, montoBaseUsd: 0 }, 40);
    expect(l).toMatchObject({ pagarUsd: 0, pagarBs: 1600, equivalenteBsUsd: 40, totalUsd: 40, monedaPago: 'BS' });
  });

  it('la bonificación se paga en divisas', () => {
    const l = back.calcularLinea({ ...dos, bonificacionUsd: 10 }, 40);
    expect(l).toMatchObject({ pagarUsd: 110, pagarBs: 1600, totalUsd: 150 });
  });

  it('los descuentos se cargan primero a divisas', () => {
    const l = back.calcularLinea({ ...dos, descuentoTrabajoUsd: 5, descuentoPrestamoUsd: 10 }, 40);
    expect(l).toMatchObject({ pagarUsd: 85, pagarBs: 1600, equivalenteBsUsd: 40, totalUsd: 125, negativo: false });
  });

  it('si las divisas no alcanzan, el sobrante en USD se descuenta de la referencia de la parte en Bs', () => {
    // divisas: 100; descuentos 130 => 30 USD de sobrante => quedan 10 USD de referencia => 400 Bs a tasa 40
    const l = back.calcularLinea({ ...dos, descuentoPrestamoUsd: 130 }, 40);
    expect(l).toMatchObject({ pagarUsd: 0, pagarBs: 400, equivalenteBsUsd: 10, totalUsd: 10, negativo: false });
  });

  it('un trabajador solo con sueldo en Bs puede tener cuotas de préstamo (se cargan a la referencia)', () => {
    const l = back.calcularLinea({ ...dos, montoBaseUsd: 0, descuentoPrestamoUsd: 10 }, 40);
    expect(l).toMatchObject({ pagarUsd: 0, pagarBs: 1200, equivalenteBsUsd: 30, totalUsd: 30, negativo: false });
  });

  it('si ni divisas ni la referencia alcanzan, el total sale negativo', () => {
    const l = back.calcularLinea({ ...dos, descuentoTrabajoUsd: 200 }, 40);
    expect(l.pagarUsd).toBe(0);
    expect(l.equivalenteBsUsd).toBe(-60);
    expect(l.pagarBs).toBe(-60 * 40);
    expect(l.totalUsd).toBe(-60);
    expect(l.negativo).toBe(true);
  });

  it('sin tasa y con parte en Bs: faltaTasa, los Bs son null (no 0), pero el valor en USD sí se conoce', () => {
    const l = back.calcularLinea(dos, null);
    expect(l.faltaTasa).toBe(true);
    expect(l.pagarBs).toBeNull();
    expect(l.brutoBs).toBe(0);
    expect(l.equivalenteBsUsd).toBe(40);
    expect(l.totalBs).toBeNull();
    expect(l.pagarUsd).toBe(100);
    expect(l.totalUsd).toBe(140);
    expect(l.negativo).toBe(false);
  });

  it('los Bs a pagar se redondean al centavo; el valor en USD queda exacto', () => {
    const l = back.calcularLinea({ ...base, montoBaseUsd: 0, diasTrabajados: 1, montoBaseBs: 2.74 }, 36.4567);
    expect(l.pagarBs).toBe(99.89); // 2.74 x 36.4567 = 99.8895...
    expect(l.equivalenteBsUsd).toBe(2.74);
  });
});

describe('equivalenteUsdDeBs', () => {
  it.each([['backend', back], ['shared', front]] as const)('%s: Bs entre tasa al centavo; tasa inválida lanza', (_n, m) => {
    expect(m.equivalenteUsdDeBs(1000, 40)).toBe(25);
    expect(m.equivalenteUsdDeBs(100, 36.4567)).toBe(2.74);
    expect(m.equivalenteUsdDeBs(0, 40)).toBe(0);
    expect(() => m.equivalenteUsdDeBs(10, 0)).toThrow();
    expect(() => m.equivalenteUsdDeBs(10, -1)).toThrow();
  });
});

const lt = (pagarUsd: number, pagarBs: number | null, tasa: number | null) => {
  const equivalenteBsUsd = pagarBs === null || tasa === null ? null : back.equivalenteUsdDeBs(pagarBs, tasa);
  return { pagarUsd, pagarBs, equivalenteBsUsd };
};

describe('calcularTotales', () => {
  it('vacío: todo en cero', () => {
    const t = back.calcularTotales([], 40);
    expect(t).toMatchObject({ cantidad: 0, totalDivisasUsd: 0, totalBs: 0, equivalenteUsdDeBs: 0, totalCombinadoUsd: 0, totalCombinadoBs: 0 });
  });

  it('separa divisas y bolívares, cuenta cada parte y combina', () => {
    const t = back.calcularTotales([lt(100, 0, 40), lt(50, 0, 40), lt(0, 1200, 40), lt(10, 400, 40)], 40);
    expect(t.cantidad).toBe(4);
    expect(t.cantidadDivisas).toBe(3);
    expect(t.cantidadBs).toBe(2); // el trabajador con las dos partes cuenta en los dos grupos
    expect(t.totalDivisasUsd).toBe(160);
    expect(t.totalBs).toBe(1600);
    expect(t.equivalenteUsdDeBs).toBe(40);
    expect(t.totalCombinadoUsd).toBe(200);
    expect(t.totalCombinadoBs).toBe(8000); // 1600 + 160 x 40
  });

  it('sin tasa y con renglones en Bs: el total en Bs es null; sin parte en Bs sigue calculable', () => {
    const conBs = back.calcularTotales([lt(10, 0, null), lt(0, null, null)], null);
    expect(conBs.totalBs).toBeNull();
    expect(conBs.totalCombinadoBs).toBeNull();
    expect(conBs.totalCombinadoUsd).toBe(10);
    const soloUsd = back.calcularTotales([lt(10, 0, null)], null);
    expect(soloUsd.totalBs).toBe(0);
    expect(soloUsd.totalCombinadoBs).toBeNull();
  });

  it('el equivalente en USD es la suma de los de cada renglón (no se divide de vuelta el total)', () => {
    const t = back.calcularTotales([lt(0, 10.01, 36.4567), lt(0, 10.01, 36.4567)], 36.4567);
    expect(t.equivalenteUsdDeBs).toBe(0.54); // 0.27 + 0.27 (el total 20.02 / 36.4567 daría 0.55)
  });
});

describe('sumarTotales (general de la semana)', () => {
  it('suma administrativo + operativo', () => {
    const a = back.calcularTotales([lt(100, 0, 40)], 40);
    const o = back.calcularTotales([lt(0, 2100, 42)], 42);
    const g = back.sumarTotales([a, o]);
    expect(g.cantidad).toBe(2);
    expect(g.totalDivisasUsd).toBe(100);
    expect(g.totalBs).toBe(2100);
    expect(g.equivalenteUsdDeBs).toBe(50);
    expect(g.totalCombinadoUsd).toBe(150);
    expect(g.totalCombinadoBs).toBe(4000 + 2100);
  });

  it('si alguna parte no tiene Bs calculables, el combinado en Bs es null', () => {
    const a = back.calcularTotales([lt(100, 0, null)], null);
    const o = back.calcularTotales([lt(10, 0, 40)], 40);
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
    { ...base, diasTrabajados: 1, montoBaseUsd: 10.01, montoBaseBs: 365.5 },
    { ...base, diasTrabajados: 6, montoBaseUsd: 0, montoBaseBs: 123.45, descuentoPrestamoUsd: 7.77 },
    { ...base, diasTrabajados: 5, montoBaseUsd: 12, montoBaseBs: 200, descuentoTrabajoUsd: 90 },
    { ...base, diasTrabajados: 0.25, descuentoPrestamoUsd: 99 },
  ];
  it.each([null, 36.4567, 1])('calcularLinea y calcularTotales con tasa %s', tasa => {
    const b = casos.map(c => back.calcularLinea(c, tasa));
    const f = casos.map(c => front.calcularLinea(c, tasa));
    expect(f).toEqual(b);
    expect(front.calcularTotales(f, tasa)).toEqual(back.calcularTotales(b, tasa));
    expect(front.sumarTotales([front.calcularTotales(f, tasa)])).toEqual(back.sumarTotales([back.calcularTotales(b, tasa)]));
    casos.forEach(c => {
      expect(front.gananciaDeLinea(c)).toBe(back.gananciaDeLinea(c));
      expect(front.prestamoExcedeGanado(c)).toBe(back.prestamoExcedeGanado(c));
    });
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
  it.each([['backend', back], ['shared', front]] as const)('%s: el sueldo en Bs (USD de referencia) cuenta como ganado sin necesitar la tasa', (_n, m) => {
    const conBs = { ...e, montoBaseBs: 10 }; // 10 USD de referencia => ganado 35
    expect(m.gananciaDeLinea(conBs)).toBe(35);
    expect(m.prestamoExcedeGanado({ ...conBs, descuentoPrestamoUsd: 35 })).toBe(false);
    expect(m.prestamoExcedeGanado({ ...conBs, descuentoPrestamoUsd: 35.01 })).toBe(true);
  });
  it('el descuento por trabajo no cuenta para este tope (eso lo cubre el aviso de total negativo)', () => {
    expect(back.prestamoExcedeGanado({ ...e, descuentoPrestamoUsd: 25 })).toBe(false);
    expect(back.calcularLinea({ ...e, descuentoPrestamoUsd: 25, descuentoTrabajoUsd: 5 }, null)).toMatchObject({ negativo: true, prestamoExcedeGanado: false });
  });
});
