import { describe, it, expect } from 'vitest';
import { detalleBanca, entidadesDeBancas, inicialDeBanca } from '../../frontend/src/features/cochinito/selector-banca';
import { errorImagenBanca, imagenParaGuardar, MAX_BYTES_IMAGEN_BANCA } from '../../frontend/src/features/cochinito/imagen-banca';

describe('errorImagenBanca', () => {
  it('acepta jpeg, png y webp dentro del límite', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(errorImagenBanca({ type, size: 1000 })).toBeNull();
    }
  });
  it('rechaza SVG, GIF y tipos que no son imagen', () => {
    for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', '']) {
      expect(errorImagenBanca({ type, size: 1000 })).not.toBeNull();
    }
  });
  it('rechaza lo que excede el límite', () => {
    expect(errorImagenBanca({ type: 'image/png', size: MAX_BYTES_IMAGEN_BANCA + 1 })).toMatch(/6 MB/);
  });
});

describe('imagenParaGuardar', () => {
  it('sin cambios no se manda nada', () => {
    expect(imagenParaGuardar('https://x/a.png', 'https://x/a.png')).toBeUndefined();
    expect(imagenParaGuardar(null, null)).toBeUndefined();
    expect(imagenParaGuardar(undefined, null)).toBeUndefined();
  });
  it('imagen nueva manda la URL; quitarla manda null', () => {
    expect(imagenParaGuardar(null, 'https://x/b.png')).toBe('https://x/b.png');
    expect(imagenParaGuardar('https://x/a.png', null)).toBeNull();
  });
});

const banca = (o: Partial<{ id: string; nombre: string; moneda: string; saldo: number; imagenUrl: string | null; color: string | null }> = {}) => ({
  id: 'b1', nombre: 'Banesco USD', moneda: 'USD', saldo: 1500.5, imagenUrl: null, color: null, ...o,
});

describe('inicialDeBanca', () => {
  it('toma la primera letra en mayúscula, sin espacios ni símbolos', () => {
    expect(inicialDeBanca('banesco')).toBe('B');
    expect(inicialDeBanca('  caja chica')).toBe('C');
    expect(inicialDeBanca('')).toBe('?');
  });
});

describe('detalleBanca', () => {
  it('con saldo muestra símbolo, monto y moneda', () => {
    expect(detalleBanca(banca(), true)).toBe('$1.500,50 · USD');
    expect(detalleBanca(banca({ moneda: 'VES' }), true)).toMatch(/^Bs .* · VES$/);
  });
  it('usa el formato es-VE del proyecto con 2 decimales, sin depender del idioma del navegador', () => {
    expect(detalleBanca(banca({ saldo: 1234567.891 }), true)).toBe('$1.234.567,89 · USD');
    expect(detalleBanca(banca({ saldo: 0, moneda: 'VES' }), true)).toBe('Bs 0,00 · VES');
  });
  it('sin saldo muestra solo la moneda', () => {
    expect(detalleBanca(banca(), false)).toBe('USD');
  });
});

describe('entidadesDeBancas', () => {
  it('usa la imagen como única foto cuando existe', () => {
    const [e] = entidadesDeBancas([banca({ imagenUrl: 'https://x/a.png' })], true);
    expect(e.fotos).toEqual(['https://x/a.png']);
  });
  it('sin imagen no lleva fotos (la tarjeta cae a color e inicial)', () => {
    const [e] = entidadesDeBancas([banca()], true);
    expect(e.fotos).toEqual([]);
  });
  it('conserva el orden y no muta la entrada', () => {
    const entrada = [banca({ id: 'a' }), banca({ id: 'b', color: 'azul' })];
    const copia = JSON.stringify(entrada);
    const r = entidadesDeBancas(entrada, false);
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
    expect(r[1].color).toBe('#1D4ED8');
    expect(JSON.stringify(entrada)).toBe(copia);
  });
});
