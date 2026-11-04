import { describe, it, expect } from 'vitest';
import { totalesEstadoCuenta } from '../src/utils/estado-cuenta-totales';
import { totalesEstadoCuenta as totalesFrontend } from '../../shared/types/estado-cuenta-totales';
import { saldoCorrido } from '../../frontend/src/lib/terceros-kpis';
import type { EntradaEstadoCuenta } from '../../frontend/src/services/estado-cuenta-service';

const fila = (tipo: EntradaEstadoCuenta['tipo'], cargo: number, abono: number): EntradaEstadoCuenta => ({
  fecha: '2026-10-01', tipo, descripcion: tipo, referencia: null, cargo, abono,
});

describe('totalesEstadoCuenta', () => {
  it('lista vacía: todo en cero', () => {
    expect(totalesEstadoCuenta([])).toEqual({ moneda: 'USD', filas: 0, totalCargos: 0, totalAbonos: 0, saldoFinal: 0 });
  });

  it('solo cargos', () => {
    const t = totalesEstadoCuenta([fila('factura', 100, 0), fila('factura', 50.5, 0)]);
    expect(t).toMatchObject({ totalCargos: 150.5, totalAbonos: 0, saldoFinal: 150.5 });
  });

  it('cargos y abonos', () => {
    const t = totalesEstadoCuenta([fila('factura', 500, 0), fila('pago', 0, 200)]);
    expect(t).toMatchObject({ filas: 2, totalCargos: 500, totalAbonos: 200, saldoFinal: 300 });
  });

  it('notas de crédito/débito y adelantos; anuladas y cruces valen 0', () => {
    const t = totalesEstadoCuenta([
      fila('factura', 100, 0), fila('adelanto', 0, 30), fila('nota_credito', 0, 10), fila('nota_debito', 5, 0),
      fila('nota_credito', 0, 0), fila('cruce', 0, 0),
    ]);
    expect(t).toMatchObject({ totalCargos: 105, totalAbonos: 40, saldoFinal: 65 });
  });

  it('saldo a favor: saldo final negativo', () => {
    expect(totalesEstadoCuenta([fila('factura', 10, 0), fila('adelanto', 0, 25)]).saldoFinal).toBe(-15);
  });

  it('redondea a centavos sin error de coma flotante', () => {
    const t = totalesEstadoCuenta([fila('factura', 0.1, 0), fila('factura', 0.2, 0), fila('pago', 0, 0.3), fila('factura', 10.005, 0)]);
    expect(t.totalCargos).toBe(10.31);
    expect(t.totalAbonos).toBe(0.3);
    expect(t.saldoFinal).toBe(10.01);
  });

  it('coincide con el saldo acumulado de la última fila', () => {
    const entradas = [
      fila('factura', 33.33, 0), fila('factura', 66.67, 0), fila('pago', 0, 12.34), fila('nota_debito', 7.1, 0),
      fila('nota_credito', 0, 3.3), fila('adelanto', 0, 20.01), fila('cruce', 0, 0),
    ];
    const conSaldo = saldoCorrido(entradas);
    expect(totalesEstadoCuenta(entradas).saldoFinal).toBe(conSaldo[conSaldo.length - 1].saldoCorrido);
  });

  it('el espejo de shared/ (frontend) da lo mismo que el del servidor', () => {
    const entradas = [fila('factura', 0.1, 0), fila('factura', 10.005, 0), fila('pago', 0, 0.3), fila('nota_credito', 0, 1.115)];
    expect(totalesFrontend(entradas)).toEqual(totalesEstadoCuenta(entradas));
    expect(totalesFrontend([])).toEqual(totalesEstadoCuenta([]));
  });
});
