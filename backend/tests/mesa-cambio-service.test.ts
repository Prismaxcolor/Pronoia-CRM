import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  asientos: [] as Fila[],
  errorEnPagina: null as { code?: string; message: string } | null,
  rangos: [] as Array<[number, number]>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) c[m] = () => c;
      // PostgREST: como máximo 1000 filas por respuesta; range(desde, hasta) es inclusivo.
      c.range = (desde: number, hasta: number) => {
        bd.rangos.push([desde, hasta]);
        const pagina = bd.asientos.slice(desde, Math.min(hasta, desde + 999) + 1);
        return Promise.resolve(bd.errorEnPagina ? { data: null, error: bd.errorEnPagina } : { data: pagina, error: null });
      };
      c.maybeSingle = () => Promise.resolve({ data: tabla === 'cambistas' ? { id: 'c1', nombre: 'Cambista', activo: true, created_at: '2026-01-01' } : null, error: null });
      return c;
    },
  },
}));

import { obtenerEstadoCuenta } from '../src/services/mesa-cambio-service.js';

const asiento = (numero: number, tipo: 'CARGO' | 'COBRO', monto: number): Fila => ({
  id: `a${numero}`, numero, tipo, monto_usd: monto, fecha: '2026-10-01', anulado: false, tasa: null, nota: null, referencia: null, anulado_motivo: null,
});

beforeEach(() => { bd.asientos = []; bd.errorEnPagina = null; bd.rangos = []; });

describe('mesa-cambio obtenerEstadoCuenta (paginado)', () => {
  it('con más de 1000 asientos suma todos: el saldo no se trunca', async () => {
    // 2500 asientos: 2000 cargos de 10 y 500 cobros de 4 => saldo 20000 - 2000 = 18000
    bd.asientos = [
      ...Array.from({ length: 2000 }, (_, i) => asiento(i + 1, 'CARGO', 10)),
      ...Array.from({ length: 500 }, (_, i) => asiento(2001 + i, 'COBRO', 4)),
    ];
    const r = await obtenerEstadoCuenta('c1', {});
    if ('error' in r) throw new Error(r.error);
    expect(r.estado.saldoFinal).toBe(18000);
    expect(r.estado.filas).toHaveLength(2500);
    expect(bd.rangos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('un error de lectura en una página devuelve fallo (no un saldo parcial)', async () => {
    bd.asientos = [asiento(1, 'CARGO', 10)];
    bd.errorEnPagina = { code: '08006', message: 'caida' };
    const r = await obtenerEstadoCuenta('c1', {});
    expect(r).toMatchObject({ codigo: 500 });
  });

  it('tabla inexistente => 503 de migración pendiente', async () => {
    bd.errorEnPagina = { code: '42P01', message: 'relation "cambista_asientos" does not exist' };
    const r = await obtenerEstadoCuenta('c1', {});
    expect(r).toMatchObject({ codigo: 503 });
  });
});
