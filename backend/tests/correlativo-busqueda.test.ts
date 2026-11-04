import { describe, it, expect } from 'vitest';
import { correlativoCoincide } from '../../frontend/src/lib/correlativo-busqueda';

describe('correlativoCoincide', () => {
  it('encuentra el código escrito completo', () => {
    expect(correlativoCoincide('MV-0012', 'mv-0012')).toBe(true);
  });

  it('encuentra por fragmento numérico', () => {
    expect(correlativoCoincide('PG-0123', '123')).toBe(true);
  });

  it('ignora ceros a la izquierda y el guion', () => {
    expect(correlativoCoincide('MV-0012', 'mv-12')).toBe(true);
    expect(correlativoCoincide('MV-0012', 'MV12')).toBe(true);
    expect(correlativoCoincide('MV-0012', 'mv 12')).toBe(true);
  });

  it('no mezcla prefijos distintos con el mismo número', () => {
    expect(correlativoCoincide('PG-0012', 'mv-12')).toBe(false);
  });

  it('no confunde números distintos', () => {
    expect(correlativoCoincide('MV-0012', 'mv-13')).toBe(false);
  });

  it('devuelve false con consulta o código vacíos', () => {
    expect(correlativoCoincide('MV-0012', '  ')).toBe(false);
    expect(correlativoCoincide('', 'mv-12')).toBe(false);
  });
});
