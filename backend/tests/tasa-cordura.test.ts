import { describe, it, expect } from 'vitest';
import { esTasaCreible, variacionRelativa, UMBRAL_VARIACION_TASA, MAX_ANTIGUEDAD_REFERENCIA_MS } from '../src/utils/tasa-cordura.js';

const AHORA = new Date('2026-10-16T12:00:00Z');
const ref = (tasa: number, haceMs = 60_000) => ({ tasa, capturadaEn: new Date(AHORA.getTime() - haceMs) });

describe('variacionRelativa', () => {
  it('calcula la variación respecto a la anterior', () => {
    expect(variacionRelativa(130, 100)).toBeCloseTo(0.3);
    expect(variacionRelativa(70, 100)).toBeCloseTo(0.3);
  });
  it('devuelve Infinity si la anterior no sirve', () => {
    expect(variacionRelativa(10, 0)).toBe(Infinity);
    expect(variacionRelativa(10, NaN)).toBe(Infinity);
  });
});

describe('esTasaCreible', () => {
  it('acepta variaciones dentro del umbral', () => {
    expect(esTasaCreible(36.5, ref(36), AHORA)).toBe(true);
    expect(esTasaCreible(100 * (1 + UMBRAL_VARIACION_TASA), ref(100), AHORA)).toBe(true);
  });
  it('rechaza saltos mayores al umbral (subida y bajada)', () => {
    expect(esTasaCreible(3650, ref(36.5), AHORA)).toBe(false);
    expect(esTasaCreible(0.36, ref(36.5), AHORA)).toBe(false);
  });
  it('rechaza valores no positivos o no finitos', () => {
    expect(esTasaCreible(0, null, AHORA)).toBe(false);
    expect(esTasaCreible(NaN, ref(36), AHORA)).toBe(false);
    expect(esTasaCreible(-1, ref(36), AHORA)).toBe(false);
  });
  it('sin referencia, o con referencia inválida, acepta', () => {
    expect(esTasaCreible(500, null, AHORA)).toBe(true);
    expect(esTasaCreible(500, ref(0), AHORA)).toBe(true);
  });
  it('una referencia demasiado vieja ya no bloquea', () => {
    expect(esTasaCreible(500, ref(36, MAX_ANTIGUEDAD_REFERENCIA_MS + 1), AHORA)).toBe(true);
    expect(esTasaCreible(500, ref(36, MAX_ANTIGUEDAD_REFERENCIA_MS - 1), AHORA)).toBe(false);
  });
});
