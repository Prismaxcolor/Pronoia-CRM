import { describe, it, expect } from 'vitest';
import { fechaCorteSaldo, parametrosResumen, rotuloSaldo } from '../../frontend/src/lib/inventario-nuevo';
import { parametrosPantalla } from '../../frontend/src/lib/inventario-pantalla';

const HOY = '2026-10-11';

describe('fechaCorteSaldo: el "hasta" del filtro es el cierre del saldo', () => {
  it('con un rango que termina antes de hoy, el corte es el hasta', () => {
    expect(fechaCorteSaldo({ desde: '2026-09-01', hasta: '2026-10-05' }, HOY)).toBe('2026-10-05');
  });
  it('sin filtro de fechas, o con hasta hoy o futuro, es el stock actual (sin corte)', () => {
    expect(fechaCorteSaldo({}, HOY)).toBeUndefined();
    expect(fechaCorteSaldo({ desde: '2026-09-11', hasta: HOY }, HOY)).toBeUndefined();
    expect(fechaCorteSaldo({ desde: '2026-09-11', hasta: '2026-12-01' }, HOY)).toBeUndefined();
  });
  it('un hasta sin desde (filtro incompleto) no cuenta', () => {
    expect(fechaCorteSaldo({ hasta: '2026-10-05' }, HOY)).toBeUndefined();
  });
});

describe('parámetros hacia el servidor', () => {
  it('parametrosPantalla envía al solo con corte histórico', () => {
    expect(parametrosPantalla({ desde: '2026-09-01', hasta: '2026-10-05' }, { hoy: HOY }).get('al')).toBe('2026-10-05');
    expect(parametrosPantalla({ desde: '2026-09-11', hasta: HOY }, { hoy: HOY }).has('al')).toBe(false);
    expect(parametrosPantalla({}, { hoy: HOY }).has('al')).toBe(false);
  });

  it('parametrosResumen envía al solo con corte histórico y conserva desde/hasta', () => {
    expect(parametrosResumen({ desde: '2026-09-01', hasta: '2026-10-05' }, HOY)).toEqual({ desde: '2026-09-01', hasta: '2026-10-05', al: '2026-10-05' });
    expect(parametrosResumen({ desde: '2026-09-11', hasta: HOY }, HOY)).toEqual({ desde: '2026-09-11', hasta: HOY });
    expect(parametrosResumen({}, HOY)).toEqual({});
  });
});

describe('rotuloSaldo', () => {
  it('rotula con la fecha en formato dd/mm/aaaa', () => {
    expect(rotuloSaldo('2026-10-05')).toBe('Saldo al 05/10/2026');
  });
  it('sin fecha no rotula (stock actual)', () => {
    expect(rotuloSaldo(null)).toBeNull();
    expect(rotuloSaldo(undefined)).toBeNull();
  });
});
