import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const consultaVacia = {
  select: () => consultaVacia,
  eq: () => consultaVacia,
  in: () => consultaVacia,
  order: () => consultaVacia,
  limit: () => consultaVacia,
  maybeSingle: async () => ({ data: null, error: null }),
  single: async () => ({ data: null, error: null }),
};
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a), from: () => consultaVacia },
}));

import { crearTransformacionFerrosoSchema, crearTransformacionPCBSchema } from '../src/schemas/transformaciones';
import { consolidarEntrada, MAX_PESADAS_ENTRADA } from '../src/schemas/transformaciones-entrada';
import { crearTransformacionFerroso, crearTransformacionPCB } from '../src/services/transformacion-service';

const ID = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const ferroso = { productoEntradaId: ID, almacenId: OTRO, fecha: '2026-10-07' };
const pcb = { loteOrigenId: ID, almacenId: OTRO, fecha: '2026-10-07' };

describe('entrada con un solo peso (contrato anterior)', () => {
  it('ferroso: pesoBruto/tara/fotosEntrada pasan igual que antes', () => {
    const r = crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesoBruto: 100, tara: 5, fotosEntrada: ['a'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ pesoBruto: 100, tara: 5, fotosEntrada: ['a'], notas: null });
  });

  it('PCB: tara omitida = 0', () => {
    const r = crearTransformacionPCBSchema.safeParse({ ...pcb, pesoBruto: 80, fotosEntrada: ['a'] });
    expect(r.success && r.data.tara).toBe(0);
  });

  it('sin foto sigue rechazándose', () => {
    expect(crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesoBruto: 100, tara: 0, fotosEntrada: [] }).success).toBe(false);
    expect(crearTransformacionPCBSchema.safeParse({ ...pcb, pesoBruto: 100 }).success).toBe(false);
  });

  it('sin peso bruto se rechaza', () => {
    expect(crearTransformacionFerrosoSchema.safeParse({ ...ferroso, fotosEntrada: ['a'] }).success).toBe(false);
  });
});

describe('entrada con varias pesadas', () => {
  const pesadas = [
    { pesoBruto: 100.5, tara: 5.25, fotos: ['a'] },
    { pesoBruto: 200, tara: 10, fotos: ['b', 'c'] },
    { pesoBruto: 50.125, tara: 0, fotos: ['d'] },
  ];

  it('ferroso: suma bruto y tara y junta las fotos en orden', () => {
    const r = crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesadasEntrada: pesadas });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pesoBruto).toBe(350.625);
      expect(r.data.tara).toBe(15.25);
      expect(r.data.fotosEntrada).toEqual(['a', 'b', 'c', 'd']);
      expect(r.data).not.toHaveProperty('pesadasEntrada');
    }
  });

  it('PCB: mismo cálculo', () => {
    const r = crearTransformacionPCBSchema.safeParse({ ...pcb, pesadasEntrada: pesadas });
    expect(r.success && r.data.pesoBruto - r.data.tara).toBeCloseTo(335.375, 3);
  });

  it('un arreglo de una pesada equivale al peso único', () => {
    const una = crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesadasEntrada: [{ pesoBruto: 100, tara: 5, fotos: ['a'] }] });
    const legado = crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesoBruto: 100, tara: 5, fotosEntrada: ['a'] });
    expect(una.success).toBe(true);
    expect(legado.success).toBe(true);
    if (una.success && legado.success) expect(una.data).toEqual(legado.data);
  });

  it('redondea la suma a 3 decimales (sin ruido de coma flotante)', () => {
    const total = consolidarEntrada({ pesadasEntrada: [{ pesoBruto: 0.1, tara: 0, fotos: [] }, { pesoBruto: 0.2, tara: 0, fotos: [] }] });
    expect(total.pesoBruto).toBe(0.3);
  });

  it('rechaza mezclar pesadas con el peso único', () => {
    expect(crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesoBruto: 10, pesadasEntrada: pesadas }).success).toBe(false);
  });

  it('rechaza una pesada con tara >= bruto', () => {
    expect(
      crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesadasEntrada: [{ pesoBruto: 10, tara: 10, fotos: ['a'] }] }).success
    ).toBe(false);
  });

  it('rechaza lista vacía, ninguna foto y exceso de pesadas', () => {
    expect(crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesadasEntrada: [] }).success).toBe(false);
    expect(crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesadasEntrada: [{ pesoBruto: 5, tara: 1, fotos: [] }] }).success).toBe(false);
    const demasiadas = Array.from({ length: MAX_PESADAS_ENTRADA + 1 }, () => ({ pesoBruto: 5, tara: 1, fotos: ['a'] }));
    expect(crearTransformacionFerrosoSchema.safeParse({ ...ferroso, pesadasEntrada: demasiadas }).success).toBe(false);
  });

  it('acepta clientRequestId y capturadoEn', () => {
    const r = crearTransformacionPCBSchema.safeParse({ ...pcb, pesadasEntrada: pesadas, clientRequestId: ID, capturadoEn: '2026-10-07T10:00:00Z' });
    expect(r.success && r.data.clientRequestId).toBe(ID);
  });
});

describe('el servicio recibe los totales', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 'tr-1', error: null });
  });

  it('crear_transformacion_ferroso se llama con bruto/tara sumados y todas las fotos', async () => {
    const r = crearTransformacionFerrosoSchema.parse({
      ...ferroso,
      pesadasEntrada: [{ pesoBruto: 100, tara: 5, fotos: ['a'] }, { pesoBruto: 40, tara: 2, fotos: ['b'] }],
    });
    await crearTransformacionFerroso(r, 'u1');
    expect(rpc).toHaveBeenCalledWith(
      'crear_transformacion_ferroso',
      expect.objectContaining({ p_peso_bruto: 140, p_tara: 7, p_fotos_entrada: ['a', 'b'], p_producto_entrada_id: ID })
    );
  });

  it('crear_transformacion_pcb igual', async () => {
    const r = crearTransformacionPCBSchema.parse({
      ...pcb,
      pesadasEntrada: [{ pesoBruto: 30, tara: 1, fotos: ['a'] }, { pesoBruto: 20, tara: 1, fotos: ['b'] }],
    });
    await crearTransformacionPCB(r, 'u1');
    expect(rpc).toHaveBeenCalledWith(
      'crear_transformacion_pcb',
      expect.objectContaining({ p_peso_bruto: 50, p_tara: 2, p_fotos_entrada: ['a', 'b'], p_lote_origen_id: ID })
    );
  });
});
