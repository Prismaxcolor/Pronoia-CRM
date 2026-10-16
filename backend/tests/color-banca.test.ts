import { describe, it, expect } from 'vitest';
import { PALETA_BANCAS, NEUTROS_BANCAS, colorDeBanca, hexDeColorGuardado, nombreDeColor } from '../../frontend/src/lib/color-banca';
import { CLAVES_COLOR_BANCA, esColorBancaValido, normalizarColorBanca } from '../src/utils/color-banca.js';
import { actualizarBancaSchema, crearBancaSchema } from '../src/schemas/cochinito.js';

describe('colorDeBanca', () => {
  it('usa la clave de la paleta', () => {
    expect(colorDeBanca({ color: 'azul' }, 0)).toBe('#1D4ED8');
  });
  it('acepta un hex y lo devuelve en mayúsculas', () => {
    expect(colorDeBanca({ color: '#1a2b3c' }, 0)).toBe('#1A2B3C');
  });
  it('sin color deriva un neutro de la posición, de forma estable y cíclica', () => {
    expect(colorDeBanca({ color: null }, 1)).toBe(NEUTROS_BANCAS[1]);
    expect(colorDeBanca({}, NEUTROS_BANCAS.length + 2)).toBe(NEUTROS_BANCAS[2]);
    expect(colorDeBanca(undefined, -1)).toBe(NEUTROS_BANCAS[NEUTROS_BANCAS.length - 1]);
  });
  it('un valor inválido se trata como sin color', () => {
    expect(colorDeBanca({ color: 'fucsia' }, 0)).toBe(NEUTROS_BANCAS[0]);
    expect(hexDeColorGuardado('#12')).toBeNull();
  });
  it('nombreDeColor devuelve el nombre de la paleta o vacío', () => {
    expect(nombreDeColor('ambar')).toBe('Ámbar');
    expect(nombreDeColor(null)).toBe('');
  });
  it('la paleta tiene 12 colores únicos y las mismas claves que el backend', () => {
    expect(PALETA_BANCAS).toHaveLength(12);
    expect(new Set(PALETA_BANCAS.map(c => c.hex)).size).toBe(12);
    expect(PALETA_BANCAS.map(c => c.clave)).toEqual([...CLAVES_COLOR_BANCA]);
  });
});

describe('validación del color de banca', () => {
  it('normaliza y valida', () => {
    expect(normalizarColorBanca(' #abcdef ')).toBe('#ABCDEF');
    expect(normalizarColorBanca('Rojo')).toBe('rojo');
    expect(esColorBancaValido('#ABCDEF')).toBe(true);
    expect(esColorBancaValido('verde')).toBe(true);
    expect(esColorBancaValido('#ABC')).toBe(false);
    expect(esColorBancaValido('javascript:1')).toBe(false);
  });
  const base = { nombre: 'BNC', tipo: 'banco_nacional', moneda: 'USD', descripcion: '' };
  it('crear: color opcional, normalizado y rechaza basura', () => {
    expect(crearBancaSchema.parse(base).color).toBeUndefined();
    expect(crearBancaSchema.parse({ ...base, color: '#abcdef' }).color).toBe('#ABCDEF');
    expect(crearBancaSchema.parse({ ...base, color: null }).color).toBeNull();
    expect(crearBancaSchema.safeParse({ ...base, color: 'rgb(1,2,3)' }).success).toBe(false);
  });
  it('editar: sin color no lo toca; null lo quita', () => {
    expect('color' in actualizarBancaSchema.parse({ nombre: 'X' })).toBe(false);
    expect(actualizarBancaSchema.parse({ color: null }).color).toBeNull();
    expect(actualizarBancaSchema.safeParse({ color: '#GGGGGG' }).success).toBe(false);
  });
});
