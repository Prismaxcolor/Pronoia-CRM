import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({
  respuesta: { data: null, error: null } as { data: unknown; error: { code?: string; message: string } | null },
  llamadas: [] as Array<[string, unknown]>,
  lectura: { data: null, error: null } as { data: unknown; error: { message: string } | null },
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(bd.lectura) }) }) }),
    rpc: (nombre: string, args: unknown) => {
      bd.llamadas.push([nombre, args]);
      return Promise.resolve(bd.respuesta);
    },
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  AVISO_BAJA_FALLIDA,
  AVISO_BAJA_NO_HABILITADA,
  avisoDeBaja,
  darBajaExportacion,
  yaEraExportacion,
  type RespuestaBajaExportacion,
} from '../src/services/exportacion-baja-inventario.js';

const limpia: RespuestaBajaExportacion = {
  ya_registrada: false,
  lotes: [{ lote: 'LOTE 1', almacen_id: 'a1', kg: 1908, exceso_kg: 0 }],
  sin_lote: [],
};

beforeEach(() => {
  bd.respuesta = { data: limpia, error: null };
  bd.llamadas = [];
  bd.lectura = { data: null, error: null };
});

describe('yaEraExportacion', () => {
  it('es false cuando el packing list aún no tiene cliente', async () => {
    bd.lectura = { data: { cliente_id: null }, error: null };
    expect(await yaEraExportacion('pl-1')).toBe(false);
  });

  it('es true cuando ya tenía cliente: no se vuelve a descontar', async () => {
    bd.lectura = { data: { cliente_id: 'c-1' }, error: null };
    expect(await yaEraExportacion('pl-1')).toBe(true);
  });

  it('es true si no se pudo leer, para no arriesgar un doble descuento', async () => {
    bd.lectura = { data: null, error: { message: 'boom' } };
    expect(await yaEraExportacion('pl-1')).toBe(true);
  });
});

describe('avisoDeBaja', () => {
  it('devuelve null cuando todo se descontó sin excesos', () => {
    expect(avisoDeBaja(limpia)).toBeNull();
  });

  it('avisa de los lotes que no existen en el inventario', () => {
    const aviso = avisoDeBaja({ ...limpia, sin_lote: ['9', 'X'] });
    expect(aviso).toContain('9, X');
    expect(aviso).toContain('no se descontaron');
  });

  it('suma el exceso de un mismo lote repartido en varios almacenes', () => {
    const aviso = avisoDeBaja({
      ya_registrada: false,
      sin_lote: [],
      lotes: [
        { lote: 'LOTE 2', almacen_id: 'a1', kg: 100, exceso_kg: '10.5' },
        { lote: 'LOTE 2', almacen_id: 'a2', kg: 50, exceso_kg: 4.5 },
        { lote: 'LOTE 1', almacen_id: 'a1', kg: 20, exceso_kg: 0 },
      ],
    });
    expect(aviso).toContain('LOTE 2');
    expect(aviso).toContain('15');
    expect(aviso).not.toContain('LOTE 1');
  });
});

describe('darBajaExportacion', () => {
  it('llama al RPC con el packing list y el usuario', async () => {
    const aviso = await darBajaExportacion('pl-1', 'u-1');
    expect(aviso).toBeNull();
    expect(bd.llamadas).toEqual([['dar_baja_exportacion', { p_packing_list_id: 'pl-1', p_usuario_id: 'u-1' }]]);
  });

  it('no avisa cuando la baja ya estaba registrada', async () => {
    bd.respuesta = { data: { ya_registrada: true, lotes: [], sin_lote: [] }, error: null };
    expect(await darBajaExportacion('pl-1', 'u-1')).toBeNull();
  });

  it('tolera una respuesta incompleta sin lanzar', async () => {
    bd.respuesta = { data: { id: 'pl-1' }, error: null };
    expect(await darBajaExportacion('pl-1', 'u-1')).toBeNull();
  });

  it('avisa que falta la migración si la función no existe', async () => {
    bd.respuesta = { data: null, error: { code: '42883', message: 'function public.dar_baja_exportacion does not exist' } };
    expect(await darBajaExportacion('pl-1', 'u-1')).toBe(AVISO_BAJA_NO_HABILITADA);
  });

  it('devuelve un aviso genérico (sin lanzar) ante cualquier otro fallo', async () => {
    bd.respuesta = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await darBajaExportacion('pl-1', 'u-1')).toBe(AVISO_BAJA_FALLIDA);
  });
});
