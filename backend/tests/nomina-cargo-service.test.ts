import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  tablas: {} as Record<string, Fila[]>,
  errores: {} as Record<string, { code?: string; message: string }>,
  consultas: [] as Array<{ tabla: string; filtros: Array<[string, unknown]>; select?: string; limite?: number }>,
  logs: [] as unknown[],
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: (p: unknown) => bd.logs.push(p), warn: (p: unknown) => bd.logs.push(p), error: (p: unknown) => bd.logs.push(p) },
}));
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const consulta: { tabla: string; filtros: Array<[string, unknown]>; select?: string; limite?: number } = { tabla, filtros: [] };
      bd.consultas.push(consulta);
      const resultado = () => (bd.errores[tabla] ? { data: null, error: bd.errores[tabla] } : { data: bd.tablas[tabla] ?? [], error: null });
      const c: Record<string, unknown> = {};
      c.order = () => c;
      c.select = (columnas: string) => { consulta.select = columnas; return c; };
      c.limit = (n: number) => { consulta.limite = n; return c; };
      for (const m of ['eq', 'in']) c[m] = (col: string, v: unknown) => { consulta.filtros.push([`${m}:${col}`, v]); return c; };
      c.not = (col: string, op: string, v: unknown) => { consulta.filtros.push([`not:${col}:${op}`, v]); return c; };
      c.maybeSingle = () => Promise.resolve({ data: (bd.tablas[tabla] ?? [])[0] ?? null, error: bd.errores[tabla] ?? null });
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
      return c;
    },
  },
}));

import { obtenerCargoTrabajador } from '../src/services/nomina-cargo-service';

const T = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  bd.consultas = [];
  bd.errores = {};
  bd.logs = [];
  bd.tablas = {
    nomina_trabajadores: [{ id: T, nombres: 'Ana', apellidos: 'Pérez' }],
    nomina_lineas: [{
      trabajador_id: T, moneda_pago: 'MIXTO', pagar_usd: '100.00', pagar_bs: '8750.00', total_usd: '110.00',
      nomina: { id: 'n1', numero: 7, semana_inicio: '2026-10-05', estado: 'CERRADA', cerrada_at: '2026-10-09T15:00:00Z' },
    }],
    nomina_pagos: [{
      nomina_id: 'n1', moneda_pago: 'BS', fecha: '2026-10-09', tasa_binance: '875', tasa_binance_capturada: '2026-10-09T16:02:00Z',
      movimiento: { anulado: false },
    }],
    nomina_prestamos: [{ id: 'p1', numero: 2, tipo: 'PRESTAMO', monto_usd: '50', saldo_usd: '30', fecha: '2026-09-28', estado: 'ACTIVO' }],
    nomina_prestamo_movimientos: [{ id: 'c1', tipo: 'CUOTA', monto_usd: '20', created_at: '2026-10-09T15:00:00Z', prestamo: { numero: 2 }, nomina: { numero: 7 } }],
  };
});

describe('obtenerCargoTrabajador', () => {
  it('junta pagos de nómina, préstamos y cuotas; el pago en Bs ya hecho lleva su equivalente en USD', async () => {
    const r = await obtenerCargoTrabajador(T);
    if ('error' in r) throw new Error(r.error);
    expect(r.cargo).toMatchObject({ trabajadorId: T, nombre: 'Ana Pérez', saldoPrestamosUsd: 30 });
    const bs = r.cargo.movimientos.find(m => m.tipo === 'PAGO_BS')!;
    expect(bs).toMatchObject({ montoBs: 8750, equivalenteUsd: 10, tasaBinance: 875, estado: 'PAGADO' });
    expect(r.cargo.movimientos.find(m => m.tipo === 'PAGO_DIVISAS')).toMatchObject({ montoUsd: 100, estado: 'PENDIENTE' });
    expect(r.cargo.movimientos.map(m => m.tipo).sort()).toEqual(['CUOTA', 'PAGO_BS', 'PAGO_DIVISAS', 'PRESTAMO']);
  });

  it('solo mira las nóminas cerradas del trabajador pedido', async () => {
    await obtenerCargoTrabajador(T);
    const lineas = bd.consultas.find(c => c.tabla === 'nomina_lineas')!;
    expect(lineas.filtros).toContainEqual(['eq:trabajador_id', T]);
    expect(lineas.filtros).toContainEqual(['not:nomina.cerrada_at:is', null]);
  });

  it('trabajador inexistente: 404', async () => {
    bd.tablas.nomina_trabajadores = [];
    expect(await obtenerCargoTrabajador(T)).toMatchObject({ codigo: 404 });
  });

  it('sin la migración del pago desde el Wallet (no existe nomina_pagos): el cargo se arma sin pagos', async () => {
    bd.errores.nomina_pagos = { code: '42P01', message: 'relation "nomina_pagos" does not exist' };
    const r = await obtenerCargoTrabajador(T);
    if ('error' in r) throw new Error(r.error);
    expect(r.cargo.movimientos.find(m => m.tipo === 'PAGO_BS')).toMatchObject({ estado: 'PENDIENTE', equivalenteUsd: null });
  });

  it('un fallo real de la BD da 500 genérico sin filtrar el detalle', async () => {
    bd.errores.nomina_prestamos = { code: 'XX000', message: 'detalle con V-12345678' };
    const r = await obtenerCargoTrabajador(T);
    expect(r).toMatchObject({ codigo: 500 });
    expect(JSON.stringify(r)).not.toContain('V-12345678');
    expect(JSON.stringify(bd.logs)).not.toContain('V-12345678');
  });
});

describe('lecturas del cargo: columnas explícitas y tope por consulta', () => {
  it('ninguna consulta usa select(*) y las de pagos y cuotas llevan límite', async () => {
    const r = await obtenerCargoTrabajador(T);
    if ('error' in r) throw new Error(r.error);
    for (const c of bd.consultas) expect(c.select, c.tabla).not.toMatch(/(^|[\s,(])\*/);
    for (const tabla of ['nomina_lineas', 'nomina_pagos', 'nomina_prestamo_movimientos', 'nomina_prestamos']) {
      const c = bd.consultas.find(x => x.tabla === tabla)!;
      expect(c.limite, tabla).toBeGreaterThan(0);
    }
  });
});
