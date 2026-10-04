import { describe, it, expect } from 'vitest';
import { antiguedadEstimada, combinarAntiguedades, diasEntre } from '../src/utils/antiguedad-inventario.js';

const HOY = '2026-10-04';

describe('diasEntre', () => {
  it('cuenta dias calendario y nunca es negativo', () => {
    expect(diasEntre('2026-09-24', HOY)).toBe(10);
    expect(diasEntre(HOY, HOY)).toBe(0);
    expect(diasEntre('2026-10-10', HOY)).toBe(0);
  });
});

describe('antiguedadEstimada (sin capas FIFO: el stock se formo con las entradas MAS RECIENTES)', () => {
  it('un stock menor que la ultima entrada solo usa esa entrada', () => {
    const r = antiguedadEstimada(50, [{ fecha: '2026-09-16', kg: 1000 }, { fecha: '2026-10-02', kg: 100 }], HOY);
    expect(r).toMatchObject({
      estimado: true, diasPromedio: 2, fechaEntradaMasAntigua: '2026-10-02', fechaEntradaMasReciente: '2026-10-02',
      kgConFecha: 50, kgSinFecha: 0,
    });
  });

  it('pondera por kg: 100 kg de hace 2 dias + 300 kg de hace 12 dias = 9.5', () => {
    const r = antiguedadEstimada(
      400,
      [{ fecha: '2026-09-22', kg: 300 }, { fecha: '2026-10-02', kg: 100 }, { fecha: '2026-09-01', kg: 999 }],
      HOY
    );
    expect(r?.diasPromedio).toBe(9.5);
    expect(r?.fechaEntradaMasAntigua).toBe('2026-09-22');
    expect(r?.fechaEntradaMasReciente).toBe('2026-10-02');
    expect(r?.kgConFecha).toBe(400);
  });

  it('las entradas sin orden y varias el mismo dia se agrupan', () => {
    // 40 kg de hace 1 dia + 110 kg de hace 3 dias = (40 + 330) / 150 = 2.47 -> 2.5
    const r = antiguedadEstimada(
      150,
      [{ fecha: '2026-10-01', kg: 60 }, { fecha: '2026-10-03', kg: 40 }, { fecha: '2026-10-01', kg: 100 }],
      HOY
    );
    expect(r).toMatchObject({ diasPromedio: 2.5, kgConFecha: 150 });
  });

  it('no inventa antiguedad: el stock que ninguna entrada explica queda en kgSinFecha', () => {
    const r = antiguedadEstimada(500, [{ fecha: '2026-09-30', kg: 120 }], HOY);
    expect(r).toMatchObject({ diasPromedio: 4, kgConFecha: 120, kgSinFecha: 380, fechaEntradaMasAntigua: '2026-09-30' });
  });

  it('sin stock positivo o sin entradas validas devuelve null', () => {
    expect(antiguedadEstimada(0, [{ fecha: '2026-10-01', kg: 5 }], HOY)).toBeNull();
    expect(antiguedadEstimada(-3, [{ fecha: '2026-10-01', kg: 5 }], HOY)).toBeNull();
    expect(antiguedadEstimada(10, [], HOY)).toBeNull();
    expect(
      antiguedadEstimada(10, [{ fecha: 'x', kg: 5 }, { fecha: '2026-10-01', kg: -4 }, { fecha: '2026-10-01', kg: NaN }], HOY)
    ).toBeNull();
  });

  it('una entrada con fecha futura cuenta como 0 dias', () => {
    expect(antiguedadEstimada(10, [{ fecha: '2026-10-09', kg: 10 }], HOY)?.diasPromedio).toBe(0);
  });

  it('acepta fechas ISO con hora y no muta la lista recibida', () => {
    const entradas = [{ fecha: '2026-09-01T10:00:00Z', kg: 5 }, { fecha: '2026-10-01', kg: 5 }];
    const copia = JSON.parse(JSON.stringify(entradas));
    const r = antiguedadEstimada(8, entradas, HOY);
    expect(entradas).toEqual(copia);
    expect(r?.fechaEntradaMasAntigua).toBe('2026-09-01');
  });
});

describe('combinarAntiguedades (tarjetas)', () => {
  it('promedia ponderando por kg con fecha y conserva la fecha mas antigua', () => {
    const a = antiguedadEstimada(100, [{ fecha: '2026-10-02', kg: 100 }], HOY)!; // 2 dias
    const b = antiguedadEstimada(300, [{ fecha: '2026-09-24', kg: 300 }], HOY)!; // 10 dias
    const c = combinarAntiguedades([a, b, null]);
    expect(c).toMatchObject({
      estimado: true, diasPromedio: 8, fechaEntradaMasAntigua: '2026-09-24', fechaEntradaMasReciente: '2026-10-02',
      kgConFecha: 400, kgSinFecha: 0,
    });
  });
  it('sin ninguna antiguedad devuelve null', () => {
    expect(combinarAntiguedades([null, null])).toBeNull();
    expect(combinarAntiguedades([])).toBeNull();
  });
});
