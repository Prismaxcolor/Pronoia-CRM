import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  comisionEnUsd, conComisiones, construirEstadoCuenta, formatearNumeroDocumento, importeFirmado, saldoDeAsientos,
  type AsientoMesa, type DatosComisionMovimiento,
} from '../src/utils/mesa-cambio.js';

const asiento = (o: Partial<AsientoMesa> & Pick<AsientoMesa, 'id' | 'numero' | 'tipo' | 'montoUsd'>): AsientoMesa => ({
  fecha: '2026-10-20', anulado: false, ...o,
});

describe('asiento COMISION: gasto a favor del cambista', () => {
  it('reduce el saldo (aumenta lo que se le debe), como un COBRO', () => {
    expect(importeFirmado({ tipo: 'COMISION', montoUsd: 1, anulado: false })).toBe(-1);
    expect(saldoDeAsientos([
      { tipo: 'CARGO', montoUsd: 1000, anulado: false },
      { tipo: 'COBRO', montoUsd: 1000, anulado: false },
      { tipo: 'COMISION', montoUsd: 20, anulado: false },
    ])).toBe(-20);
  });

  it('anulado no pesa', () => {
    expect(importeFirmado({ tipo: 'COMISION', montoUsd: 20, anulado: true })).toBe(0);
  });

  it('entra en el estado de cuenta como cobro (columna que reduce) con saldo corrido', () => {
    const r = construirEstadoCuenta([
      asiento({ id: 'a1', numero: 1, tipo: 'CARGO', montoUsd: 1000, movimientoId: 'm1' }),
      asiento({ id: 'a2', numero: 2, tipo: 'COBRO', montoUsd: 1000, movimientoId: 'm1' }),
      asiento({ id: 'a3', numero: 3, tipo: 'COMISION', montoUsd: 20, movimientoId: 'm1' }),
    ], {});
    expect(r.filas[2]).toMatchObject({ tipo: 'COMISION', cargo: 0, cobro: 20, saldoCorrido: -20 });
    expect(r.saldoFinal).toBe(-20);
    expect(r.totalCobros).toBe(1020);
  });

  it('usa el correlativo MC- (no es una nota)', () => {
    expect(formatearNumeroDocumento({ tipo: 'COMISION', numero: 12, numeroNota: null })).toBe('MC-0012');
  });
});

describe('conComisiones: sin doble conteo con el asiento COMISION', () => {
  const datos = new Map<string, DatosComisionMovimiento>([
    ['m1', { comision: 20, montoBruto: 1000, moneda: 'USD', numeroSistema: 1, completada: true }],
    ['m2', { comision: 10, montoBruto: 500, moneda: 'USD', numeroSistema: 2, completada: true }],
  ]);
  const estado = construirEstadoCuenta([
    asiento({ id: 'a1', numero: 1, tipo: 'CARGO', montoUsd: 1000, movimientoId: 'm1' }),
    asiento({ id: 'a2', numero: 2, tipo: 'COBRO', montoUsd: 1000, movimientoId: 'm1' }),
    asiento({ id: 'a3', numero: 3, tipo: 'COMISION', montoUsd: comisionEnUsd(1000, 20, 1000), movimientoId: 'm1' }),
    asiento({ id: 'a4', numero: 4, tipo: 'CARGO', montoUsd: 500, movimientoId: 'm2' }), // histórica: sin asiento COMISION
  ], {});

  it('no repite la comisión informativa en la transferencia que ya tiene su asiento, y sí en la histórica', () => {
    const r = conComisiones(estado, datos);
    const porId = new Map(r.filas.map(f => [f.id, f]));
    expect(porId.get('a1')?.comision).toBeNull();
    expect(porId.get('a3')?.comision).toBeNull();
    expect(porId.get('a4')?.comision).toMatchObject({ montoUsd: 10 });
    expect(r.totalComisionesUsd).toBe(10);
  });

  it('un asiento COMISION anulado no oculta la comisión informativa', () => {
    const e = construirEstadoCuenta([
      asiento({ id: 'a1', numero: 1, tipo: 'CARGO', montoUsd: 1000, movimientoId: 'm1' }),
      asiento({ id: 'a3', numero: 3, tipo: 'COMISION', montoUsd: 20, movimientoId: 'm1', anulado: true }),
    ], {});
    expect(conComisiones(e, datos).filas[0].comision).toMatchObject({ montoUsd: 20 });
  });

  it('no cambia saldos ni totales', () => {
    const r = conComisiones(estado, datos);
    expect(r.saldoFinal).toBe(estado.saldoFinal);
    expect(r.totalCobros).toBe(estado.totalCobros);
  });
});

describe('migración migration_mesa_cambio_comision_asiento.sql', () => {
  const docs = path.resolve(import.meta.dirname, '../../docs');
  const sql = readFileSync(path.join(docs, 'migration_mesa_cambio_comision_asiento.sql'), 'utf8');

  it('renombra la categoría sin duplicar y busca el nombre nuevo y el viejo', () => {
    expect(sql).toContain("'Comisión % por cambio de divisas'");
    expect(sql).toMatch(/update public\.categorias_wallet set nombre = c_nuevo where id = v_id/);
    expect(sql).toContain("in ('comision % por cambio de divisas', 'comision cambio de divisas')");
  });

  it('amplía el tipo, crea el asiento COMISION en el cobro y no redefine la anulación', () => {
    expect(sql).toMatch(/check \(tipo in \('CARGO', 'COBRO', 'NC', 'ND', 'COMISION'\)\)/);
    expect(sql).toMatch(/'COMISION', v_com_as_usd/);
    expect(sql).not.toMatch(/function public\.anular_transferencia_mesa_cambio/);
  });

  it('el backfill es opcional y no aplica nada por defecto', () => {
    const backfill = readFileSync(path.join(docs, 'migration_mesa_cambio_comision_asiento_BACKFILL_OPCIONAL.sql'), 'utf8');
    expect(backfill).not.toMatch(/^insert into/m);
    expect(backfill).toMatch(/^-- insert into public\.cambista_asientos/m);
  });
});
