import { describe, it, expect } from 'vitest';
import { construirReporteCuenta, saldoDeMovimientos, type MovimientoReporte } from '../src/utils/reporte-wallet.js';
import { aplicarEquivalentes } from '../src/utils/equivalente-movimiento.js';
import { instanteDeMovimiento, tasaVigenteA, type TasaHistorica } from '../src/utils/equivalente-usd.js';

const mov = (o: Partial<MovimientoReporte>): MovimientoReporte => ({
  id: 'm', tipo: 'ingreso', subtipo: null, numero: null, numeroSistema: 1, monto: 100, moneda: 'USD', montoDestino: null, fecha: '2026-10-05',
  descripcion: '', referencia: '', bancaOrigenId: 'b1', bancaDestinoId: null, categoriaId: null, anulado: false, mesaCambistaId: null, mesaEstado: null, ...o,
});
const entrada = { bancaId: 'b1', categorias: [], nombresBancas: new Map<string, string>(), permitidas: null, monedaCuenta: 'USD' } as const;

describe('construirReporteCuenta: saldo corrido', () => {
  it('parte del saldo inicial y deja el saldo tras cada movimiento', () => {
    const r = construirReporteCuenta({
      ...entrada,
      saldoInicial: 50,
      movimientos: [
        mov({ id: 'a', numeroSistema: 1, monto: 100 }),
        mov({ id: 'b', numeroSistema: 2, tipo: 'egreso', monto: 30.1 }),
        mov({ id: 'c', numeroSistema: 3, fecha: '2026-10-06', monto: 0.2 }),
      ],
    });
    expect(r.filas.map(f => f.saldo)).toEqual([150, 119.9, 120.1]);
    expect(r.saldoInicial).toBe(50);
    expect(r.saldoFinal).toBe(120.1);
  });
  it('un movimiento anulado no cambia el saldo', () => {
    const r = construirReporteCuenta({
      ...entrada,
      movimientos: [mov({ id: 'a', numeroSistema: 1, monto: 100 }), mov({ id: 'b', numeroSistema: 2, tipo: 'egreso', monto: 40, anulado: true })],
    });
    expect(r.filas.map(f => f.saldo)).toEqual([100, 100]);
  });
  it('en una transferencia resta del origen y suma lo recibido en el destino', () => {
    const t = mov({ tipo: 'transferencia', bancaOrigenId: 'b2', bancaDestinoId: 'b1', monto: 10, montoDestino: 4000, moneda: 'USD' });
    expect(construirReporteCuenta({ ...entrada, movimientos: [t] }).filas[0].saldo).toBe(4000);
    expect(construirReporteCuenta({ ...entrada, bancaId: 'b2', movimientos: [t] }).filas[0].saldo).toBe(-10);
  });
  it('saldoDeMovimientos ignora anulados y sin movimientos es 0', () => {
    expect(saldoDeMovimientos('b1', [])).toBe(0);
    expect(saldoDeMovimientos('b1', [mov({ monto: 80 }), mov({ id: 'x', tipo: 'egreso', monto: 30 }), mov({ id: 'y', monto: 999, anulado: true })])).toBe(50);
  });
});

const tasas: TasaHistorica[] = [
  { tasa: 40, fecha: '2026-10-05T14:00:00Z', fuente: 'BCV' },
  { tasa: 60, fecha: '2026-10-05T15:00:00Z', fuente: 'Binance' },
  { tasa: 70, fecha: '2026-10-05T20:00:00Z', fuente: 'Binance' },
];

describe('equivalente en USD a la tasa Binance del momento', () => {
  it('usa la hora real del movimiento si cae en el día de su fecha', () => {
    expect(instanteDeMovimiento('2026-10-05', '2026-10-05T16:30:00Z')).toBe('2026-10-05T16:30:00.000Z');
    expect(tasaVigenteA(tasas, instanteDeMovimiento('2026-10-05', '2026-10-05T16:30:00Z'))).toBe(60);
  });
  it('con fecha atrasada o sin hora toma el final del día de la fecha', () => {
    expect(instanteDeMovimiento('2026-10-05', '2026-10-09T10:00:00Z')).toBe('2026-10-06T03:59:59.999Z');
    expect(tasaVigenteA(tasas, instanteDeMovimiento('2026-10-05'))).toBe(70);
  });
  it('aplicarEquivalentes calcula solo los Bs sin monto_usd y no muta la entrada', () => {
    const base = { fecha: '2026-10-05', creadoEn: '2026-10-05T16:30:00Z' };
    const entrada = [
      { id: 'a', moneda: 'VES', monto: 600, montoUsd: null, ...base },
      { id: 'b', moneda: 'VES', monto: 600, montoUsd: 12, ...base },
      { id: 'c', moneda: 'USD', monto: 5, montoUsd: null, ...base },
    ];
    const r = aplicarEquivalentes(entrada, tasas);
    expect((r[0] as { equivalenteUsd?: number | null }).equivalenteUsd).toBe(10);
    expect('equivalenteUsd' in r[1]).toBe(false);
    expect('equivalenteUsd' in r[2]).toBe(false);
    expect('equivalenteUsd' in entrada[0]).toBe(false);
  });
  it('sin tasa vigente el equivalente es null', () => {
    const r = aplicarEquivalentes([{ moneda: 'VES', monto: 600, montoUsd: null, fecha: '2026-09-01', creadoEn: '2026-09-01T10:00:00Z' }], tasas);
    expect((r[0] as { equivalenteUsd?: number | null }).equivalenteUsd).toBeNull();
  });
});
