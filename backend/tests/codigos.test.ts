import { describe, it, expect } from 'vitest';
import { formatCodigoTransformacion } from '../src/utils/codigos.js';

describe('formatCodigoTransformacion', () => {
  it('rellena con ceros hasta 4 dígitos', () => {
    expect(formatCodigoTransformacion(1)).toBe('TR-0001');
    expect(formatCodigoTransformacion(42)).toBe('TR-0042');
  });

  it('no trunca números de más de 4 dígitos', () => {
    expect(formatCodigoTransformacion(12345)).toBe('TR-12345');
  });
});
