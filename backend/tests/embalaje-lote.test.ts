import { describe, it, expect } from 'vitest';
import { resumirEmbalado, resumirEmbaladoPorAlmacen } from '../src/utils/embalaje-lote.js';
import { marcarEmbalajeSchema, anularEmbalajeSchema } from '../src/schemas/lote-embalajes.js';

const emb = (pesoKg: number, almacenId: string | null = null, anulado = false) => ({ almacenId, pesoKg, anulado });

describe('resumirEmbalado', () => {
  it('embalado + en saca = stock', () => {
    const r = resumirEmbalado(1000, [emb(300), emb(200)]);
    expect(r).toMatchObject({ stockKg: 1000, embaladoKg: 500, enSacaKg: 500, embaladoMayorQueStock: false, excesoKg: 0 });
  });
  it('un lote puede tener parte embalada y parte en saca', () => {
    const r = resumirEmbalado(13623.065, [emb(8000)]);
    expect(r.embaladoKg).toBe(8000);
    expect(r.enSacaKg).toBe(5623.065);
  });
  it('los embalajes anulados no cuentan', () => {
    const r = resumirEmbalado(100, [emb(60), emb(40, null, true)]);
    expect(r.embaladoKg).toBe(60);
    expect(r.enSacaKg).toBe(40);
  });
  it('si el stock cae por debajo de lo embalado, recorta y avisa sin bloquear', () => {
    const r = resumirEmbalado(70, [emb(100)]);
    expect(r.embaladoMarcadoKg).toBe(100);
    expect(r.embaladoKg).toBe(70);
    expect(r.enSacaKg).toBe(0);
    expect(r.embaladoMayorQueStock).toBe(true);
    expect(r.excesoKg).toBe(30);
  });
  it('un exceso dentro de la tolerancia (0,01 kg) no avisa', () => {
    const r = resumirEmbalado(100, [emb(100.005)]);
    expect(r.embaladoMayorQueStock).toBe(false);
    expect(r.embaladoKg).toBe(100);
  });
  it('stock negativo o cero: nada embalado ni en saca, y avisa si habia embalajes', () => {
    expect(resumirEmbalado(-5, [emb(10)])).toMatchObject({ embaladoKg: 0, enSacaKg: 0, embaladoMayorQueStock: true, excesoKg: 10 });
    expect(resumirEmbalado(0, [])).toMatchObject({ embaladoKg: 0, enSacaKg: 0, embaladoMayorQueStock: false });
  });
  it('ignora pesos invalidos y no muta la entrada', () => {
    const lista = [emb(Number.NaN), emb(-3), emb(10)];
    expect(resumirEmbalado(50, lista).embaladoKg).toBe(10);
    expect(lista).toHaveLength(3);
  });
  it('sin ruido de coma flotante', () => {
    expect(resumirEmbalado(0.3, [emb(0.1), emb(0.2)]).enSacaKg).toBe(0);
  });
});

describe('resumirEmbaladoPorAlmacen', () => {
  it('resume cada almacen con su propio stock y embalajes', () => {
    const r = resumirEmbaladoPorAlmacen(
      [{ almacenId: 'g1', stockKg: 100 }, { almacenId: 'g2', stockKg: 50 }],
      [emb(30, 'g1'), emb(60, 'g2'), emb(10, null)]
    );
    expect(r.find(a => a.almacenId === 'g1')).toMatchObject({ embaladoKg: 30, enSacaKg: 70 });
    expect(r.find(a => a.almacenId === 'g2')).toMatchObject({ embaladoKg: 50, embaladoMayorQueStock: true, excesoKg: 10 });
    expect(r).toHaveLength(2);
  });
  it('un almacen que ya no tiene stock pero conserva embalajes vigentes se avisa', () => {
    const r = resumirEmbaladoPorAlmacen([], [emb(20, 'g3')]);
    expect(r).toEqual([expect.objectContaining({ almacenId: 'g3', embaladoMayorQueStock: true, excesoKg: 20 })]);
  });
});

describe('schemas de embalaje', () => {
  const ALM = '11111111-1111-4111-8111-111111111111';
  it('marcar: kilos positivos, almacen y notas opcionales', () => {
    expect(marcarEmbalajeSchema.safeParse({ pesoKg: 500 }).success).toBe(true);
    const r = marcarEmbalajeSchema.parse({ pesoKg: 500.5, almacenId: ALM, nota: '  saca 3  ', contenedor: 'CONT-1' });
    expect(r.nota).toBe('saca 3');
  });
  it('marcar: rechaza 0, negativos, enormes, almacen no uuid y textos largos', () => {
    expect(marcarEmbalajeSchema.safeParse({ pesoKg: 0 }).success).toBe(false);
    expect(marcarEmbalajeSchema.safeParse({ pesoKg: -1 }).success).toBe(false);
    expect(marcarEmbalajeSchema.safeParse({ pesoKg: 1e8 }).success).toBe(false);
    expect(marcarEmbalajeSchema.safeParse({ pesoKg: 1, almacenId: 'x' }).success).toBe(false);
    expect(marcarEmbalajeSchema.safeParse({ pesoKg: 1, nota: 'x'.repeat(501) }).success).toBe(false);
    expect(marcarEmbalajeSchema.safeParse({ pesoKg: 1, contenedor: 'x'.repeat(81) }).success).toBe(false);
  });
  it('anular: motivo obligatorio', () => {
    expect(anularEmbalajeSchema.safeParse({ motivo: 'Se capturó dos veces' }).success).toBe(true);
    expect(anularEmbalajeSchema.safeParse({ motivo: '  ' }).success).toBe(false);
    expect(anularEmbalajeSchema.safeParse({}).success).toBe(false);
    expect(anularEmbalajeSchema.safeParse({ motivo: 'x'.repeat(301) }).success).toBe(false);
  });
});
