import { describe, it, expect } from 'vitest';
import {
  esColorCategoriaValido, normalizarColorCategoria, tipoAceptaMovimiento, validarCategoriaParaMovimiento,
  validarPadreDeCategoria, resolverSeleccion, nombreCompletoCategoria, type CategoriaFila,
} from '../src/utils/categoria-wallet.js';

const cat = (id: string, tipo: CategoriaFila['tipo'], padreId: string | null = null, activo = true, nombre = id): CategoriaFila =>
  ({ id, nombre, tipo, padreId, activo, color: '#DC2626' });

describe('color de categoría', () => {
  it('acepta #RRGGBB en cualquier caja y lo normaliza a mayúsculas', () => {
    expect(normalizarColorCategoria(' #dc2626 ')).toBe('#DC2626');
    expect(esColorCategoriaValido('#DC2626')).toBe(true);
  });
  it('rechaza claves, hex cortos y basura', () => {
    for (const v of ['rojo', '#FFF', '#GGGGGG', 'DC2626', '#DC26261', '#DC2626"; drop']) {
      expect(esColorCategoriaValido(normalizarColorCategoria(v)), v).toBe(false);
    }
  });
});

describe('tipoAceptaMovimiento', () => {
  it('AMBOS acepta ingreso y egreso; INGRESO y EGRESO solo el suyo; nadie acepta transferencia', () => {
    expect(tipoAceptaMovimiento('AMBOS', 'ingreso')).toBe(true);
    expect(tipoAceptaMovimiento('AMBOS', 'egreso')).toBe(true);
    expect(tipoAceptaMovimiento('INGRESO', 'ingreso')).toBe(true);
    expect(tipoAceptaMovimiento('INGRESO', 'egreso')).toBe(false);
    expect(tipoAceptaMovimiento('EGRESO', 'egreso')).toBe(true);
    expect(tipoAceptaMovimiento('EGRESO', 'ingreso')).toBe(false);
    for (const t of ['INGRESO', 'EGRESO', 'AMBOS'] as const) expect(tipoAceptaMovimiento(t, 'transferencia')).toBe(false);
  });
});

describe('validarCategoriaParaMovimiento', () => {
  const todas = [cat('p', 'EGRESO'), cat('h', 'EGRESO', 'p'), cat('arch', 'EGRESO', null, false), cat('hp', 'EGRESO', 'arch'), cat('ing', 'INGRESO')];
  it('null (sin categoría) siempre es válido', () => {
    expect(validarCategoriaParaMovimiento(null, todas, 'egreso')).toBeNull();
    expect(validarCategoriaParaMovimiento(null, todas, 'transferencia')).toBeNull();
  });
  it('acepta categoría y subcategoría activas del tipo correcto', () => {
    expect(validarCategoriaParaMovimiento('p', todas, 'egreso')).toBeNull();
    expect(validarCategoriaParaMovimiento('h', todas, 'egreso')).toBeNull();
  });
  it('rechaza inexistente, archivada, subcategoría de padre archivado y tipo incompatible', () => {
    expect(validarCategoriaParaMovimiento('nope', todas, 'egreso')).toMatch(/no existe/i);
    expect(validarCategoriaParaMovimiento('arch', todas, 'egreso')).toMatch(/archivada/i);
    expect(validarCategoriaParaMovimiento('hp', todas, 'egreso')).toMatch(/archivada/i);
    expect(validarCategoriaParaMovimiento('ing', todas, 'egreso')).toMatch(/ingresos/i);
  });
  it('las transferencias no llevan categoría', () => {
    expect(validarCategoriaParaMovimiento('p', todas, 'transferencia')).toMatch(/transferencia/i);
  });
});

describe('validarPadreDeCategoria (máximo dos niveles)', () => {
  const todas = [cat('p', 'EGRESO'), cat('h', 'EGRESO', 'p'), cat('amb', 'AMBOS')];
  it('sin padre es válido', () => expect(validarPadreDeCategoria(null, 'INGRESO', todas)).toBeNull());
  it('una subcategoría no puede tener hijos', () => {
    expect(validarPadreDeCategoria('h', 'EGRESO', todas)).toMatch(/dos niveles/i);
  });
  it('el padre debe existir y estar activo', () => {
    expect(validarPadreDeCategoria('x', 'EGRESO', todas)).toMatch(/no existe/i);
    expect(validarPadreDeCategoria('a', 'EGRESO', [cat('a', 'EGRESO', null, false)])).toMatch(/archivada/i);
  });
  it('el tipo del hijo no puede ser más amplio que el del padre', () => {
    expect(validarPadreDeCategoria('p', 'AMBOS', todas)).toMatch(/tipo/i);
    expect(validarPadreDeCategoria('p', 'INGRESO', todas)).toMatch(/tipo/i);
    expect(validarPadreDeCategoria('p', 'EGRESO', todas)).toBeNull();
    expect(validarPadreDeCategoria('amb', 'INGRESO', todas)).toBeNull();
    expect(validarPadreDeCategoria('amb', 'AMBOS', todas)).toBeNull();
  });
});

describe('resolverSeleccion', () => {
  const todas = [cat('p1', 'EGRESO'), cat('h1', 'EGRESO', 'p1'), cat('h2', 'EGRESO', 'p1'), cat('p2', 'AMBOS'), cat('h3', 'AMBOS', 'p2')];
  it('una categoría incluye sus subcategorías', () => {
    expect([...resolverSeleccion(['p1'], todas)!].sort()).toEqual(['h1', 'h2', 'p1']);
  });
  it('una subcategoría sola incluye solo esa', () => {
    expect([...resolverSeleccion(['h2'], todas)!]).toEqual(['h2']);
  });
  it('varias y repetidas se unen sin duplicar', () => {
    expect([...resolverSeleccion(['p1', 'h1', 'h3'], todas)!].sort()).toEqual(['h1', 'h2', 'h3', 'p1']);
  });
  it('lista vacía = null (sin restricción)', () => expect(resolverSeleccion([], todas)).toBeNull());
  it('ignora ids que no existen', () => expect([...resolverSeleccion(['zz', 'h3'], todas)!]).toEqual(['h3']));
});

describe('nombreCompletoCategoria', () => {
  const todas = [cat('p', 'EGRESO', null, true, 'Servicios'), cat('h', 'EGRESO', 'p', true, 'Luz')];
  it('categoría sola, subcategoría con su padre y desconocida', () => {
    expect(nombreCompletoCategoria('p', todas)).toBe('Servicios');
    expect(nombreCompletoCategoria('h', todas)).toBe('Servicios › Luz');
    expect(nombreCompletoCategoria('zz', todas)).toBeNull();
    expect(nombreCompletoCategoria(null, todas)).toBeNull();
  });
});
