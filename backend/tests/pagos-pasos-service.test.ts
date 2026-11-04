import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;

const bd = vi.hoisted(() => ({
  insertError: null as { message: string; code?: string } | null,
  insertados: [] as Fila[],
  actualizados: [] as Array<{ id: string; cambios: Fila }>,
  pendientes: [] as Fila[],
  updateComprobanteError: null as { message: string } | null,
  categoria: [] as Array<{ ids: string[]; categoriaId: string | null; falla: boolean }>,
  categoriaFalla: 0, // cuántas llamadas seguidas fallan
  comisionesAplicadas: [] as unknown[],
  comisionRespuesta: { comisiones: [], advertencia: undefined, bancasFallidas: undefined } as {
    comisiones: Array<{ bancaId: string; movimientoId: string; monto: number }>; advertencia?: string; bancasFallidas?: string[];
  },
  reintentoComision: [] as Array<{ ok: boolean; error?: string; comision?: unknown }>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => ({
      insert: (fila: Fila) => {
        bd.insertados.push({ tabla, ...fila });
        return { select: () => ({ single: () => Promise.resolve(bd.insertError ? { data: null, error: bd.insertError } : { data: { id: `p-${bd.insertados.length}` }, error: null }) }) };
      },
      update: (cambios: Fila) => ({
        eq: (_c: string, id: string) => {
          if (tabla === 'movimientos') return Promise.resolve({ error: bd.updateComprobanteError });
          bd.actualizados.push({ id, cambios });
          return Promise.resolve({ error: null });
        },
      }),
      select: () => {
        const c: Record<string, unknown> = {};
        for (const m of ['is', 'lt', 'order']) c[m] = () => c;
        c.in = () => Promise.resolve({ data: bd.pendientes, error: null });
        c.limit = () => Promise.resolve({ data: bd.pendientes, error: null });
        return c;
      },
    }),
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => '' }));
vi.mock('../src/services/pago-categoria-service.js', () => ({
  aplicarCategoriaAMovimientos: async (ids: string[], categoriaId: string | null) => {
    const falla = bd.categoriaFalla > 0;
    if (falla) bd.categoriaFalla -= 1;
    bd.categoria.push({ ids, categoriaId, falla });
    return falla ? { advertencia: 'no se pudo' } : {};
  },
}));
vi.mock('../src/services/pago-comision-service.js', () => ({
  aplicarComisionesDePago: async (e: unknown) => { bd.comisionesAplicadas.push(e); return bd.comisionRespuesta; },
  reintentarComisionDeBanca: async () => bd.reintentoComision.shift() ?? { ok: true },
}));

import {
  aplicarPasosEnBackend, repararPasosAnotados, reintentarPasosPendientes, advertenciaDePasos, MAX_INTENTOS_PASO,
} from '../src/services/pagos-pasos-service.js';
import {
  MENSAJE_CATEGORIA_NO_GUARDADA, MENSAJE_COMISION_NO_CARGADA, MENSAJE_COMPROBANTE_NO_GUARDADO,
} from '../src/utils/mensajes-pago-pasos.js';

const datos = {
  movimientoIds: ['m1', 'm2'], principalId: 'm1', grupoId: 'g1', categoriaId: 'cat', comprobantes: ['https://x/a.jpg'],
  lineas: [{ bancaId: 'b1', moneda: 'VES' as const, llevaComision: true }], usuarioId: 'u1',
};

beforeEach(() => {
  bd.insertError = null; bd.insertados = []; bd.actualizados = []; bd.pendientes = []; bd.updateComprobanteError = null;
  bd.categoria = []; bd.categoriaFalla = 0; bd.comisionesAplicadas = [];
  bd.comisionRespuesta = { comisiones: [], advertencia: undefined, bancasFallidas: undefined };
  bd.reintentoComision = [];
});

describe('aplicarPasosEnBackend (flujo sin envoltorio SQL)', () => {
  it('todo bien: aplica categoría, comprobante y comisión sin anotar nada', async () => {
    bd.comisionRespuesta = { comisiones: [{ bancaId: 'b1', movimientoId: 'c1', monto: 14 }] };
    const e = await aplicarPasosEnBackend(datos);
    expect(e).toEqual({ comisiones: [{ bancaId: 'b1', movimientoId: 'c1', monto: 14 }], pendientes: [], avisos: [] });
    expect(bd.categoria).toEqual([{ ids: ['m1', 'm2'], categoriaId: 'cat', falla: false }]);
    expect(bd.insertados).toHaveLength(0);
    expect(advertenciaDePasos(e)).toBeUndefined();
  });

  it('una categoría que falla se anota y se reintenta una vez; si el reintento sirve queda resuelta', async () => {
    bd.categoriaFalla = 1;
    const e = await aplicarPasosEnBackend(datos);
    expect(e.pendientes).toEqual([]);
    expect(bd.categoria.map(c => c.falla)).toEqual([true, false]);
    expect(bd.insertados).toHaveLength(1);
    expect(bd.insertados[0]).toMatchObject({
      tabla: 'pagos_pasos_pendientes', paso: 'categoria', grupo_id: 'g1', movimiento_id: 'm1',
      detalle: { movimientoIds: ['m1', 'm2'], categoriaId: 'cat' },
    });
    expect(bd.actualizados).toHaveLength(1);
    expect(bd.actualizados[0].cambios).toMatchObject({ intentos: 1, error: null });
    expect(bd.actualizados[0].cambios.resuelto_at).toBeTruthy();
  });

  it('si el reintento también falla queda pendiente con advertencia y la fila sin resolver', async () => {
    bd.categoriaFalla = 5;
    const e = await aplicarPasosEnBackend(datos);
    expect(e.pendientes).toEqual(['categoria']);
    expect(bd.categoria).toHaveLength(2); // 1 intento + 1 reintento, no más
    expect(advertenciaDePasos(e)).toBe(MENSAJE_CATEGORIA_NO_GUARDADA);
    expect(bd.actualizados[0].cambios).toMatchObject({ intentos: 1 });
    expect(bd.actualizados[0].cambios.resuelto_at).toBeUndefined();
  });

  it('un comprobante que no se guarda queda pendiente con su propio aviso', async () => {
    bd.updateComprobanteError = { message: 'storage' };
    const e = await aplicarPasosEnBackend({ ...datos, categoriaId: null, lineas: [] });
    expect(e.pendientes).toEqual(['comprobante']);
    expect(advertenciaDePasos(e)).toBe(MENSAJE_COMPROBANTE_NO_GUARDADO);
    expect(bd.insertados[0]).toMatchObject({ paso: 'comprobante', detalle: { movimientoId: 'm1', comprobantes: ['https://x/a.jpg'] } });
  });

  it('una comisión fallida se anota por cuenta y el reintento puede crearla', async () => {
    bd.comisionRespuesta = { comisiones: [], advertencia: 'x', bancasFallidas: ['b1'] };
    bd.reintentoComision = [{ ok: true, comision: { bancaId: 'b1', movimientoId: 'c9', monto: 14 } }];
    const e = await aplicarPasosEnBackend({ ...datos, categoriaId: null, comprobantes: [] });
    expect(e.pendientes).toEqual([]);
    expect(e.comisiones).toEqual([{ bancaId: 'b1', movimientoId: 'c9', monto: 14 }]);
    expect(bd.insertados[0]).toMatchObject({ paso: 'comision', detalle: { bancaId: 'b1', usuarioId: 'u1', grupoId: 'g1', movimientoIds: ['m1', 'm2'] } });
  });

  it('comisión que sigue fallando: pendiente y mensaje de comisión', async () => {
    bd.comisionRespuesta = { comisiones: [], advertencia: 'x', bancasFallidas: ['b1'] };
    bd.reintentoComision = [{ ok: false, error: 'rpc' }];
    const e = await aplicarPasosEnBackend({ ...datos, categoriaId: null, comprobantes: [] });
    expect(e.pendientes).toEqual(['comision']);
    expect(advertenciaDePasos(e)).toBe(MENSAJE_COMISION_NO_CARGADA);
  });

  it('un aviso de comisión sin cuentas fallidas (p. ej. categoría de la comisión) se propaga tal cual', async () => {
    bd.comisionRespuesta = { comisiones: [], advertencia: 'No se pudo asignar la categoría.' };
    const e = await aplicarPasosEnBackend({ ...datos, categoriaId: null, comprobantes: [] });
    expect(e.avisos).toEqual(['No se pudo asignar la categoría.']);
    expect(advertenciaDePasos(e)).toBe('No se pudo asignar la categoría.');
  });

  it('si la tabla de pendientes no existe igual se reintenta y no se lanza error', async () => {
    bd.insertError = { code: '42P01', message: 'relation "pagos_pasos_pendientes" does not exist' };
    bd.categoriaFalla = 5;
    const e = await aplicarPasosEnBackend(datos);
    expect(e.pendientes).toEqual(['categoria']);
    expect(bd.categoria).toHaveLength(2);
    expect(bd.actualizados).toHaveLength(0);
  });

  it('sin comisión pedida no se llama al servicio de comisiones', async () => {
    await aplicarPasosEnBackend({ ...datos, lineas: [] });
    expect(bd.comisionesAplicadas).toHaveLength(0);
  });
});

describe('repararPasosAnotados (filas que dejó la RPC *_completo)', () => {
  it('reintenta y resuelve las filas anotadas', async () => {
    bd.pendientes = [{
      id: 'p1', grupo_id: 'g1', movimiento_id: 'm1', paso: 'categoria', intentos: 0, error: 'x',
      detalle: { movimientoIds: ['m1'], categoriaId: 'cat' },
    }];
    const e = await repararPasosAnotados([{ id: 'p1', paso: 'categoria' }]);
    expect(e.pendientes).toEqual([]);
    expect(bd.insertados).toHaveLength(0); // ya estaba anotada: no se duplica
    expect(bd.actualizados[0]).toMatchObject({ id: 'p1', cambios: { intentos: 1 } });
  });

  it('un detalle mal formado no se reintenta a ciegas', async () => {
    bd.pendientes = [{ id: 'p2', grupo_id: 'g1', movimiento_id: null, paso: 'comision', intentos: 0, error: null, detalle: {} }];
    const e = await repararPasosAnotados([{ id: 'p2', paso: 'comision' }]);
    expect(e.pendientes).toEqual([]);
    expect(bd.actualizados).toHaveLength(0);
  });

  it('sin pasos anotados no consulta nada', async () => {
    expect(await repararPasosAnotados([])).toEqual({ comisiones: [], pendientes: [] });
  });
});

describe('reintentarPasosPendientes (cron)', () => {
  it('resuelve las que ahora funcionan y deja el conteo del resto', async () => {
    bd.pendientes = [
      { id: 'a', grupo_id: 'g', movimiento_id: 'm1', paso: 'categoria', intentos: 2, error: 'x', detalle: { movimientoIds: ['m1'], categoriaId: 'c' } },
      { id: 'b', grupo_id: 'g', movimiento_id: 'm1', paso: 'comision', intentos: MAX_INTENTOS_PASO - 1, error: 'y',
        detalle: { movimientoIds: ['m1'], grupoId: 'g', bancaId: 'b1', usuarioId: 'u' } },
    ];
    bd.reintentoComision = [{ ok: false, error: 'sigue' }];
    const r = await reintentarPasosPendientes();
    expect(r).toEqual({ revisados: 2, resueltos: 1, pendientes: 1 });
    expect(bd.actualizados.find(a => a.id === 'a')?.cambios).toMatchObject({ intentos: 3 });
    expect(bd.actualizados.find(a => a.id === 'b')?.cambios).toMatchObject({ intentos: MAX_INTENTOS_PASO, error: 'sigue' });
  });

  it('sin pendientes devuelve ceros', async () => {
    expect(await reintentarPasosPendientes()).toEqual({ revisados: 0, resueltos: 0, pendientes: 0 });
  });
});
