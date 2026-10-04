import { describe, it, expect } from 'vitest';
import {
  TIPOS_MERMA as TIPOS_FRONT,
  TOLERANCIA_MERMA_KG as TOL_FRONT,
  armarMermaDetalle,
  mermaFormDesdeDetalle,
  mermaFormVacio,
  mermaSinClasificar,
  totalMermaTipificada,
  validarMermaForm,
} from '../../frontend/src/lib/merma-tipificada';
import { TIPOS_MERMA, TOLERANCIA_MERMA_KG } from '../src/utils/merma-tipificada.js';

const form = (parcial: Partial<ReturnType<typeof mermaFormVacio>>) => ({ ...mermaFormVacio(), ...parcial });

describe('merma por tipo del formulario (frontend)', () => {
  it('usa los mismos tipos y la misma tolerancia que el backend', () => {
    expect([...TIPOS_FRONT]).toEqual([...TIPOS_MERMA]);
    expect(TOL_FRONT).toBe(TOLERANCIA_MERMA_KG);
  });

  it('formulario vacio: no envia nada y es valido (el bloque es opcional)', () => {
    expect(armarMermaDetalle(mermaFormVacio())).toBeUndefined();
    expect(validarMermaForm(10, mermaFormVacio())).toBeNull();
    expect(validarMermaForm(0, mermaFormVacio())).toBeNull();
  });
  it('arma solo los tipos con kilos, en orden fijo, aceptando coma decimal', () => {
    expect(armarMermaDetalle(form({ otro: '1', basura: '2,5', plastico: '0', tierra: '' }))).toEqual([
      { tipo: 'basura', pesoKg: 2.5 },
      { tipo: 'otro', pesoKg: 1 },
    ]);
  });
  it('valida que no exceda la merma calculada (con 0,01 kg de tolerancia)', () => {
    expect(validarMermaForm(10, form({ basura: '6', plastico: '4' }))).toBeNull();
    expect(validarMermaForm(10, form({ basura: '10.01' }))).toBeNull();
    expect(validarMermaForm(10, form({ basura: '10.02' }))).toMatch(/supera la merma calculada/);
  });
  it('sin merma calculada no se puede tipificar nada', () => {
    expect(validarMermaForm(0, form({ basura: '1' }))).not.toBeNull();
    expect(validarMermaForm(-2, form({ basura: '1' }))).not.toBeNull();
  });
  it('rechaza valores negativos o no numericos', () => {
    expect(validarMermaForm(10, form({ basura: '-1' }))).toMatch(/no es un número válido/);
    expect(validarMermaForm(10, form({ tierra: 'abc' }))).toMatch(/tierra/);
  });
  it('lo no clasificado es merma - tipificado, nunca negativo', () => {
    expect(mermaSinClasificar(10, form({ basura: '6' }))).toBe(4);
    expect(mermaSinClasificar(2, form({ basura: '6' }))).toBe(0);
    expect(mermaSinClasificar(-1, mermaFormVacio())).toBe(0);
  });
  it('total sin ruido de coma flotante', () => {
    expect(totalMermaTipificada(form({ basura: '0.1', plastico: '0.2' }))).toBe(0.3);
  });
  it('precarga el formulario desde un desglose guardado', () => {
    const f = mermaFormDesdeDetalle([{ tipo: 'hierro', pesoKg: 1.5 }]);
    expect(f.hierro).toBe('1.5');
    expect(f.basura).toBe('');
  });
});
