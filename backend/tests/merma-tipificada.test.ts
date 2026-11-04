import { describe, it, expect } from 'vitest';
import {
  TIPOS_MERMA,
  TOLERANCIA_MERMA_KG,
  consolidarDetalleMerma,
  desglosarMerma,
  validarMermaTipificada,
  resumirMermaPorTipo,
  resumirMermaPorCategoria,
  tipoMermaParaDetalle,
} from '../src/utils/merma-tipificada.js';
import { construirFilaMerma, type TransformacionParaMerma } from '../src/utils/merma-transformacion.js';
import { mermaDetalleSchema, editarMermaSchema } from '../src/schemas/merma-tipificada.js';

function trans(p: Partial<TransformacionParaMerma> & { id: string; pesoNeto: number; salidas: number[] }): TransformacionParaMerma {
  return {
    numero: 1, codigo: 'TR-0001', categoria: 'ferroso_no_ferroso', fecha: '2026-10-01', almacenId: 'a1',
    productoEntradaId: 'p1', nombreProductoEntrada: 'Cobre', nombreLoteOrigen: null, entradaDetalle: [],
    ...p,
    salidas: p.salidas.map(n => ({ pesoNeto: n })),
  };
}

describe('constantes', () => {
  it('los cinco tipos acordados y tolerancia de 0,01 kg', () => {
    expect([...TIPOS_MERMA]).toEqual(['basura', 'plastico', 'tierra', 'hierro', 'otro']);
    expect(TOLERANCIA_MERMA_KG).toBe(0.01);
  });
});

describe('consolidarDetalleMerma', () => {
  it('suma los renglones repetidos de un mismo tipo y ordena por tipo', () => {
    const r = consolidarDetalleMerma([
      { tipo: 'otro', pesoKg: 1 }, { tipo: 'basura', pesoKg: 2.5 }, { tipo: 'basura', pesoKg: 0.5 },
    ]);
    expect(r).toEqual([{ tipo: 'basura', pesoKg: 3 }, { tipo: 'otro', pesoKg: 1 }]);
  });
  it('evita ruido de coma flotante y no muta la entrada', () => {
    const entrada = [{ tipo: 'basura' as const, pesoKg: 0.1 }, { tipo: 'basura' as const, pesoKg: 0.2 }];
    expect(consolidarDetalleMerma(entrada)[0].pesoKg).toBe(0.3);
    expect(entrada).toHaveLength(2);
  });
  it('descarta renglones en cero o no finitos', () => {
    expect(consolidarDetalleMerma([{ tipo: 'tierra', pesoKg: 0 }, { tipo: 'hierro', pesoKg: Number.NaN }])).toEqual([]);
  });
});

describe('validarMermaTipificada', () => {
  it('acepta que la suma sea igual a la merma derivada', () => {
    expect(validarMermaTipificada(10, [{ tipo: 'basura', pesoKg: 6 }, { tipo: 'plastico', pesoKg: 4 }])).toBeNull();
  });
  it('acepta un exceso dentro de la tolerancia de 0,01 kg', () => {
    expect(validarMermaTipificada(10, [{ tipo: 'basura', pesoKg: 10.01 }])).toBeNull();
  });
  it('rechaza un exceso mayor a la tolerancia, con mensaje claro', () => {
    const msg = validarMermaTipificada(10, [{ tipo: 'basura', pesoKg: 10.02 }]);
    expect(msg).toContain('10.02');
    expect(msg).toContain('10.00');
  });
  it('sin merma derivada (cero o negativa) no se puede tipificar nada', () => {
    expect(validarMermaTipificada(0, [{ tipo: 'otro', pesoKg: 0.5 }])).not.toBeNull();
    expect(validarMermaTipificada(-3, [{ tipo: 'otro', pesoKg: 0.5 }])).not.toBeNull();
  });
  it('lista vacia siempre es valida (borra el desglose)', () => {
    expect(validarMermaTipificada(0, [])).toBeNull();
  });
  it('rechaza pesos no positivos o no finitos', () => {
    expect(validarMermaTipificada(10, [{ tipo: 'otro', pesoKg: -1 }])).not.toBeNull();
    expect(validarMermaTipificada(10, [{ tipo: 'otro', pesoKg: Number.NaN }])).not.toBeNull();
  });
  it('suma los repetidos antes de comparar', () => {
    expect(validarMermaTipificada(5, [{ tipo: 'basura', pesoKg: 3 }, { tipo: 'basura', pesoKg: 3 }])).not.toBeNull();
  });
});

describe('desglosarMerma', () => {
  it('lo no tipificado queda como sin clasificar', () => {
    const d = desglosarMerma(10, [{ tipo: 'basura', pesoKg: 6 }]);
    expect(d.kgTipificado).toBe(6);
    expect(d.kgSinClasificar).toBe(4);
    expect(d.porTipo).toEqual({ basura: 6, plastico: 0, tierra: 0, hierro: 0, otro: 0 });
    expect(d.excedeKg).toBe(0);
  });
  it('sin detalle toda la merma es sin clasificar', () => {
    const d = desglosarMerma(2.5, []);
    expect(d.kgSinClasificar).toBe(2.5);
    expect(d.kgTipificado).toBe(0);
  });
  it('si despues de editar pesos la merma baja por debajo de lo tipificado, sin clasificar es 0 y se avisa el exceso', () => {
    const d = desglosarMerma(4, [{ tipo: 'basura', pesoKg: 6 }]);
    expect(d.kgSinClasificar).toBe(0);
    expect(d.excedeKg).toBe(2);
  });
  it('merma derivada negativa se trata como cero', () => {
    expect(desglosarMerma(-1, []).kgSinClasificar).toBe(0);
  });
  it('un exceso dentro de la tolerancia no se reporta', () => {
    expect(desglosarMerma(10, [{ tipo: 'otro', pesoKg: 10.01 }]).excedeKg).toBe(0);
  });
});

describe('construirFilaMerma con merma tipificada', () => {
  it('agrega el desglose por tipo y el sin clasificar a la fila', () => {
    const f = construirFilaMerma({
      ...trans({ id: 't', pesoNeto: 100, salidas: [90] }),
      mermaDetalle: [{ tipo: 'basura', pesoKg: 7 }, { tipo: 'plastico', pesoKg: 1 }],
    });
    expect(f.kgMerma).toBe(10);
    expect(f.mermaPorTipo.basura).toBe(7);
    expect(f.mermaPorTipo.plastico).toBe(1);
    expect(f.kgTipificado).toBe(8);
    expect(f.kgSinClasificar).toBe(2);
  });
  it('sin detalle (transformaciones viejas) todo es sin clasificar', () => {
    const f = construirFilaMerma(trans({ id: 't', pesoNeto: 10, salidas: [9] }));
    expect(f.kgTipificado).toBe(0);
    expect(f.kgSinClasificar).toBe(1);
  });
});

describe('resumirMermaPorTipo', () => {
  const filas = [
    construirFilaMerma({ ...trans({ id: 'a', pesoNeto: 100, salidas: [90] }), mermaDetalle: [{ tipo: 'basura', pesoKg: 6 }, { tipo: 'otro', pesoKg: 2 }] }),
    construirFilaMerma({ ...trans({ id: 'b', pesoNeto: 50, salidas: [48] }), mermaDetalle: [{ tipo: 'basura', pesoKg: 1 }] }),
    construirFilaMerma(trans({ id: 'c', pesoNeto: 10, salidas: [9] })),
  ];
  it('kg y porcentaje de la merma por tipo, mas sin clasificar', () => {
    const r = resumirMermaPorTipo(filas);
    // merma total = 10 + 2 + 1 = 13
    expect(r.kgMerma).toBe(13);
    expect(r.kgEntrada).toBe(160);
    const basura = r.tipos.find(t => t.tipo === 'basura');
    expect(basura).toEqual({ tipo: 'basura', kg: 7, pctDeMerma: 53.85, pctDeEntrada: 4.38 });
    expect(r.tipos.find(t => t.tipo === 'otro')?.kg).toBe(2);
    expect(r.sinClasificar).toEqual({ kg: 4, pctDeMerma: 30.77, pctDeEntrada: 2.5 });
  });
  it('sin filas todo es cero y no divide por cero', () => {
    const r = resumirMermaPorTipo([]);
    expect(r.kgMerma).toBe(0);
    expect(r.sinClasificar).toEqual({ kg: 0, pctDeMerma: 0, pctDeEntrada: 0 });
    expect(r.tipos).toHaveLength(5);
  });
});

describe('resumirMermaPorCategoria', () => {
  it('agrupa por categoria de transformacion con su propio desglose', () => {
    const filas = [
      construirFilaMerma({ ...trans({ id: 'a', pesoNeto: 100, salidas: [90] }), mermaDetalle: [{ tipo: 'basura', pesoKg: 10 }] }),
      construirFilaMerma(trans({ id: 'b', categoria: 'pcb', pesoNeto: 20, salidas: [15] })),
      construirFilaMerma(trans({ id: 'c', categoria: 'pcb', pesoNeto: 20, salidas: [19] })),
    ];
    const r = resumirMermaPorCategoria(filas);
    expect(r.map(c => c.categoria)).toEqual(['ferroso_no_ferroso', 'pcb']);
    const pcb = r.find(c => c.categoria === 'pcb')!;
    expect(pcb.transformaciones).toBe(2);
    expect(pcb.kgMerma).toBe(6);
    expect(pcb.sinClasificar.kg).toBe(6);
    expect(r[0].tipos.find(t => t.tipo === 'basura')?.kg).toBe(10);
  });
});

describe('tipoMermaParaDetalle', () => {
  it('reconoce los tipos validos y rechaza otros', () => {
    expect(tipoMermaParaDetalle('tierra')).toBe('tierra');
    expect(tipoMermaParaDetalle('vidrio')).toBeNull();
  });
});

describe('schemas de merma', () => {
  it('acepta un detalle opcional con los 5 tipos y pesos positivos', () => {
    const r = mermaDetalleSchema.safeParse([{ tipo: 'basura', pesoKg: 1.5 }, { tipo: 'hierro', pesoKg: 0.2 }]);
    expect(r.success).toBe(true);
  });
  it('rechaza tipo desconocido, peso 0, negativo, enorme y mas de 5 renglones distintos de tipo', () => {
    expect(mermaDetalleSchema.safeParse([{ tipo: 'vidrio', pesoKg: 1 }]).success).toBe(false);
    expect(mermaDetalleSchema.safeParse([{ tipo: 'otro', pesoKg: 0 }]).success).toBe(false);
    expect(mermaDetalleSchema.safeParse([{ tipo: 'otro', pesoKg: -2 }]).success).toBe(false);
    expect(mermaDetalleSchema.safeParse([{ tipo: 'otro', pesoKg: 1e7 }]).success).toBe(false);
    const muchos = Array.from({ length: 21 }, () => ({ tipo: 'otro', pesoKg: 1 }));
    expect(mermaDetalleSchema.safeParse(muchos).success).toBe(false);
  });
  it('editar: detalle obligatorio (puede ser vacio para borrar) y llave opcional', () => {
    expect(editarMermaSchema.safeParse({ detalle: [] }).success).toBe(true);
    expect(editarMermaSchema.safeParse({ detalle: [{ tipo: 'otro', pesoKg: 1 }], llaveEdicion: 'ABCDE-12345' }).success).toBe(true);
    expect(editarMermaSchema.safeParse({}).success).toBe(false);
  });
});
