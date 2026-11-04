import { describe, it, expect } from 'vitest';
import { LIMITE_MOVIMIENTOS_CARGO, armarCargo, type EntradaCargo } from '../src/utils/nomina-cargo';
import {
  TEXTO_SIN_TASA_BINANCE, textoDetalleBs, textoEquivalenteDePago, textoMontoMovimiento, textoTasaBinance,
} from '../../frontend/src/features/nomina/nomina-cargo';
import { lineaDePago } from '../../frontend/src/features/nomina/nomina-pago';
import type { MovimientoCargo, PagoNomina } from '../../shared/types/nomina';

const vacio: EntradaCargo = { lineas: [], pagos: [], prestamos: [], cuotas: [] };

const linea = (extra: Partial<EntradaCargo['lineas'][number]> = {}): EntradaCargo['lineas'][number] => ({
  lineaId: 'l1', nominaId: 'n1', nominaNumero: 7, semanaInicio: '2026-10-05', estadoNomina: 'CERRADA', cerradaEn: '2026-10-09T15:00:00Z',
  pagarUsd: 100, pagarBs: 8750, ...extra,
});

const pago = (extra: Partial<EntradaCargo['pagos'][number]> = {}): EntradaCargo['pagos'][number] => ({
  nominaId: 'n1', lineaId: null, monedaPago: 'BS', fecha: '2026-10-09', anulado: false, tasaBinance: 875, tasaBinanceCapturada: '2026-10-09T16:02:00Z', ...extra,
});

describe('armarCargo: pagos de nómina', () => {
  it('una nómina con las dos partes genera un movimiento en divisas y otro en Bs', () => {
    const c = armarCargo({ ...vacio, lineas: [linea()] });
    expect(c.movimientos.map(m => m.tipo).sort()).toEqual(['PAGO_BS', 'PAGO_DIVISAS']);
    const usd = c.movimientos.find(m => m.tipo === 'PAGO_DIVISAS')!;
    expect(usd).toMatchObject({ montoUsd: 100, montoBs: null, equivalenteUsd: null, estado: 'PENDIENTE', fecha: '2026-10-09' });
    expect(usd.concepto).toBe('NOM-0007 · semana del 05/10/2026');
  });

  it('un pago en Bs ya hecho lleva su equivalente en USD a la tasa Binance congelada', () => {
    const c = armarCargo({ ...vacio, lineas: [linea()], pagos: [pago()] });
    expect(c.movimientos.find(m => m.tipo === 'PAGO_BS')).toMatchObject({
      montoBs: 8750, montoUsd: null, equivalenteUsd: 10, tasaBinance: 875, tasaBinanceCapturada: '2026-10-09T16:02:00Z', estado: 'PAGADO', fecha: '2026-10-09',
    });
  });

  it('el equivalente se redondea al centavo', () => {
    const c = armarCargo({ ...vacio, lineas: [linea({ pagarBs: 1000 })], pagos: [pago({ tasaBinance: 875.6505 })] });
    expect(c.movimientos.find(m => m.tipo === 'PAGO_BS')?.equivalenteUsd).toBe(1.14);
  });

  it('sin tasa Binance en el pago: no inventa un equivalente', () => {
    const c = armarCargo({ ...vacio, lineas: [linea()], pagos: [pago({ tasaBinance: null, tasaBinanceCapturada: null })] });
    expect(c.movimientos.find(m => m.tipo === 'PAGO_BS')).toMatchObject({ estado: 'PAGADO', equivalenteUsd: null, tasaBinance: null });
  });

  it('pendiente (cerrada sin pagar): sin equivalente todavía', () => {
    const m = armarCargo({ ...vacio, lineas: [linea()] }).movimientos.find(x => x.tipo === 'PAGO_BS')!;
    expect(m).toMatchObject({ estado: 'PENDIENTE', equivalenteUsd: null, tasaBinance: null });
  });

  it('nómina anulada tras cerrarse: anulado, sin equivalente; una anulada que nunca se cerró no aparece', () => {
    const anulada = armarCargo({ ...vacio, lineas: [linea({ estadoNomina: 'ANULADA' })], pagos: [pago({ anulado: true })] });
    expect(anulada.movimientos.every(m => m.estado === 'ANULADO')).toBe(true);
    expect(anulada.movimientos.find(m => m.tipo === 'PAGO_BS')?.equivalenteUsd).toBeNull();
    expect(armarCargo({ ...vacio, lineas: [linea({ estadoNomina: 'ANULADA', cerradaEn: null })] }).movimientos).toEqual([]);
    expect(armarCargo({ ...vacio, lineas: [linea({ estadoNomina: 'BORRADOR', cerradaEn: null })] }).movimientos).toEqual([]);
  });

  it('solo se muestra la parte que cobra: sin Bs no hay movimiento en Bs, sin divisas no hay en divisas', () => {
    expect(armarCargo({ ...vacio, lineas: [linea({ pagarBs: 0 })] }).movimientos.map(m => m.tipo)).toEqual(['PAGO_DIVISAS']);
    expect(armarCargo({ ...vacio, lineas: [linea({ pagarUsd: 0 })] }).movimientos.map(m => m.tipo)).toEqual(['PAGO_BS']);
    expect(armarCargo({ ...vacio, lineas: [linea({ pagarUsd: 0, pagarBs: null })] }).movimientos).toEqual([]);
  });

  it('la fecha de un movimiento sin pago es el día del cierre en Caracas, no el UTC', () => {
    const m = armarCargo({ ...vacio, lineas: [linea({ cerradaEn: '2026-10-10T02:00:00Z', pagarBs: 0 })] }).movimientos[0];
    expect(m.fecha).toBe('2026-10-09');
  });
});

describe('armarCargo: pago por trabajador', () => {
  it('el pago individual de OTRO trabajador de la misma nómina no marca como pagado a este', () => {
    const c = armarCargo({ ...vacio, lineas: [linea()], pagos: [pago({ lineaId: 'l-otro' })] });
    expect(c.movimientos.find(m => m.tipo === 'PAGO_BS')).toMatchObject({ estado: 'PENDIENTE', equivalenteUsd: null });
  });

  it('el pago individual de este trabajador sí lo marca como pagado, con su propia tasa congelada', () => {
    const c = armarCargo({ ...vacio, lineas: [linea()], pagos: [pago({ lineaId: 'l1', tasaBinance: 500 }), pago({ lineaId: 'l-otro', tasaBinance: 900 })] });
    expect(c.movimientos.find(m => m.tipo === 'PAGO_BS')).toMatchObject({ estado: 'PAGADO', tasaBinance: 500, equivalenteUsd: 17.5 });
  });

  it('el pago de toda la nómina (sin renglón) cubre a todos sus trabajadores', () => {
    const c = armarCargo({ ...vacio, lineas: [linea(), linea({ lineaId: 'l2' })], pagos: [pago({ lineaId: null })] });
    expect(c.movimientos.filter(m => m.tipo === 'PAGO_BS').every(m => m.estado === 'PAGADO')).toBe(true);
  });
});

describe('armarCargo: préstamos y cuotas', () => {
  const prestamo = { id: 'p1', numero: 2, tipo: 'PRESTAMO' as const, montoUsd: 50, saldoUsd: 30, fecha: '2026-09-28', estado: 'ACTIVO' as const };

  it('préstamo, adelanto, cuota y reversa en USD, con su estado', () => {
    const c = armarCargo({
      ...vacio,
      prestamos: [prestamo, { ...prestamo, id: 'p2', numero: 3, tipo: 'ADELANTO', saldoUsd: 0, estado: 'ANULADO' }],
      cuotas: [
        { id: 'c1', tipo: 'CUOTA', montoUsd: 20, creadoEn: '2026-10-09T15:00:00Z', prestamoNumero: 2, nominaNumero: 7 },
        { id: 'c2', tipo: 'REVERSA', montoUsd: 20, creadoEn: '2026-10-10T15:00:00Z', prestamoNumero: 2, nominaNumero: 7 },
      ],
    });
    const por = (t: string) => c.movimientos.filter(m => m.tipo === t);
    expect(por('PRESTAMO')[0]).toMatchObject({ montoUsd: 50, montoBs: null, estado: 'VIGENTE', concepto: 'PRE-0002', fecha: '2026-09-28' });
    expect(por('ADELANTO')[0]).toMatchObject({ estado: 'ANULADO', concepto: 'PRE-0003' });
    expect(por('CUOTA')[0]).toMatchObject({ montoUsd: 20, concepto: 'PRE-0002 · NOM-0007', fecha: '2026-10-09' });
    expect(por('REVERSA')[0]).toMatchObject({ montoUsd: 20, fecha: '2026-10-10' });
    expect(c.saldoPrestamosUsd).toBe(30); // solo cuenta el préstamo activo
  });

  it('un préstamo pagado del todo se marca como pagado', () => {
    const c = armarCargo({ ...vacio, prestamos: [{ ...prestamo, saldoUsd: 0, estado: 'PAGADO' }] });
    expect(c.movimientos[0].estado).toBe('PAGADO');
    expect(c.saldoPrestamosUsd).toBe(0);
  });

  it('el saldo se suma en centavos exactos', () => {
    const c = armarCargo({ ...vacio, prestamos: [{ ...prestamo, saldoUsd: 0.1 }, { ...prestamo, id: 'p3', numero: 4, saldoUsd: 0.2 }] });
    expect(c.saldoPrestamosUsd).toBe(0.3);
  });
});

describe('armarCargo: orden y límite', () => {
  it('del más reciente al más antiguo, con desempate estable', () => {
    const c = armarCargo({
      ...vacio,
      prestamos: [{ id: 'p1', numero: 1, tipo: 'PRESTAMO', montoUsd: 10, saldoUsd: 10, fecha: '2026-10-01', estado: 'ACTIVO' }],
      lineas: [linea({ pagarBs: 0, cerradaEn: '2026-10-09T15:00:00Z' })],
    });
    expect(c.movimientos.map(m => m.fecha)).toEqual(['2026-10-09', '2026-10-01']);
  });

  it('se queda con los últimos movimientos', () => {
    const prestamos = Array.from({ length: LIMITE_MOVIMIENTOS_CARGO + 20 }, (_, i) => ({
      id: `p${i}`, numero: i + 1, tipo: 'PRESTAMO' as const, montoUsd: 1, saldoUsd: 1, fecha: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, estado: 'ACTIVO' as const,
    }));
    const c = armarCargo({ ...vacio, prestamos });
    expect(c.movimientos).toHaveLength(LIMITE_MOVIMIENTOS_CARGO);
    expect(c.saldoPrestamosUsd).toBe(LIMITE_MOVIMIENTOS_CARGO + 20); // el saldo cuenta TODOS, no solo los visibles
  });

  it('no muta la entrada', () => {
    const entrada: EntradaCargo = { ...vacio, lineas: [linea()], pagos: [pago()] };
    const copia = JSON.stringify(entrada);
    armarCargo(entrada);
    expect(JSON.stringify(entrada)).toBe(copia);
  });
});

describe('textos del cargo (frontend)', () => {
  const m = (extra: Partial<MovimientoCargo> = {}): MovimientoCargo => ({
    id: 'x', tipo: 'PAGO_BS', fecha: '2026-10-09', concepto: 'NOM-0007', estado: 'PAGADO', montoUsd: null, montoBs: 8750,
    equivalenteUsd: 10, tasaBinance: 875, tasaBinanceCapturada: '2026-10-09T16:02:00Z', ...extra,
  });

  it('monto en Bs o en USD', () => {
    expect(textoMontoMovimiento(m())).toBe('Bs 8.750,00');
    expect(textoMontoMovimiento(m({ montoBs: null, montoUsd: 100 }))).toBe('USD 100,00');
  });

  it('detalle de un movimiento en Bs: equivalente, tasa y hora de captura (Caracas)', () => {
    expect(textoDetalleBs(m())).toBe('≈ USD 10,00 · Tasa Binance 875,00 (captura 09/10/2026 12:02)');
  });

  it('si la captura no es del día del pago se avisa cuál se usó', () => {
    const t = textoDetalleBs(m({ tasaBinanceCapturada: '2026-10-08T22:00:00Z' }));
    expect(t).toMatch(/anterior más cercana/);
    expect(t).toMatch(/08\/10\/2026 18:00/);
  });

  it('pendiente, anulado, USD y sin tasa', () => {
    expect(textoDetalleBs(m({ estado: 'PENDIENTE', equivalenteUsd: null, tasaBinance: null, tasaBinanceCapturada: null }))).toMatch(/fija al pagar/);
    expect(textoDetalleBs(m({ estado: 'ANULADO' }))).toBeNull();
    expect(textoDetalleBs(m({ montoBs: null, montoUsd: 5 }))).toBeNull();
    expect(textoDetalleBs(m({ equivalenteUsd: null, tasaBinance: null, tasaBinanceCapturada: null }))).toBe(TEXTO_SIN_TASA_BINANCE);
  });

  it('textoTasaBinance sin tasa es null; el equivalente de un pago usa la fecha del pago', () => {
    expect(textoTasaBinance({ tasaBinance: null, tasaBinanceCapturada: null }, '2026-10-09')).toBeNull();
    expect(textoEquivalenteDePago({ tasaBinance: 875, tasaBinanceCapturada: '2026-10-09T16:02:00Z', equivalenteBinanceUsd: 10, fecha: '2026-10-09' }))
      .toBe('≈ USD 10,00 · Tasa Binance 875,00 (captura 09/10/2026 12:02)');
  });
});

describe('línea de pago con equivalente', () => {
  const p = (extra: Partial<PagoNomina> = {}): PagoNomina => ({
    id: 'p', monedaPago: 'BS', bancaId: 'b', bancaNombre: 'CAJA BS', movimientoId: 'm', movimientoNumero: 12, anulado: false, monto: 8750,
    montoUsd: 10, cantidad: 2, fecha: '2026-10-09', referencia: null, pagadoEn: '2026-10-09T16:05:00Z',
    tasaBinance: 875, tasaBinanceCapturada: '2026-10-09T16:02:00Z', equivalenteBinanceUsd: 10, ...extra,
  });

  it('un pago en Bs muestra su equivalente a la tasa Binance; sin tasa queda como antes', () => {
    expect(lineaDePago(p())).toBe('Bs 8.750,00 (≈ USD 10,00 a tasa Binance 875,00) desde CAJA BS · MV-0012 · 09/10/2026');
    expect(lineaDePago(p({ tasaBinance: null, equivalenteBinanceUsd: null, tasaBinanceCapturada: null }))).toBe('Bs 8.750,00 desde CAJA BS · MV-0012 · 09/10/2026');
  });

  it('un pago en USD no lleva equivalente', () => {
    expect(lineaDePago(p({ monedaPago: 'USD', monto: 100, tasaBinance: null, equivalenteBinanceUsd: null }))).toBe('USD 100,00 desde CAJA BS · MV-0012 · 09/10/2026');
  });
});

describe('armarCargo: pago repartido entre varias cuentas', () => {
  it('varias filas de pago de la misma moneda siguen siendo UN movimiento del trabajador, con el monto total', () => {
    const usd = { lineaId: 'l1', monedaPago: 'USD' as const, tasaBinance: null, tasaBinanceCapturada: null };
    const c = armarCargo({ ...vacio, lineas: [linea()], pagos: [pago({ lineaId: 'l1' }), pago({ lineaId: 'l1' }), pago(usd), pago(usd)] });
    expect(c.movimientos.filter(m => m.tipo === 'PAGO_BS')).toHaveLength(1);
    expect(c.movimientos.filter(m => m.tipo === 'PAGO_DIVISAS')).toHaveLength(1);
    expect(c.movimientos.find(m => m.tipo === 'PAGO_BS')).toMatchObject({ montoBs: 8750, equivalenteUsd: 10, estado: 'PAGADO' });
  });
});
