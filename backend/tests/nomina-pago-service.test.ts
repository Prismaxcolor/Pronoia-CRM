import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Nomina, PagoNomina } from '../../shared/types/nomina';

type Fila = Record<string, unknown>;
type ErrorBd = { code?: string; message: string };
const bd = vi.hoisted(() => ({
  bancas: [] as Fila[],
  pagosTabla: { data: [] as Fila[], error: null as null | { code?: string; message: string } },
  nominaFila: null as Fila | null,
  rpcResultado: { data: null as unknown, error: null as null | { code?: string; message: string } },
  rpc: vi.fn(),
  categorias: { categorias: [] as Array<Record<string, unknown>> } as { categorias: Array<Record<string, unknown>> } | { error: string },
  comision: true,
  auditoria: vi.fn(),
  logs: [] as unknown[],
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: (p: unknown) => bd.logs.push(p), warn: (p: unknown) => bd.logs.push(p), error: (p: unknown) => bd.logs.push(p) },
}));
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'order', 'limit', 'in']) c[m] = () => c;
      c.maybeSingle = () => Promise.resolve({ data: tabla === 'nominas' ? bd.nominaFila : null, error: null });
      c.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(tabla === 'nomina_pagos' ? bd.pagosTabla : { data: bd.bancas, error: null }).then(ok);
      return c;
    },
    rpc: (nombre: string, args: unknown) => {
      bd.rpc(nombre, args);
      return Promise.resolve(bd.rpcResultado);
    },
  },
}));
vi.mock('../src/services/categorias-uso-service.js', () => ({ categoriasDeUso: async () => bd.categorias }));
vi.mock('../src/services/movimiento-comision-service.js', () => ({ comisionBancariaDisponible: async () => bd.comision }));
vi.mock('../src/services/auditoria-service.js', () => ({ registrarAuditoria: (e: unknown) => bd.auditoria(e) }));

import { categoriaDePagoNomina, pagarNomina } from '../src/services/nomina-pago-service';
import { obtenerNomina } from '../src/services/nomina-service';
import { pagarNominaSchema } from '../src/schemas/nomina';

const NOMINA = '44444444-4444-4444-8444-444444444444';
const USUARIO = '55555555-5555-4555-8555-555555555555';
const B_USD = '11111111-1111-4111-8111-111111111111';
const B_VES = '22222222-2222-4222-8222-222222222222';
const MOV_USD = '66666666-6666-4666-8666-666666666666';
const MOV_BS = '77777777-7777-4777-8777-777777777777';
const CAT = '88888888-8888-4888-8888-888888888888';

const filaNomina = (estado: string, tipo = 'OPERATIVO'): Fila => ({
  id: NOMINA, numero: 7, tipo, semana_inicio: '2026-10-05', tasa_bs: 40, estado, version: 2,
  cantidad_divisas: 1, cantidad_bs: 1, total_divisas_usd: 100, total_bs: 2000, total_equivalente_usd: 50,
  total_combinado_usd: 150, total_combinado_bs: 6000,
  lineas: [
    { trabajador_id: 't1', trabajador_nombre: 'Ana', moneda_pago: 'USD', dias_trabajados: 5, monto_base_usd: 20, total_bruto_usd: 100, bonificacion_usd: 0, descuento_trabajo_usd: 0, descuento_prestamo_usd: 0, total_usd: 100, total_bs: 4000, cuotas: [] },
    { trabajador_id: 't2', trabajador_nombre: 'Luis', moneda_pago: 'BS', dias_trabajados: 5, monto_base_usd: 10, total_bruto_usd: 50, bonificacion_usd: 0, descuento_trabajo_usd: 0, descuento_prestamo_usd: 0, total_usd: 50, total_bs: 2000, cuotas: [] },
  ],
});

const filaPago = (moneda: 'USD' | 'BS', movimientoId: string, extra: Fila = {}): Fila => ({
  id: `pago-${moneda}`, moneda_pago: moneda, banca_id: moneda === 'USD' ? B_USD : B_VES, movimiento_id: movimientoId,
  monto: moneda === 'USD' ? 100 : 2000, monto_usd: moneda === 'USD' ? 100 : 50, cantidad: 1, fecha: '2026-10-09', referencia: null,
  created_at: '2026-10-09T15:00:00Z', banca: { nombre: moneda === 'USD' ? 'CAJA CHICA' : 'CAJA BS' }, movimiento: { numero_sistema: 12, anulado: false }, ...extra,
});

const entrada = (bancas: unknown[], extra: Record<string, unknown> = {}) => pagarNominaSchema.parse({ fecha: '2026-10-09', bancas, ...extra });
const ambas = () => entrada([{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: true }]);

beforeEach(() => {
  bd.bancas = [
    { id: B_USD, nombre: 'CAJA CHICA', moneda: 'USD', archivada: false },
    { id: B_VES, nombre: 'CAJA BS', moneda: 'VES', archivada: false },
  ];
  bd.pagosTabla = { data: [], error: null };
  bd.nominaFila = filaNomina('CERRADA');
  bd.rpcResultado = { data: { yaPagada: false, pagos: [{ movimientoId: MOV_USD, sinComision: false }, { movimientoId: MOV_BS, sinComision: false }] }, error: null };
  bd.categorias = { categorias: [{ id: CAT, nombre: 'NOMINA PERSONAL OPERATIVO', tipo: 'EGRESO', activo: true, padreId: null }] };
  bd.comision = true;
  bd.rpc.mockClear();
  bd.auditoria.mockReset();
  bd.auditoria.mockResolvedValue(true);
  bd.logs = [];
});

describe('obtenerNomina con pagos', () => {
  it('una nómina cerrada trae sus pagos con cuenta, correlativo y estado del egreso', async () => {
    bd.pagosTabla = { data: [filaPago('USD', MOV_USD), filaPago('BS', MOV_BS, { movimiento: { numero_sistema: 13, anulado: true } })], error: null };
    const r = await obtenerNomina(NOMINA);
    if ('error' in r) throw new Error(r.error);
    expect(r.nomina.pagos).toHaveLength(2);
    const [usd, bs] = r.nomina.pagos as [PagoNomina, PagoNomina];
    expect(usd).toMatchObject({ monedaPago: 'USD', bancaNombre: 'CAJA CHICA', movimientoNumero: 12, monto: 100, anulado: false });
    expect(bs).toMatchObject({ monedaPago: 'BS', monto: 2000, montoUsd: 50, anulado: true });
  });

  it('un borrador no consulta pagos', async () => {
    bd.nominaFila = filaNomina('BORRADOR');
    bd.pagosTabla = { data: [filaPago('USD', MOV_USD)], error: null };
    const r = await obtenerNomina(NOMINA);
    expect('nomina' in r && r.nomina.pagos).toEqual([]);
  });

  it('sin la migración (tabla inexistente) la nómina se ve sin pagos', async () => {
    bd.pagosTabla = { data: [], error: { code: '42P01', message: 'relation "nomina_pagos" does not exist' } };
    const r = await obtenerNomina(NOMINA);
    expect('nomina' in r && r.nomina.pagos).toEqual([]);
  });

  it('un error real de lectura se propaga (no se muestra "sin pagar")', async () => {
    bd.pagosTabla = { data: [], error: { code: 'XX000', message: 'boom interno' } };
    const r = await obtenerNomina(NOMINA);
    expect(r).toMatchObject({ codigo: 500 });
    expect(JSON.stringify(r)).not.toContain('boom');
  });
});

describe('categoriaDePagoNomina', () => {
  it('devuelve la categoría asignada al tipo de personal', async () => {
    expect(await categoriaDePagoNomina('OPERATIVO')).toEqual({ categoria: { id: CAT, nombre: 'NOMINA PERSONAL OPERATIVO' } });
  });

  it('sin categoría asignada, o asignada de solo ingresos: null', async () => {
    bd.categorias = { categorias: [] };
    expect(await categoriaDePagoNomina('ADMINISTRATIVO')).toEqual({ categoria: null });
    bd.categorias = { categorias: [{ id: CAT, nombre: 'INGRESOS', tipo: 'INGRESO', activo: true, padreId: null }] };
    expect(await categoriaDePagoNomina('ADMINISTRATIVO')).toEqual({ categoria: null });
  });

  it('un error al leer las categorías es 503 (no se paga sin saber la categoría)', async () => {
    bd.categorias = { error: 'falló' };
    expect(await categoriaDePagoNomina('OPERATIVO')).toMatchObject({ codigo: 503 });
  });
});

describe('pagarNomina', () => {
  it('llama UNA vez a nomina_pagar con la categoría del tipo y las cuentas; nunca manda montos', async () => {
    bd.nominaFila = filaNomina('CERRADA');
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    if ('error' in r) throw new Error(r.error);
    expect(r.yaPagada).toBe(false);
    expect(bd.rpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = bd.rpc.mock.calls[0];
    expect(nombre).toBe('nomina_pagar');
    expect(args).toEqual({
      p_nomina_id: NOMINA,
      p_usuario: USUARIO,
      p_datos: {
        fecha: '2026-10-09', referencia: null, categoriaId: CAT,
        pagos: [{ moneda: 'USD', bancaId: B_USD, llevaComision: null }, { moneda: 'BS', bancaId: B_VES, llevaComision: true }],
      },
    });
  });

  it('sin categoría asignada se paga igual, con categoriaId null', async () => {
    bd.categorias = { categorias: [] };
    await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(bd.rpc.mock.calls[0][1].p_datos.categoriaId).toBeNull();
  });

  it('ya pagada: devuelve yaPagada sin llamar a la BD de escritura (idempotente)', async () => {
    bd.pagosTabla = { data: [filaPago('USD', MOV_USD), filaPago('BS', MOV_BS)], error: null };
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(r).toMatchObject({ yaPagada: true });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('si la BD responde yaPagada (otra persona pagó a la vez), se informa sin error', async () => {
    bd.rpcResultado = { data: { yaPagada: true }, error: null };
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(r).toMatchObject({ yaPagada: true });
    expect(bd.auditoria).not.toHaveBeenCalled();
  });

  it('rechaza (409) una nómina en borrador o anulada sin llamar a la BD de escritura', async () => {
    for (const estado of ['BORRADOR', 'ANULADA']) {
      bd.nominaFila = filaNomina(estado);
      const r = await pagarNomina(NOMINA, ambas(), USUARIO);
      expect(r).toMatchObject({ codigo: 409 });
    }
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('una nómina ANULADA que tuvo pago responde 409, no yaPagada', async () => {
    bd.nominaFila = filaNomina('ANULADA');
    bd.pagosTabla = { data: [filaPago('USD', MOV_USD, { movimiento: { numero_sistema: 12, anulado: true } })], error: null };
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(r).toMatchObject({ codigo: 409, error: expect.stringMatching(/anulada/i) });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('si la RPC tuvo éxito pero no se puede recargar la nómina, devuelve éxito con aviso', async () => {
    const original = bd.nominaFila;
    let lecturas = 0;
    Object.defineProperty(bd, 'nominaFila', {
      configurable: true,
      get: () => (++lecturas > 1 ? null : original),
      set: () => undefined,
    });
    try {
      const r = await pagarNomina(NOMINA, ambas(), USUARIO);
      expect(r).toMatchObject({ yaPagada: false, advertencia: 'El pago se registró; recarga la nómina.' });
      expect('error' in r).toBe(false);
    } finally {
      Object.defineProperty(bd, 'nominaFila', { configurable: true, writable: true, value: original });
    }
  });

  it('nómina inexistente: 404', async () => {
    bd.nominaFila = null;
    expect(await pagarNomina(NOMINA, ambas(), USUARIO)).toMatchObject({ codigo: 404 });
  });

  it('cuenta de otra moneda o falta una moneda: 400 sin pagar', async () => {
    const mal = entrada([{ moneda: 'USD', bancaId: B_VES, llevaComision: false }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }].slice(0, 1));
    expect(await pagarNomina(NOMINA, mal, USUARIO)).toMatchObject({ codigo: 400 });
    const incompleta = entrada([{ moneda: 'USD', bancaId: B_USD }]);
    expect(await pagarNomina(NOMINA, incompleta, USUARIO)).toMatchObject({ codigo: 400 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('en Bs hay que elegir la comisión si está disponible', async () => {
    const sinElegir = entrada([{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES }]);
    expect(await pagarNomina(NOMINA, sinElegir, USUARIO)).toMatchObject({ codigo: 400 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('sin comisión en Bs: queda auditado por movimiento', async () => {
    bd.rpcResultado = { data: { yaPagada: false, pagos: [{ movimientoId: MOV_USD, sinComision: false }, { movimientoId: MOV_BS, sinComision: true }] }, error: null };
    const r = await pagarNomina(NOMINA, entrada([{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }]), USUARIO);
    expect(r).toMatchObject({ yaPagada: false });
    expect(bd.auditoria).toHaveBeenCalledTimes(1);
    expect(bd.auditoria.mock.calls[0][0]).toMatchObject({ entidadId: MOV_BS, accion: 'sin_comision_bancaria', usuarioId: USUARIO });
  });

  it('si la fecha elegida difiere de la fecha real del registro, queda auditada por movimiento', async () => {
    bd.rpcResultado = {
      data: {
        yaPagada: false, fechaElegida: '2026-10-09', fechaReal: '2026-10-12',
        pagos: [{ movimientoId: MOV_USD, sinComision: false }, { movimientoId: MOV_BS, sinComision: false }],
      },
      error: null,
    };
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(r).toMatchObject({ yaPagada: false });
    expect(bd.auditoria).toHaveBeenCalledTimes(2);
    expect(bd.auditoria.mock.calls[0][0]).toMatchObject({
      entidadTipo: 'movimiento_banca', entidadId: MOV_USD, accion: 'fecha_pago_distinta', usuarioId: USUARIO,
      cambios: { fecha_pago: { antes: '2026-10-12', despues: '2026-10-09' } },
    });
    expect(bd.auditoria.mock.calls[1][0]).toMatchObject({ entidadId: MOV_BS, accion: 'fecha_pago_distinta' });
  });

  it('si la fecha elegida es la real, no se audita nada', async () => {
    bd.rpcResultado = {
      data: { yaPagada: false, fechaElegida: '2026-10-09', fechaReal: '2026-10-09', pagos: [{ movimientoId: MOV_USD, sinComision: false }] },
      error: null,
    };
    await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(bd.auditoria).not.toHaveBeenCalled();
  });

  it('si la fecha difiere y no se puede auditar: el pago ya existe, devuelve advertencia', async () => {
    bd.rpcResultado = {
      data: { yaPagada: false, fechaElegida: '2026-10-09', fechaReal: '2026-10-12', pagos: [{ movimientoId: MOV_USD, sinComision: false }] },
      error: null,
    };
    bd.auditoria.mockResolvedValue(false);
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(r).toMatchObject({ yaPagada: false, advertencia: expect.stringMatching(/auditor/i) });
  });

  it('un monto en Bs demasiado pequeño (error de negocio de la BD) se responde 409 con su mensaje', async () => {
    bd.rpcResultado = { data: null, error: { code: 'P0001', message: 'La parte en Bs es demasiado pequeña para pagarla.' } };
    expect(await pagarNomina(NOMINA, ambas(), USUARIO)).toEqual({ error: 'La parte en Bs es demasiado pequeña para pagarla.', codigo: 409 });
  });

  it('si no se puede auditar, el pago ya existe: devuelve una advertencia y no falla', async () => {
    bd.rpcResultado = { data: { yaPagada: false, pagos: [{ movimientoId: MOV_BS, sinComision: true }] }, error: null };
    bd.auditoria.mockResolvedValue(false);
    bd.nominaFila = { ...filaNomina('CERRADA'), lineas: (filaNomina('CERRADA').lineas as Fila[]).filter(l => l.moneda_pago === 'BS') };
    const r = await pagarNomina(NOMINA, entrada([{ moneda: 'BS', bancaId: B_VES, llevaComision: false }]), USUARIO);
    expect(r).toMatchObject({ advertencia: expect.stringMatching(/auditor/i) });
  });

  it('errores de negocio de la función SQL (saldo insuficiente) se responden como 409 con su mensaje', async () => {
    bd.rpcResultado = { data: null, error: { code: 'P0001', message: 'Saldo insuficiente en CAJA CHICA: disponible 10, se necesita 100.' } };
    expect(await pagarNomina(NOMINA, ambas(), USUARIO)).toEqual({ error: 'Saldo insuficiente en CAJA CHICA: disponible 10, se necesita 100.', codigo: 409 });
  });

  it('migración pendiente (función inexistente): 503 con el nombre de la migración', async () => {
    bd.rpcResultado = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomina_pagar' } };
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(r).toMatchObject({ codigo: 503, error: expect.stringContaining('migration_nomina_pago_wallet.sql') });
  });

  it('un error inesperado de BD no filtra su mensaje', async () => {
    bd.rpcResultado = { data: null, error: { code: 'XX000', message: 'detalle interno con V12345678' } };
    const r = await pagarNomina(NOMINA, ambas(), USUARIO);
    expect(r).toMatchObject({ codigo: 500 });
    expect(JSON.stringify(r)).not.toContain('V12345678');
  });
});
