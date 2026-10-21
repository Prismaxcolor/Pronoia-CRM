import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));

import {
  completarTransformacionMixtaSchema,
  validarSalidasMixtasPorCategoria,
  type SalidaMixtaInput,
} from '../src/schemas/transformaciones.js';
import {
  validarBalancePesos,
  validarCompletarMixta,
  validarLoteDestinoDistintoDeOrigen,
} from '../src/services/transformacion-service.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

const parse = (salidas: unknown[]) => completarTransformacionMixtaSchema.safeParse({ salidas });
const salidas = (...s: unknown[]) => {
  const r = parse(s);
  if (!r.success) throw new Error('esquema inválido en fixture');
  return r.data.salidas as SalidaMixtaInput[];
};

describe('completarTransformacionMixtaSchema', () => {
  it('acepta material y lote, con defaults de tara y fotos', () => {
    const r = parse([
      { tipo: 'material', productoId: U1, pesoBruto: 10 },
      { tipo: 'lote', loteDestinoId: U2, almacenId: U3, pesoBruto: 5, tara: 1, fotos: ['a.jpg'] },
    ]);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.salidas[0]).toMatchObject({ tara: 0, fotos: [] });
    }
  });

  it('rechaza lista vacía', () => {
    expect(parse([]).success).toBe(false);
  });

  it('rechaza tipo desconocido o ausente', () => {
    expect(parse([{ tipo: 'otro', productoId: U1, pesoBruto: 1 }]).success).toBe(false);
    expect(parse([{ productoId: U1, pesoBruto: 1 }]).success).toBe(false);
  });

  it('rechaza material sin productoId y lote sin loteDestinoId', () => {
    expect(parse([{ tipo: 'material', pesoBruto: 1 }]).success).toBe(false);
    expect(parse([{ tipo: 'lote', pesoBruto: 1 }]).success).toBe(false);
  });

  it('rechaza uuid inválido', () => {
    expect(parse([{ tipo: 'material', productoId: 'x', pesoBruto: 1 }]).success).toBe(false);
  });

  it('rechaza neto <= 0 y tara negativa', () => {
    expect(parse([{ tipo: 'material', productoId: U1, pesoBruto: 5, tara: 5 }]).success).toBe(false);
    expect(parse([{ tipo: 'material', productoId: U1, pesoBruto: 5, tara: 6 }]).success).toBe(false);
    expect(parse([{ tipo: 'material', productoId: U1, pesoBruto: 5, tara: -1 }]).success).toBe(false);
    expect(parse([{ tipo: 'material', productoId: U1, pesoBruto: 0 }]).success).toBe(false);
  });
});

describe('validarSalidasMixtasPorCategoria', () => {
  it('PCB + lote: requiere almacén y prohíbe producto', () => {
    expect(validarSalidasMixtasPorCategoria('pcb', salidas({ tipo: 'lote', loteDestinoId: U2, almacenId: U3, pesoBruto: 1 }))).toBeNull();
    expect(validarSalidasMixtasPorCategoria('pcb', salidas({ tipo: 'lote', loteDestinoId: U2, pesoBruto: 1 }))).toMatch(/almacén/);
    expect(validarSalidasMixtasPorCategoria('pcb', salidas({ tipo: 'lote', loteDestinoId: U2, almacenId: U3, productoId: U1, pesoBruto: 1 }))).toMatch(/no lleva material/);
  });

  it('PCB + material: requiere almacén', () => {
    expect(validarSalidasMixtasPorCategoria('pcb', salidas({ tipo: 'material', productoId: U1, almacenId: U3, pesoBruto: 1 }))).toBeNull();
    expect(validarSalidasMixtasPorCategoria('pcb', salidas({ tipo: 'material', productoId: U1, pesoBruto: 1 }))).toMatch(/almacén/);
  });

  it('Ferroso + material: almacén opcional', () => {
    expect(validarSalidasMixtasPorCategoria('ferroso_no_ferroso', salidas({ tipo: 'material', productoId: U1, pesoBruto: 1 }))).toBeNull();
  });

  it('Ferroso + lote: requiere producto y almacén', () => {
    expect(validarSalidasMixtasPorCategoria('ferroso_no_ferroso', salidas({ tipo: 'lote', loteDestinoId: U2, productoId: U1, almacenId: U3, pesoBruto: 1 }))).toBeNull();
    expect(validarSalidasMixtasPorCategoria('ferroso_no_ferroso', salidas({ tipo: 'lote', loteDestinoId: U2, almacenId: U3, pesoBruto: 1 }))).toMatch(/material/);
    expect(validarSalidasMixtasPorCategoria('ferroso_no_ferroso', salidas({ tipo: 'lote', loteDestinoId: U2, productoId: U1, pesoBruto: 1 }))).toMatch(/almacén/);
  });

  it('indica el número de la salida con error y rechaza categorías desconocidas', () => {
    const s = salidas(
      { tipo: 'material', productoId: U1, almacenId: U3, pesoBruto: 1 },
      { tipo: 'material', productoId: U1, pesoBruto: 1 }
    );
    expect(validarSalidasMixtasPorCategoria('pcb', s)).toMatch(/^Salida 2:/);
    expect(validarSalidasMixtasPorCategoria('xyz', s)).toMatch(/no soportada/);
  });
});

describe('balance de pesos', () => {
  it('acepta suma igual o dentro de la tolerancia de 0.01 kg', () => {
    expect(validarBalancePesos(100, [{ pesoBruto: 60, tara: 0 }, { pesoBruto: 40, tara: 0 }])).toBeNull();
    expect(validarBalancePesos(100, [{ pesoBruto: 100.01, tara: 0 }])).toBeNull();
    expect(validarBalancePesos(100, [{ pesoBruto: 50, tara: 5 }])).toBeNull();
  });

  it('rechaza cuando las salidas superan la entrada', () => {
    expect(validarBalancePesos(100, [{ pesoBruto: 100.02, tara: 0 }])).toMatch(/superan/);
    expect(validarBalancePesos(100, [{ pesoBruto: 70, tara: 0 }, { pesoBruto: 40, tara: 5 }])).toMatch(/105.00 kg/);
    expect(validarBalancePesos(100, [{ pesoBruto: 70, tara: 0 }, { pesoBruto: 40, tara: 0 }])).toMatch(/110\.00 kg/);
  });
});

describe('lote destino distinto del origen (PCB)', () => {
  it('rechaza volver al lote de origen', () => {
    const s = salidas({ tipo: 'lote', loteDestinoId: U2, almacenId: U3, pesoBruto: 1 });
    expect(validarLoteDestinoDistintoDeOrigen(U2, s)).toMatch(/mismo lote/);
    expect(validarLoteDestinoDistintoDeOrigen(U1, s)).toBeNull();
    expect(validarLoteDestinoDistintoDeOrigen(null, s)).toBeNull();
  });
});

describe('validarCompletarMixta', () => {
  const cab = { categoria: 'pcb', estado: 'bruto', peso_neto: 100, lote_origen_id: U1 };
  const ok = salidas({ tipo: 'lote', loteDestinoId: U2, almacenId: U3, pesoBruto: 50 });

  it('acepta una transformación bruta válida', () => {
    expect(validarCompletarMixta(cab, ok)).toBeNull();
  });

  it('rechaza una transformación ya completa', () => {
    expect(validarCompletarMixta({ ...cab, estado: 'completa' }, ok)).toMatch(/ya fue completada/);
  });

  it('PCB no permite lote destino igual al origen; ferroso no tiene esa restricción', () => {
    const mismo = salidas({ tipo: 'lote', loteDestinoId: U1, almacenId: U3, pesoBruto: 50 });
    expect(validarCompletarMixta(cab, mismo)).toMatch(/mismo lote/);
    const ferroso = salidas({ tipo: 'lote', loteDestinoId: U1, productoId: U2, almacenId: U3, pesoBruto: 50 });
    expect(validarCompletarMixta({ ...cab, categoria: 'ferroso_no_ferroso', lote_origen_id: null }, ferroso)).toBeNull();
  });

  it('rechaza exceso de peso', () => {
    const mucho = salidas({ tipo: 'lote', loteDestinoId: U2, almacenId: U3, pesoBruto: 150 });
    expect(validarCompletarMixta(cab, mucho)).toMatch(/superan/);
  });
});
