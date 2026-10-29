import { describe, it, expect } from 'vitest';
import { sinSaltosDeLinea } from '../../frontend/src/lib/sin-saltos-de-linea';

describe('sinSaltosDeLinea', () => {
  it('cambia cada salto de línea (LF, CR, CRLF) por un espacio', () => {
    expect(sinSaltosDeLinea('a\nb\r\nc\rd')).toBe('a b c d');
  });
  it('deja igual un texto de una línea y no recorta espacios', () => {
    expect(sinSaltosDeLinea('Pago a proveedor X ')).toBe('Pago a proveedor X ');
  });
});
