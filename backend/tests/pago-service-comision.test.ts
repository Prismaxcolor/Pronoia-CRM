import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registrarPagoMultipleSchema, registrarPagoSchema } from '../src/schemas/pagos.js';
import { registrarCobroMultipleSchema } from '../src/schemas/cobros.js';

const bd = vi.hoisted(() => ({
  rechazo: null as string | null,
  rpcResultado: { movimientoPrincipalId: 'm1', movimientoIds: ['m1', 'm2'], grupoId: 'g1', numeroPago: 5, numeroAdelanto: null, numeroCruce: null } as Record<string, unknown>,
  comisionesCreadas: [{ bancaId: 'b1', movimientoId: 'c1', monto: 14 }] as Array<{ bancaId: string; movimientoId: string; monto: number }>,
  avisoComision: undefined as string | undefined,
  rpcLlamadas: 0,
  validadas: [] as unknown[],
  aplicadas: [] as unknown[],
  categorias: [] as unknown[],
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: () => { bd.rpcLlamadas += 1; return Promise.resolve({ data: bd.rpcResultado, error: null }); },
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }), in: () => Promise.resolve({ error: null }) }) }),
  },
}));
vi.mock('../src/services/telegram-eventos-service.js', () => ({ notificarPago: vi.fn() }));
vi.mock('../src/utils/segundo-plano.js', () => ({ ejecutarEnSegundoPlano: vi.fn() }));
vi.mock('../src/services/pago-categoria-service.js', () => ({
  categoriaFijaDePago: async () => 'materia',
  aplicarCategoriaAMovimientos: async (ids: string[], categoriaId: string | null) => { bd.categorias.push({ ids, categoriaId }); return {}; },
}));
vi.mock('../src/services/pago-comision-service.js', () => ({
  validarEleccionComisionPago: async (lineas: unknown) => { bd.validadas.push(lineas); return bd.rechazo; },
  aplicarComisionesDePago: async (e: unknown) => {
    bd.aplicadas.push(e);
    return { comisiones: bd.comisionesCreadas, ...(bd.avisoComision ? { advertencia: bd.avisoComision } : {}) };
  },
}));

import { registrarPagoMultiple } from '../src/services/pago-service.js';
import type { RegistrarPagoMultipleInput } from '../src/schemas/pagos.js';

const U = '11111111-1111-4111-8111-111111111111';
const B1 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const F1 = '44444444-4444-4444-8444-444444444444';

const entrada = (llevaComision?: boolean): RegistrarPagoMultipleInput => ({
  proveedorId: P1,
  bancas: [{ bancaId: B1, monto: 5000, moneda: 'VES', montoUsd: 100, referencia: null, llevaComision }],
  montoUsd: 100, descripcion: null, referencia: null, fecha: '2026-10-16',
  items: [{ tipo: 'factura', id: F1, montoUsd: 100 }], comprobantes: [],
});

beforeEach(() => {
  bd.rechazo = null; bd.avisoComision = undefined; bd.rpcLlamadas = 0;
  bd.validadas = []; bd.aplicadas = []; bd.categorias = [];
});

describe('registrarPagoMultiple con comisión bancaria', () => {
  it('valida la elección antes de mover dinero y rechaza sin llamar a la RPC de pago', async () => {
    bd.rechazo = 'Indica si el pago lleva comisión.';
    const r = await registrarPagoMultiple(entrada(), U);
    expect(r).toEqual({ error: 'Indica si el pago lleva comisión.' });
    expect(bd.rpcLlamadas).toBe(0);
    expect(bd.aplicadas).toHaveLength(0);
    expect(bd.validadas).toEqual([[{ bancaId: B1, moneda: 'VES', llevaComision: undefined }]]);
  });

  it('con Sí devuelve las comisiones creadas y las pasa con el grupo, los movimientos y el usuario', async () => {
    const r = await registrarPagoMultiple(entrada(true), U);
    expect(r).toMatchObject({ grupoId: 'g1', categoriaId: 'materia', comisiones: [{ bancaId: 'b1', movimientoId: 'c1', monto: 14 }] });
    expect(bd.aplicadas).toEqual([{ movimientoIds: ['m1', 'm2'], grupoId: 'g1', usuarioId: U, lineas: [{ bancaId: B1, moneda: 'VES', llevaComision: true }] }]);
    expect(bd.categorias).toEqual([{ ids: ['m1', 'm2'], categoriaId: 'materia' }]);
  });

  it('una advertencia de la comisión llega al resultado sin deshacer el pago', async () => {
    bd.avisoComision = 'No se pudo cargar la comisión.';
    const r = await registrarPagoMultiple(entrada(true), U);
    expect(r).toMatchObject({ grupoId: 'g1', advertencia: 'No se pudo cargar la comisión.' });
  });
});

describe('esquemas: llevaComision solo en pagos a proveedor', () => {
  const base = { proveedorId: P1, montoUsd: 100, fecha: '2026-10-16', items: [{ tipo: 'factura', id: F1, montoUsd: 100 }] };
  const banca = { bancaId: B1, monto: 5000, moneda: 'VES', montoUsd: 100 };

  it('el pago múltiple conserva llevaComision por cuenta', () => {
    const r = registrarPagoMultipleSchema.parse({ ...base, bancas: [{ ...banca, llevaComision: true }] });
    expect(r.bancas[0].llevaComision).toBe(true);
  });
  it('el pago múltiple acepta que falte (el servicio decide si es obligatoria)', () => {
    expect(registrarPagoMultipleSchema.parse({ ...base, bancas: [banca] }).bancas[0].llevaComision).toBeUndefined();
  });
  it('rechaza un valor que no es booleano', () => {
    expect(registrarPagoMultipleSchema.safeParse({ ...base, bancas: [{ ...banca, llevaComision: 'si' }] }).success).toBe(false);
  });
  it('el pago simple acepta llevaComision', () => {
    const r = registrarPagoSchema.parse({ proveedorId: P1, bancaId: B1, monto: 5000, moneda: 'VES', montoUsd: 100, fecha: '2026-10-16', llevaComision: false });
    expect(r.llevaComision).toBe(false);
  });
  it('los cobros ignoran llevaComision (no aplica a ingresos)', () => {
    const r = registrarCobroMultipleSchema.parse({ clienteId: P1, ...base, bancas: [{ ...banca, llevaComision: true }] });
    expect('llevaComision' in r.bancas[0]).toBe(false);
  });
});
