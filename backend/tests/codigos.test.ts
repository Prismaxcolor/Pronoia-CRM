import { describe, it, expect } from 'vitest';
import { formatCodigoTransformacion, formatCodigoCruce, formatCodigoCruceCliente } from '../src/utils/codigos.js';

describe('formatCodigoTransformacion', () => {
  it('rellena con ceros hasta 4 dígitos', () => {
    expect(formatCodigoTransformacion(1)).toBe('TR-0001');
    expect(formatCodigoTransformacion(42)).toBe('TR-0042');
  });

  it('no trunca números de más de 4 dígitos', () => {
    expect(formatCodigoTransformacion(12345)).toBe('TR-12345');
  });
});

describe('formatCodigoCruce', () => {
  it('formatea el cruce con proveedor (CR-) y con cliente (CRV-)', () => {
    expect(formatCodigoCruce(3)).toBe('CR-0003');
    expect(formatCodigoCruceCliente(12)).toBe('CRV-0012');
  });
});
