import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
type ErrorBd = { code?: string; message: string } | null;
const bd = vi.hoisted(() => ({
  prestamo: null as Fila | null,
  insertados: [] as Fila[],
  actualizados: [] as Fila[],
  pagos: { data: [] as Fila[], error: null as ErrorBd },
  /** Pagos que se ven DESPUÉS de llamar a nomina_prestamo_pagar (el préstamo recién pagado). */
  pagosTrasPagar: null as { data: Fila[]; error: ErrorBd } | null,
  bancas: [] as Fila[],
  rpcs: {} as Record<string, { data: unknown; error: ErrorBd }>,
  llamadasRpc: [] as Array<{ nombre: string; args: Record<string, unknown> }>,
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
      let modo: 'leer' | 'insertar' | 'actualizar' = 'leer';
      let ids: unknown[] | null = null;
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'order', 'limit']) c[m] = () => c;
      c.in = (_col: string, valores: unknown[]) => { ids = valores; return c; };
      c.insert = (fila: Fila) => { modo = 'insertar'; bd.insertados.push(fila); return c; };
      c.update = (campos: Fila) => { modo = 'actualizar'; bd.actualizados.push(campos); return c; };
      const unico = () => {
        if (tabla === 'nomina_trabajadores') return Promise.resolve({ data: { id: 't1', activo: true }, error: null });
        if (tabla === 'nomina_prestamos' && modo === 'insertar') return Promise.resolve({ data: bd.prestamo, error: null });
        if (tabla === 'nomina_prestamos' && modo === 'actualizar') return Promise.resolve({ data: { id: 'p' }, error: null });
        if (tabla === 'nomina_prestamos') return Promise.resolve({ data: bd.prestamo, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      c.single = unico;
      c.maybeSingle = unico;
      const pagado = () => bd.llamadasRpc.some(l => l.nombre === 'nomina_prestamo_pagar');
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve(
        tabla === 'nomina_prestamo_pagos' ? (pagado() && bd.pagosTrasPagar ? bd.pagosTrasPagar : bd.pagos)
          : tabla === 'bancas' ? { data: bd.bancas.filter(b => ids === null || ids.includes(b.id)), error: null }
            : { data: bd.prestamo ? [bd.prestamo] : [], error: null },
      ).then(ok);
      return c;
    },
    rpc: (nombre: string, args: Record<string, unknown>) => {
      bd.llamadasRpc.push({ nombre, args });
      return Promise.resolve(bd.rpcs[nombre] ?? { data: null, error: null });
    },
  },
}));
vi.mock('../src/services/movimiento-comision-service.js', () => ({ comisionBancariaDisponible: async () => bd.comision }));
vi.mock('../src/services/auditoria-service.js', () => ({ registrarAuditoria: (e: unknown) => bd.auditoria(e) }));

import { desembolsarPrestamo, registrarPrestamo } from '../src/services/nomina-prestamo-pago-service';
import { anularPrestamo, listarPrestamos } from '../src/services/nomina-prestamo-service';
import { crearPrestamoSchema, desembolsoSchema } from '../src/schemas/nomina';

const TRAB = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const PRE = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const B_USD = '33333333-3333-4333-8333-cccccccccccc';
const B_VES = '44444444-4444-4444-8444-dddddddddddd';
const MOV = '55555555-5555-4555-8555-eeeeeeeeeeee';
const USUARIO = '66666666-6666-4666-8666-ffffffffffff';
const URL_COMPROBANTE = 'https://p.supabase.test/storage/v1/object/public/comprobantes/pago.jpg';

const filaPrestamo = (extra: Fila = {}): Fila => ({
  id: PRE, numero: 3, trabajador_id: TRAB, tipo: 'PRESTAMO', monto_usd: 100, saldo_usd: 100, cuota_semanal_usd: null, fecha: '2026-10-10',
  nota: null, estado: 'ACTIVO', anulado_motivo: null, trabajador: { nombres: 'Ana', apellidos: 'Pérez' }, ...extra,
});
const filaPago = (extra: Fila = {}): Fila => ({
  id: 'pp1', prestamo_id: PRE, banca_id: B_USD, movimiento_id: MOV, moneda: 'USD', monto: 100, monto_usd: 100, tasa_bs: null,
  fecha: '2026-10-10', referencia: null, banca: { nombre: 'CAJA CHICA' }, movimiento: { numero_sistema: 21, anulado: false, comprobantes: [URL_COMPROBANTE] }, ...extra,
});

const desembolso = (extra: Record<string, unknown> = {}) => desembolsoSchema.parse({ bancaId: B_USD, fecha: '2026-10-10', ...extra });
const prestamoInput = (extra: Record<string, unknown> = {}) => crearPrestamoSchema.parse({
  trabajadorId: TRAB, tipo: 'PRESTAMO', montoUsd: 100, cuotaSemanalUsd: null, fecha: '2026-10-10', ...extra,
});

beforeEach(() => {
  bd.prestamo = filaPrestamo();
  bd.insertados = [];
  bd.actualizados = [];
  bd.pagos = { data: [], error: null };
  bd.pagosTrasPagar = null;
  bd.bancas = [
    { id: B_USD, nombre: 'CAJA CHICA', moneda: 'USD', archivada: false },
    { id: B_VES, nombre: 'CAJA BS', moneda: 'VES', archivada: false },
  ];
  bd.rpcs = { nomina_prestamo_pagar: { data: { yaPagado: false, movimientoId: MOV, sinComision: false }, error: null } };
  bd.llamadasRpc = [];
  bd.comision = true;
  bd.auditoria.mockReset();
  bd.auditoria.mockResolvedValue(true);
  bd.logs = [];
});

describe('listarPrestamos con pago', () => {
  it('cada préstamo trae su desembolso (cuenta, movimiento, comprobantes) o null', async () => {
    bd.pagos = { data: [filaPago()], error: null };
    const r = await listarPrestamos({});
    if ('error' in r) throw new Error(r.error);
    expect(r.prestamos[0].desembolso).toMatchObject({
      bancaNombre: 'CAJA CHICA', movimientoNumero: 21, anulado: false, moneda: 'USD', monto: 100, comprobantes: [URL_COMPROBANTE],
    });
  });

  it('sin pago registrado: desembolso null; sin la migración (tabla inexistente) también', async () => {
    expect((await listarPrestamos({}) as { prestamos: Array<{ desembolso: unknown }> }).prestamos[0].desembolso).toBeNull();
    bd.pagos = { data: [], error: { code: '42P01', message: 'relation "nomina_prestamo_pagos" does not exist' } };
    expect((await listarPrestamos({}) as { prestamos: Array<{ desembolso: unknown }> }).prestamos[0].desembolso).toBeNull();
  });

  it('un error real de lectura de los pagos se propaga (no se muestra "sin pago")', async () => {
    bd.pagos = { data: [], error: { code: 'XX000', message: 'boom interno' } };
    const r = await listarPrestamos({});
    expect(r).toMatchObject({ codigo: 500 });
    expect(JSON.stringify(r)).not.toContain('boom');
  });
});

describe('registrarPrestamo', () => {
  it('sin desembolso: solo crea el préstamo, no toca el Wallet', async () => {
    const r = await registrarPrestamo(prestamoInput(), USUARIO);
    expect('error' in r).toBe(false);
    expect(bd.insertados).toHaveLength(1);
    expect(bd.llamadasRpc).toEqual([]);
  });

  it('con desembolso en USD: crea el préstamo y registra el pago con cuenta, fecha, comprobante y sin categoría', async () => {
    bd.pagosTrasPagar = { data: [filaPago()], error: null };
    const r = await registrarPrestamo(prestamoInput({ desembolso: desembolso({ referencia: 'R1', comprobantes: [URL_COMPROBANTE] }) }), USUARIO);
    if ('error' in r) throw new Error(r.error);
    expect(bd.insertados).toHaveLength(1);
    expect(bd.insertados[0]).not.toHaveProperty('desembolso');
    expect(bd.llamadasRpc).toHaveLength(1);
    expect(bd.llamadasRpc[0].nombre).toBe('nomina_prestamo_pagar');
    expect(bd.llamadasRpc[0].args).toMatchObject({
      p_prestamo_id: PRE, p_usuario: USUARIO,
      p_datos: { bancaId: B_USD, fecha: '2026-10-10', referencia: 'R1', categoriaId: null, tasaBs: null, comprobantes: [URL_COMPROBANTE] },
    });
    expect(r.prestamo.desembolso).toMatchObject({ movimientoId: MOV });
    expect(r.advertencia).toBeUndefined();
  });

  it('con una cuenta en Bs: manda la tasa y la comisión elegida; el monto lo calcula la BD', async () => {
    const r = await registrarPrestamo(prestamoInput({ desembolso: desembolso({ bancaId: B_VES, tasaBs: 40, llevaComision: false }) }), USUARIO);
    expect('error' in r).toBe(false);
    const datos = bd.llamadasRpc[0].args.p_datos as Record<string, unknown>;
    expect(datos).toMatchObject({ bancaId: B_VES, tasaBs: 40, llevaComision: false });
    expect(JSON.stringify(datos)).not.toMatch(/monto/i);
  });

  it('cuenta en Bs sin tasa: se rechaza ANTES de crear el préstamo (400, nada queda registrado)', async () => {
    const r = await registrarPrestamo(prestamoInput({ desembolso: desembolso({ bancaId: B_VES, llevaComision: false }) }), USUARIO);
    expect(r).toMatchObject({ codigo: 400 });
    expect(bd.insertados).toEqual([]);
    expect(bd.llamadasRpc).toEqual([]);
  });

  it('cuenta inexistente: 400 sin crear nada', async () => {
    bd.bancas = [];
    expect(await registrarPrestamo(prestamoInput({ desembolso: desembolso() }), USUARIO)).toMatchObject({ codigo: 400 });
    expect(bd.insertados).toEqual([]);
  });

  it('si el pago falla después de crear el préstamo, el préstamo queda registrado y se avisa', async () => {
    bd.rpcs.nomina_prestamo_pagar = { data: null, error: { code: 'P0001', message: 'Saldo insuficiente en CAJA CHICA: disponible 5, se necesita 100.' } };
    const r = await registrarPrestamo(prestamoInput({ desembolso: desembolso() }), USUARIO);
    if ('error' in r) throw new Error(r.error);
    expect(r.prestamo.id).toBe(PRE);
    expect(r.advertencia).toMatch(/Saldo insuficiente/);
    expect(r.advertencia).toMatch(/Registrar pago/);
  });
});

describe('desembolsarPrestamo', () => {
  it('un préstamo ya pagado responde yaPagado sin llamar a la BD de escritura', async () => {
    bd.pagos = { data: [filaPago()], error: null };
    const r = await desembolsarPrestamo(PRE, desembolso(), USUARIO);
    expect(r).toMatchObject({ yaPagado: true });
    expect(bd.llamadasRpc).toEqual([]);
  });

  it('un préstamo anulado no se paga (409)', async () => {
    bd.prestamo = filaPrestamo({ estado: 'ANULADO' });
    expect(await desembolsarPrestamo(PRE, desembolso(), USUARIO)).toMatchObject({ codigo: 409 });
    expect(bd.llamadasRpc).toEqual([]);
  });

  it('sin la migración (función inexistente): 503 con el nombre de la migración', async () => {
    bd.rpcs.nomina_prestamo_pagar = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomina_prestamo_pagar' } };
    const r = await desembolsarPrestamo(PRE, desembolso(), USUARIO);
    expect(r).toMatchObject({ codigo: 503 });
    expect('error' in r && r.error).toContain('migration_nomina_prestamo_desembolso.sql');
  });

  it('un pago en Bs sin comisión se audita como en el resto del Wallet', async () => {
    bd.rpcs.nomina_prestamo_pagar = { data: { yaPagado: false, movimientoId: MOV, sinComision: true }, error: null };
    await desembolsarPrestamo(PRE, desembolso({ bancaId: B_VES, tasaBs: 40, llevaComision: false }), USUARIO);
    expect(bd.auditoria).toHaveBeenCalledWith(expect.objectContaining({ entidadId: MOV, accion: 'sin_comision_bancaria' }));
  });
});

describe('anularPrestamo', () => {
  it('usa la función SQL que también anula el egreso del Wallet', async () => {
    bd.rpcs.nomina_prestamo_anular = { data: { yaAnulado: false }, error: null };
    expect(await anularPrestamo(PRE, 'Error de monto', USUARIO)).toEqual({ ok: true });
    expect(bd.llamadasRpc[0]).toEqual({ nombre: 'nomina_prestamo_anular', args: { p_prestamo_id: PRE, p_motivo: 'Error de monto', p_usuario: USUARIO } });
    expect(bd.actualizados).toEqual([]);
  });

  it('sin la migración cae al UPDATE de siempre (no puede haber pago)', async () => {
    bd.rpcs.nomina_prestamo_anular = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomina_prestamo_anular' } };
    expect(await anularPrestamo(PRE, 'Error de monto', USUARIO)).toEqual({ ok: true });
    expect(bd.actualizados).toHaveLength(1);
    expect(bd.actualizados[0]).toMatchObject({ estado: 'ANULADO', anulado_motivo: 'Error de monto' });
  });

  it('un rechazo de negocio (ya tiene cuotas) es 409 con su mensaje', async () => {
    bd.rpcs.nomina_prestamo_anular = { data: null, error: { code: 'P0001', message: 'El préstamo ya tiene cuotas descontadas: no se puede anular.' } };
    expect(await anularPrestamo(PRE, 'x', USUARIO)).toMatchObject({ codigo: 409, error: 'El préstamo ya tiene cuotas descontadas: no se puede anular.' });
  });
});

describe('desembolsoSchema', () => {
  it('comprobantes opcionales (solo URLs de este sistema), tasa opcional con hasta 6 decimales', () => {
    expect(desembolso().comprobantes).toEqual([]);
    expect(desembolso().tasaBs).toBeNull();
    expect(desembolsoSchema.safeParse({ bancaId: B_USD, fecha: '2026-10-10', comprobantes: ['https://evil.test/x.jpg'] }).success).toBe(false);
    expect(desembolsoSchema.safeParse({ bancaId: B_VES, fecha: '2026-10-10', tasaBs: 36.123456 }).success).toBe(true);
    expect(desembolsoSchema.safeParse({ bancaId: B_VES, fecha: '2026-10-10', tasaBs: 0 }).success).toBe(false);
    expect(desembolsoSchema.safeParse({ bancaId: 'x', fecha: '2026-10-10' }).success).toBe(false);
  });

  it('no admite una fecha posterior a mañana', () => {
    expect(desembolsoSchema.safeParse({ bancaId: B_USD, fecha: '2999-01-01' }).success).toBe(false);
  });
});
