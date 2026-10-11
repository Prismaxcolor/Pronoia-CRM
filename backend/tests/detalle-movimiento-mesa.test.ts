import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({ tablas: {} as Record<string, Fila | null>, consultas: [] as string[] }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      bd.consultas.push(tabla);
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) c[m] = () => c;
      c.maybeSingle = () => Promise.resolve({ data: bd.tablas[tabla] ?? null, error: null });
      return c;
    },
  },
}));

import { obtenerDetalleMovimiento } from '../src/services/banca-service.js';

const ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  bd.consultas = [];
  bd.tablas = {
    movimientos: {
      id: ID, tipo: 'transferencia', monto: 100, moneda: 'USD', banca_origen_id: 'b-o', banca_destino_id: 'b-d', fecha: '2026-10-11',
      creado_en: '2026-10-11T10:00:00Z', registrado_por: 'u-1', anulado: false,
      mesa_cambista_id: 'c-1', mesa_estado: 'en_proceso', mesa_monto_bruto: 100, mesa_comision: 2, mesa_comision_modo: 'porcentaje', mesa_comision_pct: 2,
    },
    bancas: { nombre: 'Banco' },
    cambistas: { nombre: 'Casa Juan' },
    users: { nombre: 'Ana' },
  };
});

describe('obtenerDetalleMovimiento con mesa de cambio', () => {
  it('trae el nombre del cambista solo si quien consulta puede ver la mesa', async () => {
    const con = await obtenerDetalleMovimiento(ID, { verProveedores: false, verClientes: false, verCambistas: true });
    expect(con?.cambistaNombre).toBe('Casa Juan');
    expect(con?.movimiento).toMatchObject({ mesaEstado: 'en_proceso', mesaComision: 2, mesaComisionModo: 'porcentaje', mesaMontoBruto: 100 });

    bd.consultas = [];
    const sin = await obtenerDetalleMovimiento(ID, { verProveedores: false, verClientes: false });
    expect(sin?.cambistaNombre).toBeNull();
    expect(bd.consultas).not.toContain('cambistas');
  });

  it('un movimiento normal no consulta cambistas', async () => {
    bd.tablas.movimientos = { ...(bd.tablas.movimientos as Fila), mesa_cambista_id: null, mesa_estado: null };
    const r = await obtenerDetalleMovimiento(ID, { verProveedores: false, verClientes: false, verCambistas: true });
    expect(r?.cambistaNombre).toBeNull();
    expect(bd.consultas).not.toContain('cambistas');
  });
});
