import { describe, it, expect } from 'vitest';
import { fechaCorteSaldo, parametrosResumen, rotuloSaldo, textoEnGalpon, textoKgDeFecha, mostrarEnlaceMetricas } from '../../frontend/src/lib/inventario-nuevo';
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

describe('textos del saldo historico', () => {
  it('sin fecha de saldo los textos quedan en presente', () => {
    expect(textoEnGalpon(undefined)).toBe('en galpón ahora');
    expect(textoEnGalpon(null)).toBe('en galpón ahora');
    expect(textoKgDeFecha(undefined)).toBe('Los kg son los de hoy');
  });
  it('con fecha de saldo pasan a pasado con la fecha dd/mm/aaaa', () => {
    expect(textoEnGalpon('2026-10-05')).toBe('en galpón al 05/10/2026');
    expect(textoKgDeFecha('2026-10-05')).toBe('Los kg son los del 05/10/2026');
  });
  it('el enlace a Metricas (valor de hoy) solo se ofrece con permiso y sin saldo historico', () => {
    expect(mostrarEnlaceMetricas(undefined, true)).toBe(true);
    expect(mostrarEnlaceMetricas(undefined, false)).toBe(false);
    expect(mostrarEnlaceMetricas('2026-10-05', true)).toBe(false);
  });
});
