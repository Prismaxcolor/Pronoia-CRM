import { describe, it, expect } from 'vitest';
import { PERIODOS, periodoDesdeTexto, rangoDePeriodo, rangoPeriodoAnterior, tituloPeriodo } from '../../frontend/src/features/wallet/wallet-periodos';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('rango de cada período (incluye hoy)', () => {
  const hoy = utc('2026-11-11');
  it('7D, 30D y 12S cuentan días corridos incluyendo hoy', () => {
    expect(rangoDePeriodo('7D', hoy)).toEqual({ desde: '2026-11-05', hasta: '2026-11-11' });
    expect(rangoDePeriodo('30D', hoy)).toEqual({ desde: '2026-10-13', hasta: '2026-11-11' });
    expect(rangoDePeriodo('12S', hoy)).toEqual({ desde: '2026-08-20', hasta: '2026-11-11' });
  });
  it('6M y 1A arrancan el día siguiente al mismo día de hace 6 meses / 1 año', () => {
    expect(rangoDePeriodo('6M', hoy)).toEqual({ desde: '2026-05-12', hasta: '2026-11-11' });
    expect(rangoDePeriodo('1A', hoy)).toEqual({ desde: '2025-11-12', hasta: '2026-11-11' });
  });
  it('no desborda al restar meses desde un día 31', () => {
    expect(rangoDePeriodo('6M', utc('2026-08-31')).desde).toBe('2026-03-01');
    expect(rangoDePeriodo('1A', utc('2024-02-29')).desde).toBe('2023-03-01');
  });
  it('el período 30D de 30 días tiene exactamente 30 fechas', () => {
    const r = rangoDePeriodo('30D', hoy);
    const dias = (utc(r.hasta).getTime() - utc(r.desde).getTime()) / 86400000 + 1;
    expect(dias).toBe(30);
  });
});

describe('período anterior', () => {
  it('termina el día antes y dura lo mismo', () => {
    const r = rangoDePeriodo('7D', utc('2026-11-11'));
    expect(rangoPeriodoAnterior(r)).toEqual({ desde: '2026-10-29', hasta: '2026-11-04' });
  });
});

describe('selección por texto', () => {
  it('acepta claves válidas sin importar mayúsculas y cae a 30D con cualquier otra cosa', () => {
    expect(periodoDesdeTexto('6m')).toBe('6M');
    expect(periodoDesdeTexto('1A')).toBe('1A');
    expect(periodoDesdeTexto('xx')).toBe('30D');
    expect(periodoDesdeTexto(null)).toBe('30D');
  });
  it('cada período tiene título y clave únicos', () => {
    expect(new Set(PERIODOS.map(p => p.clave)).size).toBe(5);
    expect(tituloPeriodo('30D')).toBe('ÚLTIMOS 30 DÍAS');
  });
});
