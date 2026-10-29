import { describe, it, expect, vi, beforeEach } from 'vitest';

type Args = Record<string, unknown>;

const bd = vi.hoisted(() => ({
  llamadas: [] as Array<{ nombre: string; args: Args }>,
  envoltorioDisponible: true,
  respuestaEnvoltorio: null as unknown,
  errorEnvoltorio: null as { code?: string; message: string } | null,
  respuestaOriginal: null as unknown,
  reparados: [] as unknown[],
  repararResultado: { comisiones: [] as unknown[], pendientes: [] as string[] },
  auditorias: [] as unknown[],
  categoriaComision: [] as string[][],
  pasosBackend: [] as unknown[],
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (nombre: string, args: Args) => {
      bd.llamadas.push({ nombre, args });
      if (nombre.endsWith('_completo')) {
        if (!bd.envoltorioDisponible) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
        return Promise.resolve({ data: bd.errorEnvoltorio ? null : bd.respuestaEnvoltorio, error: bd.errorEnvoltorio });
      }
      return Promise.resolve({ data: bd.respuestaOriginal, error: null });
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { grupo_id: 'g-orig' }, error: null }) }) }) }),
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => '' }));
vi.mock('../src/services/telegram-eventos-service.js', () => ({ notificarPago: vi.fn() }));
vi.mock('../src/utils/segundo-plano.js', () => ({ ejecutarEnSegundoPlano: vi.fn() }));
vi.mock('../src/services/montos-pago-service.js', () => ({ validarMontosDeLineas: async () => null }));
vi.mock('../src/services/pago-categoria-service.js', () => ({
  categoriaFijaDePago: async () => 'cat-pago',
  categoriaDelPago: async (elegida?: string | null) => ({ categoriaId: elegida ?? 'cat-pago' }),
  opcionesCategoriaCobro: async () => ({ categorias: [{ id: 'cat-cobro', nombre: 'NF', tipo: 'ingreso', activo: true }] }),
}));
vi.mock('../src/utils/categoria-pago-cobro.js', () => ({
  resolverCategoriaDeCobro: () => ({ categoriaId: 'cat-cobro' }),
}));
vi.mock('../src/services/comision-categoria-service.js', () => ({
  aplicarCategoriaAComisiones: async (ids: string[]) => { bd.categoriaComision.push(ids); return {}; },
}));
vi.mock('../src/services/pago-comision-service.js', () => ({
  conComisionAutomatica: async (lineas: Array<Record<string, unknown>>) => lineas.map(l => ({ ...l })),
  lineaCargaComision: (l: { llevaComision?: boolean; moneda: string; automatica?: boolean }) => l.llevaComision === true && (l.moneda === 'VES' || l.automatica === true),
  validarEleccionComisionPago: async () => null,
  auditarOmisiones: async (...a: unknown[]) => { bd.auditorias.push(a); },
}));
vi.mock('../src/services/pagos-pasos-service.js', () => ({
  repararPasosAnotados: async (a: unknown[]) => { bd.reparados.push(a); return bd.repararResultado; },
  aplicarPasosEnBackend: async (d: unknown) => { bd.pasosBackend.push(d); return { comisiones: [], pendientes: [], avisos: [] }; },
  advertenciaDePasos: (e: { pendientes: string[] }) => (e.pendientes.length > 0 ? `pendiente: ${e.pendientes.join(',')}` : undefined),
}));

import { registrarPago, registrarPagoMultiple } from '../src/services/pago-service.js';
import { registrarCobroMultiple } from '../src/services/cobro-service.js';
import type { RegistrarPagoInput, RegistrarPagoMultipleInput } from '../src/schemas/pagos.js';
import type { RegistrarCobroMultipleInput } from '../src/schemas/cobros.js';

const U = '11111111-1111-4111-8111-111111111111';
const B1 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const F1 = '44444444-4444-4444-8444-444444444444';
const REQ = '55555555-5555-4555-8555-555555555555';

const pagoSimple = (extra: Partial<RegistrarPagoInput> = {}): RegistrarPagoInput => ({
  proveedorId: P1, bancaId: B1, monto: 5000, moneda: 'VES', montoUsd: 10, descripcion: null, referencia: null,
  fecha: '2026-10-16', comprobantes: ['https://x/c.jpg'], llevaComision: true, ...extra,
});
const pagoMulti = (extra: Partial<RegistrarPagoMultipleInput> = {}): RegistrarPagoMultipleInput => ({
  proveedorId: P1, bancas: [{ bancaId: B1, monto: 5000, moneda: 'VES', montoUsd: 100, referencia: null, llevaComision: true }],
  montoUsd: 100, descripcion: null, referencia: null, fecha: '2026-10-16',
  items: [{ tipo: 'factura', id: F1, montoUsd: 100 }], comprobantes: ['https://x/c.jpg'], ...extra,
});
const cobroMulti = (extra: Partial<RegistrarCobroMultipleInput> = {}): RegistrarCobroMultipleInput => ({
  clienteId: P1, bancas: [{ bancaId: B1, monto: 100, moneda: 'USD', montoUsd: 100, referencia: null }], montoUsd: 100,
  descripcion: null, referencia: null, fecha: '2026-10-16', items: [{ tipo: 'factura', id: F1, montoUsd: 100 }],
  comprobantes: ['https://x/c.jpg'], categoriaId: 'cat-cobro', ...extra,
});

const multiResp = {
  movimientoPrincipalId: 'm1', movimientoIds: ['m1', 'm2'], grupoId: 'g1', numeroPago: 5, numeroAdelanto: null, numeroCruce: null,
};

beforeEach(() => {
  bd.llamadas = []; bd.envoltorioDisponible = true; bd.errorEnvoltorio = null; bd.respuestaOriginal = null;
  bd.reparados = []; bd.repararResultado = { comisiones: [], pendientes: [] }; bd.auditorias = []; bd.categoriaComision = []; bd.pasosBackend = [];
  bd.respuestaEnvoltorio = { ...multiResp, comisiones: [], pasosPendientes: [] };
});

describe('pago combinado con el envoltorio SQL', () => {
  it('manda en UNA llamada el pago, la clave, la categoría, los comprobantes y las cuentas con comisión', async () => {
    const r = await registrarPagoMultiple(pagoMulti({ clientRequestId: REQ }), U);
    expect(bd.llamadas).toHaveLength(1);
    expect(bd.llamadas[0].nombre).toBe('registrar_pago_proveedor_multi_banca_completo');
    expect(bd.llamadas[0].args).toMatchObject({
      p_client_request_id: REQ, p_proveedor_id: P1, p_categoria_id: 'cat-pago',
      p_comprobantes: ['https://x/c.jpg'], p_bancas_con_comision: [B1], p_registrado_por: U,
    });
    expect(r).toMatchObject({ grupoId: 'g1', numeroPago: 5, categoriaId: 'cat-pago', comisiones: [] });
    expect('advertencia' in r).toBe(false);
    expect(bd.pasosBackend).toHaveLength(0); // los pasos ya los hizo la BD
  });

  it('sin clientRequestId manda p_client_request_id null (cliente viejo)', async () => {
    await registrarPagoMultiple(pagoMulti(), U);
    expect(bd.llamadas[0].args.p_client_request_id).toBeNull();
  });

  it('devuelve las comisiones creadas por la BD y les pone la categoría', async () => {
    bd.respuestaEnvoltorio = { ...multiResp, comisiones: [{ bancaId: B1, movimientoId: 'c1', monto: 14 }], pasosPendientes: [] };
    const r = await registrarPagoMultiple(pagoMulti(), U);
    expect(r).toMatchObject({ comisiones: [{ bancaId: B1, movimientoId: 'c1', monto: 14 }] });
    expect(bd.categoriaComision).toEqual([['c1']]);
  });

  it('un paso que la BD anotó como pendiente se reintenta de inmediato; si se resuelve no hay advertencia', async () => {
    bd.respuestaEnvoltorio = { ...multiResp, comisiones: [], pasosPendientes: [{ id: 'p1', paso: 'comision' }] };
    bd.repararResultado = { comisiones: [{ bancaId: B1, movimientoId: 'c2', monto: 14 }], pendientes: [] };
    const r = await registrarPagoMultiple(pagoMulti(), U);
    expect(bd.reparados).toEqual([[{ id: 'p1', paso: 'comision' }]]);
    expect(r).toMatchObject({ comisiones: [{ movimientoId: 'c2' }] });
    expect('advertencia' in r).toBe(false);
  });

  it('si el paso sigue pendiente tras el reintento la respuesta trae advertencia', async () => {
    bd.respuestaEnvoltorio = { ...multiResp, comisiones: [], pasosPendientes: [{ id: 'p1', paso: 'categoria' }] };
    bd.repararResultado = { comisiones: [], pendientes: ['categoria'] };
    const r = await registrarPagoMultiple(pagoMulti(), U);
    expect(r).toMatchObject({ advertencia: 'pendiente: categoria' });
  });

  it('un error de negocio de la RPC se devuelve tal cual', async () => {
    bd.errorEnvoltorio = { message: 'Saldo insuficiente' };
    expect(await registrarPagoMultiple(pagoMulti(), U)).toEqual({ error: 'Saldo insuficiente' });
  });

  it('audita la omisión de comisión con el grupo que devolvió la BD', async () => {
    await registrarPagoMultiple(pagoMulti({ bancas: [{ bancaId: B1, monto: 5000, moneda: 'VES', montoUsd: 100, referencia: null, llevaComision: false }] }), U);
    expect(bd.auditorias[0]).toEqual([[{ bancaId: B1, moneda: 'VES', llevaComision: false }], 'g1', U]);
  });
});

describe('sin la migración (envoltorio inexistente) se usa el flujo anterior', () => {
  beforeEach(() => { bd.envoltorioDisponible = false; });

  it('pago combinado: RPC original y pasos desde el backend', async () => {
    bd.respuestaOriginal = multiResp;
    const r = await registrarPagoMultiple(pagoMulti({ clientRequestId: REQ }), U);
    expect(bd.llamadas.map(l => l.nombre)).toEqual(['registrar_pago_proveedor_multi_banca_completo', 'registrar_pago_proveedor_multi_banca']);
    expect(bd.llamadas[1].args).not.toHaveProperty('p_client_request_id');
    expect(bd.pasosBackend).toEqual([expect.objectContaining({
      movimientoIds: ['m1', 'm2'], principalId: 'm1', grupoId: 'g1', categoriaId: 'cat-pago', comprobantes: ['https://x/c.jpg'], usuarioId: U,
    })]);
    expect(r).toMatchObject({ grupoId: 'g1', categoriaId: 'cat-pago' });
  });

  it('un error de la RPC original se devuelve', async () => {
    bd.respuestaOriginal = null;
    expect(await registrarPagoMultiple(pagoMulti(), U)).toEqual({ error: 'No se pudo registrar el pago.' });
  });
});

describe('pago simple', () => {
  it('con envoltorio: manda p_con_comision y devuelve movimientoId y comisión', async () => {
    bd.respuestaEnvoltorio = { movimientoId: 'm9', grupoId: 'g9', comisiones: [{ bancaId: B1, movimientoId: 'c9', monto: 14 }], pasosPendientes: [] };
    const r = await registrarPago(pagoSimple({ clientRequestId: REQ }), U);
    expect(bd.llamadas[0]).toMatchObject({ nombre: 'registrar_pago_proveedor_completo', args: { p_client_request_id: REQ, p_con_comision: true, p_categoria_id: 'cat-pago' } });
    expect(r).toEqual({ movimientoId: 'm9', comision: { bancaId: B1, movimientoId: 'c9', monto: 14 } });
  });

  it('en USD nunca pide comisión', async () => {
    bd.respuestaEnvoltorio = { movimientoId: 'm9', grupoId: 'g9', comisiones: [], pasosPendientes: [] };
    await registrarPago(pagoSimple({ moneda: 'USD', monto: 10, llevaComision: true }), U);
    expect(bd.llamadas[0].args.p_con_comision).toBe(false);
  });

  it('flujo anterior: la RPC devuelve el id y el grupo se resuelve para la comisión en Bs', async () => {
    bd.envoltorioDisponible = false;
    bd.respuestaOriginal = 'm7';
    const r = await registrarPago(pagoSimple(), U);
    expect(r).toEqual({ movimientoId: 'm7' });
    expect(bd.pasosBackend[0]).toMatchObject({ movimientoIds: ['m7'], principalId: 'm7', grupoId: 'g-orig' });
  });
});

describe('cobro combinado', () => {
  it('con envoltorio: clave, categoría y comprobantes; sin cuentas con comisión', async () => {
    bd.respuestaEnvoltorio = { ...multiResp, numeroCobro: 3, numeroAnticipo: null, comisiones: [], pasosPendientes: [] };
    const r = await registrarCobroMultiple(cobroMulti({ clientRequestId: REQ }), U);
    expect(bd.llamadas[0]).toMatchObject({
      nombre: 'registrar_cobro_cliente_multi_banca_completo',
      args: { p_client_request_id: REQ, p_cliente_id: P1, p_categoria_id: 'cat-cobro', p_comprobantes: ['https://x/c.jpg'] },
    });
    expect(bd.llamadas[0].args).not.toHaveProperty('p_bancas_con_comision');
    expect(r).toMatchObject({ grupoId: 'g1', categoriaId: 'cat-cobro' });
  });

  it('un paso pendiente llega como advertencia', async () => {
    bd.respuestaEnvoltorio = { ...multiResp, comisiones: [], pasosPendientes: [{ id: 'p5', paso: 'comprobante' }] };
    bd.repararResultado = { comisiones: [], pendientes: ['comprobante'] };
    expect(await registrarCobroMultiple(cobroMulti(), U)).toMatchObject({ advertencia: 'pendiente: comprobante' });
  });

  it('flujo anterior: RPC original + pasos del backend', async () => {
    bd.envoltorioDisponible = false;
    bd.respuestaOriginal = { ...multiResp, numeroCobro: 3 };
    await registrarCobroMultiple(cobroMulti(), U);
    expect(bd.llamadas[1].nombre).toBe('registrar_cobro_cliente_multi_banca');
    expect(bd.pasosBackend[0]).toMatchObject({ categoriaId: 'cat-cobro', lineas: [] });
  });
});
