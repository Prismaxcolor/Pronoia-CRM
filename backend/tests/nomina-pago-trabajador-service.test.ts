import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PagoNomina } from '../../shared/types/nomina';

type Fila = Record<string, unknown>;
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

vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});
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

import { pagarTrabajadorNomina } from '../src/services/nomina-pago-trabajador-service';
import { obtenerNomina } from '../src/services/nomina-service';
import { pagarTrabajadorSchema } from '../src/schemas/nomina';

const NOMINA = '44444444-4444-4444-8444-444444444444';
const USUARIO = '55555555-5555-4555-8555-555555555555';
const B_USD = '11111111-1111-4111-8111-111111111111';
const B_VES = '22222222-2222-4222-8222-222222222222';
const MOV_USD = '66666666-6666-4666-8666-666666666666';
const MOV_BS = '77777777-7777-4777-8777-777777777777';
const CAT = '88888888-8888-4888-8888-888888888888';
const L_ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L_LUIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T_ANA = 't1';
const T_LUIS = 't2';

const SUPABASE_URL = 'https://p.supabase.test';

// Ana cobra solo en divisas; Luis cobra las dos partes (divisas y Bs).
const filaNomina = (estado: string): Fila => ({
  id: NOMINA, numero: 7, tipo: 'OPERATIVO', semana_inicio: '2026-10-05', tasa_bs: 40, estado, version: 2,
  cantidad_divisas: 2, cantidad_bs: 1, total_divisas_usd: 160, total_bs: 2000, total_equivalente_usd: 50,
  total_combinado_usd: 210, total_combinado_bs: 8400,
  lineas: [
    { id: L_ANA, trabajador_id: T_ANA, trabajador_nombre: 'Ana', moneda_pago: 'USD', dias_trabajados: 5, monto_base_usd: 20, total_bruto_usd: 100, bonificacion_usd: 0, descuento_trabajo_usd: 0, descuento_prestamo_usd: 0, pagar_usd: 100, pagar_bs: 0, total_usd: 100, total_bs: 4000, cuotas: [] },
    { id: L_LUIS, trabajador_id: T_LUIS, trabajador_nombre: 'Luis', moneda_pago: 'MIXTO', dias_trabajados: 5, monto_base_usd: 12, monto_base_bs: 10, total_bruto_usd: 110, bonificacion_usd: 0, descuento_trabajo_usd: 0, descuento_prestamo_usd: 0, pagar_usd: 60, pagar_bs: 2000, total_usd: 110, total_bs: 4400, cuotas: [] },
  ],
});

const filaPago = (lineaId: string | null, moneda: 'USD' | 'BS', movimientoId: string, extra: Fila = {}): Fila => ({
  id: `pago-${lineaId ?? 'todos'}-${moneda}`, linea_id: lineaId, moneda_pago: moneda, banca_id: moneda === 'USD' ? B_USD : B_VES, movimiento_id: movimientoId,
  monto: moneda === 'USD' ? 100 : 2000, monto_usd: moneda === 'USD' ? 100 : 50, cantidad: 1, fecha: '2026-10-09', referencia: null,
  created_at: '2026-10-09T15:00:00Z', banca: { nombre: moneda === 'USD' ? 'CAJA CHICA' : 'CAJA BS' },
  movimiento: { numero_sistema: 12, anulado: false, comprobantes: [`${SUPABASE_URL}/storage/v1/object/public/comprobantes/a.jpg`] }, ...extra,
});

const entrada = (bancas: unknown[], extra: Record<string, unknown> = {}) => pagarTrabajadorSchema.parse({ fecha: '2026-10-09', bancas, ...extra });

beforeEach(() => {
  bd.bancas = [
    { id: B_USD, nombre: 'CAJA CHICA', moneda: 'USD', archivada: false },
    { id: B_VES, nombre: 'CAJA BS', moneda: 'VES', archivada: false },
  ];
  bd.pagosTabla = { data: [], error: null };
  bd.nominaFila = filaNomina('CERRADA');
  bd.rpcResultado = { data: { yaPagada: false, pagos: [{ movimientoId: MOV_USD, sinComision: false }] }, error: null };
  bd.categorias = { categorias: [{ id: CAT, nombre: 'NOMINA PERSONAL OPERATIVO', tipo: 'EGRESO', activo: true, padreId: null }] };
  bd.comision = true;
  bd.rpc.mockClear();
  bd.auditoria.mockReset();
  bd.auditoria.mockResolvedValue(true);
  bd.logs = [];
});

describe('obtenerNomina con pagos individuales', () => {
  it('cada pago trae a qué trabajador se pagó y los comprobantes del egreso', async () => {
    bd.pagosTabla = { data: [filaPago(L_ANA, 'USD', MOV_USD)], error: null };
    const r = await obtenerNomina(NOMINA);
    if ('error' in r) throw new Error(r.error);
    const [pago] = r.nomina.pagos as [PagoNomina];
    expect(pago).toMatchObject({ trabajadorId: T_ANA, monedaPago: 'USD', comprobantes: [`${SUPABASE_URL}/storage/v1/object/public/comprobantes/a.jpg`] });
  });

  it('el pago de toda la nómina (sin renglón) queda con trabajadorId null; sin la migración (sin linea_id) también', async () => {
    const sinColumna = filaPago(L_ANA, 'USD', MOV_USD);
    delete sinColumna.linea_id;
    bd.pagosTabla = { data: [filaPago(null, 'USD', MOV_USD), sinColumna], error: null };
    const r = await obtenerNomina(NOMINA);
    if ('error' in r) throw new Error(r.error);
    expect(r.nomina.pagos.map(p => p.trabajadorId)).toEqual([null, null]);
  });

  it('un egreso sin comprobantes da lista vacía', async () => {
    bd.pagosTabla = { data: [filaPago(L_ANA, 'USD', MOV_USD, { movimiento: { numero_sistema: 12, anulado: false } })], error: null };
    const r = await obtenerNomina(NOMINA);
    expect('nomina' in r && r.nomina.pagos[0].comprobantes).toEqual([]);
  });
});

describe('pagarTrabajadorNomina', () => {
  it('paga a un trabajador con UNA llamada a nomina_pagar_trabajador: renglón, categoría, cuenta y comprobantes; nunca montos', async () => {
    const comprobante = `${SUPABASE_URL}/storage/v1/object/public/comprobantes/x.jpg`;
    const input = entrada([{ moneda: 'USD', bancaId: B_USD }], { referencia: 'REF-1', comprobantes: [comprobante] });
    const r = await pagarTrabajadorNomina(NOMINA, T_ANA, input, USUARIO);
    if ('error' in r) throw new Error(r.error);
    expect(r.yaPagada).toBe(false);
    expect(bd.rpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = bd.rpc.mock.calls[0] as [string, { p_nomina_id: string; p_trabajador_id: string; p_datos: Record<string, unknown>; p_usuario: string }];
    expect(nombre).toBe('nomina_pagar_trabajador');
    expect(args).toMatchObject({ p_nomina_id: NOMINA, p_trabajador_id: T_ANA, p_usuario: USUARIO });
    expect(args.p_datos).toMatchObject({
      fecha: '2026-10-09', referencia: 'REF-1', categoriaId: CAT, comprobantes: [comprobante],
      pagos: [{ moneda: 'USD', bancaId: B_USD, llevaComision: null }],
    });
    expect(JSON.stringify(args)).not.toMatch(/monto/i);
  });

  it('un trabajador con las dos partes exige una cuenta para cada moneda', async () => {
    const soloDivisas = await pagarTrabajadorNomina(NOMINA, T_LUIS, entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO);
    expect(soloDivisas).toMatchObject({ codigo: 400 });
    expect('error' in soloDivisas && soloDivisas.error).toMatch(/cuenta para cada moneda/i);
    expect(bd.rpc).not.toHaveBeenCalled();
    const ambas = entrada([{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }]);
    const r = await pagarTrabajadorNomina(NOMINA, T_LUIS, ambas, USUARIO);
    expect('error' in r).toBe(false);
    expect(bd.rpc.mock.calls[0][1].p_datos.pagos).toHaveLength(2);
  });

  it('un trabajador solo en divisas no admite cuenta en Bs', async () => {
    const r = await pagarTrabajadorNomina(NOMINA, T_ANA, entrada([{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }]), USUARIO);
    expect(r).toMatchObject({ codigo: 400 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('un trabajador que no está en la nómina es 404', async () => {
    const r = await pagarTrabajadorNomina(NOMINA, 'otro', entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO);
    expect(r).toMatchObject({ codigo: 404 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('solo se paga una nómina cerrada', async () => {
    bd.nominaFila = filaNomina('BORRADOR');
    expect(await pagarTrabajadorNomina(NOMINA, T_ANA, entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO)).toMatchObject({ codigo: 409 });
    bd.nominaFila = filaNomina('ANULADA');
    expect(await pagarTrabajadorNomina(NOMINA, T_ANA, entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO)).toMatchObject({ codigo: 409 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('si ya se le pagó, responde yaPagada sin llamar a la BD de escritura', async () => {
    bd.pagosTabla = { data: [filaPago(L_ANA, 'USD', MOV_USD)], error: null };
    const r = await pagarTrabajadorNomina(NOMINA, T_ANA, entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO);
    expect(r).toMatchObject({ yaPagada: true });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('si la nómina ya se pagó completa, no se paga por trabajador (409)', async () => {
    bd.pagosTabla = { data: [filaPago(null, 'USD', MOV_USD)], error: null };
    const r = await pagarTrabajadorNomina(NOMINA, T_ANA, entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO);
    expect(r).toMatchObject({ codigo: 409 });
    expect('error' in r && r.error).toMatch(/completa/i);
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('pagar a otro trabajador cuando ya se pagó a uno sí se permite', async () => {
    bd.pagosTabla = { data: [filaPago(L_ANA, 'USD', MOV_USD)], error: null };
    const r = await pagarTrabajadorNomina(NOMINA, T_LUIS, entrada([{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }]), USUARIO);
    expect('error' in r).toBe(false);
    expect(bd.rpc).toHaveBeenCalledTimes(1);
  });

  it('sin la migración (función inexistente) responde 503 con el nombre de la migración', async () => {
    bd.rpcResultado = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomina_pagar_trabajador' } };
    const r = await pagarTrabajadorNomina(NOMINA, T_ANA, entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO);
    expect(r).toMatchObject({ codigo: 503 });
    expect('error' in r && r.error).toContain('migration_nomina_pago_por_trabajador.sql');
  });

  it('un error de negocio de la BD (saldo insuficiente) es 409 con su mensaje', async () => {
    bd.rpcResultado = { data: null, error: { code: 'P0001', message: 'Saldo insuficiente en CAJA CHICA: disponible 10, se necesita 100.' } };
    const r = await pagarTrabajadorNomina(NOMINA, T_ANA, entrada([{ moneda: 'USD', bancaId: B_USD }]), USUARIO);
    expect(r).toMatchObject({ codigo: 409, error: 'Saldo insuficiente en CAJA CHICA: disponible 10, se necesita 100.' });
  });

  it('un pago en Bs sin comisión elegida se audita como en el pago de la nómina completa', async () => {
    bd.rpcResultado = { data: { yaPagada: false, pagos: [{ movimientoId: MOV_BS, sinComision: true }] }, error: null };
    const ambas = entrada([{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }]);
    await pagarTrabajadorNomina(NOMINA, T_LUIS, ambas, USUARIO);
    expect(bd.auditoria).toHaveBeenCalledWith(expect.objectContaining({ entidadId: MOV_BS, accion: 'sin_comision_bancaria' }));
  });
});

describe('pagarTrabajadorSchema', () => {
  it('los comprobantes son opcionales y solo se aceptan URLs del bucket de este sistema', () => {
    expect(entrada([{ moneda: 'USD', bancaId: B_USD }]).comprobantes).toEqual([]);
    expect(pagarTrabajadorSchema.safeParse({ fecha: '2026-10-09', bancas: [{ moneda: 'USD', bancaId: B_USD }], comprobantes: ['https://evil.test/a.jpg'] }).success).toBe(false);
  });

  it('máximo 10 comprobantes', () => {
    const url = (i: number) => `${SUPABASE_URL}/storage/v1/object/public/comprobantes/${i}.jpg`;
    const once = Array.from({ length: 11 }, (_, i) => url(i));
    expect(pagarTrabajadorSchema.safeParse({ fecha: '2026-10-09', bancas: [{ moneda: 'USD', bancaId: B_USD }], comprobantes: once }).success).toBe(false);
  });
});
