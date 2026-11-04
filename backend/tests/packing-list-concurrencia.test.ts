import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({ rpc: vi.fn(), filaLista: null as unknown }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: bd.rpc,
    from: (tabla: string) => {
      const cadena: Record<string, unknown> = {};
      cadena.select = () => cadena;
      cadena.eq = () => cadena;
      cadena.order = () => (tabla === 'packing_list_items' ? Promise.resolve({ data: [], error: null }) : cadena);
      cadena.maybeSingle = () => Promise.resolve({ data: bd.filaLista, error: null });
      return cadena;
    },
  },
}));

import {
  clasificarError,
  guardarPackingList,
  CODIGO_CONFLICTO_VERSION,
  MENSAJE_PACKING_CONFLICTO,
  MENSAJE_PACKING_SIN_VERSION,
} from '../src/services/packing-list-service.js';
import { guardarPackingListSchema } from '../src/schemas/packing-lists.js';

const ID = '11111111-1111-4111-8111-111111111111';
const base = {
  contenedor: 'SEKU-1', fecha: '2026-01-01', tipoEmbalaje: 'big_bag', esPcb: true,
  items: [{ numero: 1, pesoBruto: 100, pesoPaleta: 5 }],
};
const entrada = (extra: Record<string, unknown> = {}) => guardarPackingListSchema.parse({ ...base, ...extra });

const fila = (version: number) => ({
  id: ID, contenedor: 'SEKU-1', fecha: '2026-01-01', tipo_embalaje: 'big_bag', es_pcb: true,
  descripcion_es: null, descripcion_en: null, observaciones_es: null, observaciones_en: null,
  referencia_tipo: null, referencia_id: null, created_at: 'x', updated_at: 'y', version,
});

beforeEach(() => { bd.rpc.mockReset(); bd.filaLista = fila(3); });

describe('esquema: version', () => {
  it('acepta version entera >= 1 y la deja pasar', () => {
    expect(entrada({ version: 4 }).version).toBe(4);
  });
  it('rechaza version 0, decimal o texto', () => {
    for (const v of [0, 1.5, '2']) expect(guardarPackingListSchema.safeParse({ ...base, version: v }).success).toBe(false);
  });
});

describe('clasificarError', () => {
  it('el código de conflicto se mapea a 409 con el mensaje de recarga', () => {
    expect(clasificarError({ code: CODIGO_CONFLICTO_VERSION, message: 'lo que sea' })).toEqual({
      error: MENSAJE_PACKING_CONFLICTO, status: 409,
    });
  });
  it('un raise de negocio normal sigue siendo 400', () => {
    expect(clasificarError({ code: 'P0001', message: 'Mensaje de negocio.' }).status).toBe(400);
  });
});

describe('guardarPackingList', () => {
  it('editar sin versión se rechaza (400) sin llamar a la BD', async () => {
    const r = await guardarPackingList(ID, entrada(), 'u1');
    expect(r).toEqual({ ok: false, error: MENSAJE_PACKING_SIN_VERSION, status: 400 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('editar envía la versión esperada y devuelve el detalle con la versión nueva', async () => {
    bd.rpc.mockResolvedValue({ data: { id: ID, version: 3 }, error: null });
    const r = await guardarPackingList(ID, entrada({ version: 2 }), 'u1');
    expect(bd.rpc).toHaveBeenCalledWith('guardar_packing_list', expect.objectContaining({ p_id: ID, p_version_esperada: 2 }));
    expect(r.ok && r.valor.version).toBe(3);
  });

  it('crear no envía versión esperada aunque el cliente la mande', async () => {
    bd.rpc.mockResolvedValue({ data: { id: ID, version: 1 }, error: null });
    bd.filaLista = fila(1);
    await guardarPackingList(null, entrada({ version: 9 }), 'u1');
    expect(bd.rpc).toHaveBeenCalledWith('guardar_packing_list', expect.objectContaining({ p_id: null, p_version_esperada: null }));
  });

  it('versión desactualizada: 409 con mensaje de conflicto', async () => {
    bd.rpc.mockResolvedValue({ data: null, error: { code: CODIGO_CONFLICTO_VERSION, message: 'Otra persona modificó este packing list; recarga.' } });
    const r = await guardarPackingList(ID, entrada({ version: 1 }), 'u1');
    expect(r).toEqual({ ok: false, error: MENSAJE_PACKING_CONFLICTO, status: 409 });
  });
});
