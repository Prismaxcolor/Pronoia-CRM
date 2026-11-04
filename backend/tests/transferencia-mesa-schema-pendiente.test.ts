import { describe, it, expect } from 'vitest';
import { completarTransferenciaMesaSchema } from '../src/schemas/transferencia-mesa.js';

describe('completarTransferenciaMesaSchema: pendienteEsperado', () => {
  it('cuerpo vacío sigue siendo cobro total', () => {
    expect(completarTransferenciaMesaSchema.safeParse({}).success).toBe(true);
  });
  it('exige pendienteEsperado cuando hay montoCobrado', () => {
    expect(completarTransferenciaMesaSchema.safeParse({ montoCobrado: 100 }).success).toBe(false);
  });
  it('acepta cobro parcial con pendienteEsperado', () => {
    expect(completarTransferenciaMesaSchema.safeParse({ montoCobrado: 100, pendienteEsperado: 500 }).success).toBe(true);
  });
});
