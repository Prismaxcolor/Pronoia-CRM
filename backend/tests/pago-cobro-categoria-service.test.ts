import { describe, it, expect, vi, beforeEach } from 'vitest';

type ErrorBd = { code?: string; message: string } | null;
const bd = vi.hoisted(() => ({
  rpcResultado: null as unknown,
  rpcError: null as ErrorBd,
  errorUpdate: null as ErrorBd,
  rpcLlamadas: [] as Array<{ nombre: string; args: Record<string, unknown> }>,
  updates: [] as Array<{ tabla: string; valores: Record<string, unknown>; ids: unknown }>,
  usos: {} as Record<string, unknown>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (nombre: string, args: Record<string, unknown>) => {
      bd.rpcLlamadas.push({ nombre, args });
      return Promise.resolve({ data: bd.rpcError ? null : bd.rpcResultado, error: bd.rpcError });
    },
    from: (tabla: string) => ({
      update: (valores: Record<string, unknown>) => {
        const fila = { tabla, valores, ids: null as unknown };
        bd.updates.push(fila);
        const resolver = () => Promise.resolve({ data: null, error: bd.errorUpdate });
        const c: Record<string, unknown> = {
          in: (_k: string, ids: unknown) => { fila.ids = ids; return resolver(); },
          eq: (_k: string, id: unknown) => { fila.ids = [id]; return resolver(); },
        };
        return c;
      },
    }),
  },
}));
vi.mock('../src/services/categorias-uso-service.js', () => ({
  categoriasDeUso: async (uso: string) => bd.usos[uso] ?? { categorias: [] },
}));
vi.mock('../src/services/telegram-eventos-service.js', () => ({ notificarPago: vi.fn() }));
vi.mock('../src/utils/segundo-plano.js', () => ({ ejecutarEnSegundoPlano: vi.fn() }));

import { registrarPago, registrarPagoMultiple } from '../src/services/pago-service.js';
import { registrarCobroMultiple } from '../src/services/cobro-service.js';
import { opcionesCategoriaCobro } from '../src/services/pago-categoria-service.js';
import type { RegistrarCobroMultipleInput } from '../src/schemas/cobros.js';
import type { RegistrarPagoInput, RegistrarPagoMultipleInput } from '../src/schemas/pagos.js';

const cat = (id: string, tipo: string) => ({ id, nombre: id, tipo, color: '#15803D', padreId: null, activo: true, creadoEn: '2026-10-12' });
const MATERIA = cat('materia', 'EGRESO');
const NF = cat('nf', 'INGRESO');
const PCB = cat('pcb', 'INGRESO');
const resultadoRpc = { movimientoPrincipalId: 'm1', movimientoIds: ['m1', 'm2'], grupoId: 'g1', numeroPago: 5, numeroAdelanto: 2, numeroCruce: null };
const banca = { bancaId: 'b1', monto: 10, montoUsd: 10, moneda: 'USD' as const, referencia: null };

const pagoMulti = (extra: Partial<RegistrarPagoMultipleInput> = {}): RegistrarPagoMultipleInput =>
  ({ proveedorId: 'p1', bancas: [banca], montoUsd: 10, descripcion: null, referencia: null, fecha: '2026-10-12', items: [], comprobantes: [], ...extra });
const cobroMulti = (extra: Partial<RegistrarCobroMultipleInput> = {}): RegistrarCobroMultipleInput =>
  ({ clienteId: 'c1', bancas: [banca], montoUsd: 10, descripcion: null, referencia: null, fecha: '2026-10-12', items: [], comprobantes: [], ...extra });
const pagoSimple: RegistrarPagoInput =
  { proveedorId: 'p1', bancaId: 'b1', monto: 10, moneda: 'USD', montoUsd: 10, descripcion: null, referencia: null, fecha: '2026-10-12', facturaId: 'f1', comprobantes: [] };

beforeEach(() => {
  bd.rpcResultado = resultadoRpc; bd.rpcError = null; bd.errorUpdate = null;
  bd.rpcLlamadas = []; bd.updates = []; bd.usos = {};
});

describe('registrarPagoMultiple: categoría fija', () => {
  it('aplica la categoría de pago a todas las filas de dinero (pago y adelanto)', async () => {
    bd.usos.pago_proveedor = { categorias: [MATERIA] };
    const r = await registrarPagoMultiple(pagoMulti(), 'u1');
    expect(r).toMatchObject({ grupoId: 'g1', categoriaId: 'materia' });
    expect('advertencia' in r).toBe(false);
    expect(bd.updates).toEqual([{ tabla: 'movimientos', valores: { categoria_id: 'materia' }, ids: ['m1', 'm2'] }]);
  });
  it('sin categoría configurada funciona como antes, sin update', async () => {
    const r = await registrarPagoMultiple(pagoMulti(), 'u1');
    expect(r).toMatchObject({ grupoId: 'g1', categoriaId: null });
    expect(bd.updates).toHaveLength(0);
  });
  it('si la tabla de usos falla (error) el pago se registra igual sin categoría', async () => {
    bd.usos.pago_proveedor = { error: 'caída' };
    const r = await registrarPagoMultiple(pagoMulti(), 'u1');
    expect(r).toMatchObject({ categoriaId: null });
    expect(bd.updates).toHaveLength(0);
  });
  it('un cruce puro (sin bancas) no lleva categoría', async () => {
    bd.usos.pago_proveedor = { categorias: [MATERIA] };
    bd.rpcResultado = { ...resultadoRpc, movimientoPrincipalId: null, movimientoIds: [], numeroCruce: 3 };
    const r = await registrarPagoMultiple(pagoMulti({ bancas: [], montoUsd: 0 }), 'u1');
    expect(r).toMatchObject({ categoriaId: null });
    expect(bd.updates).toHaveLength(0);
  });
  it('si el update falla el pago queda registrado con una advertencia', async () => {
    bd.usos.pago_proveedor = { categorias: [MATERIA] };
    bd.errorUpdate = { message: 'trigger' };
    const r = await registrarPagoMultiple(pagoMulti(), 'u1');
    expect(r).toMatchObject({ grupoId: 'g1', categoriaId: 'materia', advertencia: expect.stringContaining('categoría') });
  });
  it('si la RPC falla devuelve el error y no toca movimientos', async () => {
    bd.usos.pago_proveedor = { categorias: [MATERIA] };
    bd.rpcError = { message: 'sin fondos' };
    expect(await registrarPagoMultiple(pagoMulti(), 'u1')).toEqual({ error: 'sin fondos' });
    expect(bd.updates).toHaveLength(0);
  });
});

describe('registrarPago (pago simple a una factura)', () => {
  it('aplica la categoría fija al movimiento creado', async () => {
    bd.usos.pago_proveedor = { categorias: [MATERIA] };
    bd.rpcResultado = 'mov-9';
    const r = await registrarPago(pagoSimple, 'u1');
    expect(r).toEqual({ movimientoId: 'mov-9' });
    expect(bd.updates[0]).toMatchObject({ valores: { categoria_id: 'materia' }, ids: ['mov-9'] });
  });
});

describe('registrarCobroMultiple: categoría elegida', () => {
  beforeEach(() => { bd.usos.cobro_cliente = { categorias: [NF, PCB] }; });

  it('exige categoría cuando el cobro mueve dinero y no registra nada', async () => {
    const r = await registrarCobroMultiple(cobroMulti(), 'u1');
    expect(r).toEqual({ error: expect.stringContaining('categoría') });
    expect(bd.rpcLlamadas).toHaveLength(0);
  });
  it('rechaza una categoría que no es del uso cobro_cliente', async () => {
    const r = await registrarCobroMultiple(cobroMulti({ categoriaId: 'materia' }), 'u1');
    expect('error' in r).toBe(true);
    expect(bd.rpcLlamadas).toHaveLength(0);
  });
  it('aplica la categoría elegida a todas las filas (cobro y anticipo)', async () => {
    bd.rpcResultado = { ...resultadoRpc, numeroCobro: 4, numeroAnticipo: 1 };
    const r = await registrarCobroMultiple(cobroMulti({ categoriaId: 'pcb' }), 'u1');
    expect(r).toMatchObject({ categoriaId: 'pcb', grupoId: 'g1' });
    expect(bd.updates).toEqual([{ tabla: 'movimientos', valores: { categoria_id: 'pcb' }, ids: ['m1', 'm2'] }]);
  });
  it('un cruce puro no pide ni aplica categoría', async () => {
    bd.rpcResultado = { ...resultadoRpc, movimientoPrincipalId: null, movimientoIds: [], numeroCruce: 2 };
    const r = await registrarCobroMultiple(cobroMulti({ bancas: [], montoUsd: 0 }), 'u1');
    expect(r).toMatchObject({ categoriaId: null });
    expect(bd.updates).toHaveLength(0);
  });
  it('sin categorías configuradas el cobro funciona como hoy', async () => {
    bd.usos.cobro_cliente = { categorias: [] };
    const r = await registrarCobroMultiple(cobroMulti(), 'u1');
    expect(r).toMatchObject({ categoriaId: null, grupoId: 'g1' });
    expect(bd.updates).toHaveLength(0);
  });
  it('si no se pueden leer las categorías no registra el cobro a ciegas', async () => {
    bd.usos.cobro_cliente = { error: 'No se pudieron leer las categorías de esta operación.' };
    const r = await registrarCobroMultiple(cobroMulti({ categoriaId: 'nf' }), 'u1');
    expect('error' in r).toBe(true);
    expect(bd.rpcLlamadas).toHaveLength(0);
  });
  it('advertencia si el update falla tras registrar', async () => {
    bd.errorUpdate = { message: 'trigger' };
    const r = await registrarCobroMultiple(cobroMulti({ categoriaId: 'nf' }), 'u1');
    expect(r).toMatchObject({ categoriaId: 'nf', advertencia: expect.stringContaining('categoría') });
  });
});

describe('opcionesCategoriaCobro', () => {
  it('lista solo las categorías que admiten ingresos', async () => {
    bd.usos.cobro_cliente = { categorias: [NF, MATERIA, PCB] };
    const r = await opcionesCategoriaCobro();
    expect('categorias' in r && r.categorias.map(c => c.id)).toEqual(['nf', 'pcb']);
  });
  it('vacío si no hay nada configurado y error si falla la lectura', async () => {
    expect(await opcionesCategoriaCobro()).toEqual({ categorias: [] });
    bd.usos.cobro_cliente = { error: 'x' };
    expect(await opcionesCategoriaCobro()).toEqual({ error: 'x' });
  });
});
