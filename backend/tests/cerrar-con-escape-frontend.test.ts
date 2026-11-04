import { describe, it, expect } from 'vitest';
import { debeCerrarConTecla } from '../../frontend/src/hooks/use-cerrar-con-escape';

describe('debeCerrarConTecla', () => {
  it('Escape cierra el modal', () => {
    expect(debeCerrarConTecla('Escape', false, false)).toBe(true);
  });
  it('otras teclas no lo cierran', () => {
    expect(debeCerrarConTecla('Enter', false, false)).toBe(false);
    expect(debeCerrarConTecla('Tab', false, false)).toBe(false);
  });
  it('no cierra si otro control ya atendio la tecla o se esta guardando', () => {
    expect(debeCerrarConTecla('Escape', true, false)).toBe(false);
    expect(debeCerrarConTecla('Escape', false, true)).toBe(false);
  });
});
