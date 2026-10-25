import { describe, it, expect } from 'vitest';
import {
  esTransferenciaEnProceso, etiquetaEstadoMesa, montoQueRecibeElDestino,
} from '../../frontend/src/features/cochinito/detalle-movimiento';
import { montoCobradoMesa, montoPendienteMesa, validarCobroMesa } from '../../frontend/src/features/cochinito/cobro-mesa';

const mov = (extra: Record<string, unknown> = {}) => ({
  anulado: false, monto: 1000, montoDestino: null, mesaCambistaId: 'c-1', mesaEstado: 'en_proceso' as const,
  mesaMontoBruto: 1000, mesaComision: 20, mesaMontoCobrado: 0, ...extra,
});

describe('estado de una transferencia con cobro parcial', () => {
  it('parcial sigue pendiente de cobro: badge "Cobro parcial" y se puede cobrar el resto', () => {
    const m = mov({ mesaEstado: 'parcial', mesaMontoCobrado: 400 });
    expect(esTransferenciaEnProceso(m)).toBe(true);
    expect(etiquetaEstadoMesa(m)).toBe('Cobro parcial');
  });

  it('el monto que recibirá el destino en total sigue siendo bruto menos comisión', () => {
    expect(montoQueRecibeElDestino(mov({ mesaEstado: 'parcial', mesaMontoCobrado: 400 }))).toBe(980);
  });

  it('completada y anulada no tienen pendiente', () => {
    expect(esTransferenciaEnProceso(mov({ mesaEstado: 'completada', montoDestino: 980, mesaMontoCobrado: 980 }))).toBe(false);
    expect(etiquetaEstadoMesa(mov({ mesaEstado: 'parcial', anulado: true }))).toBeNull();
  });
});

describe('cobrado y pendiente', () => {
  it('en proceso: nada cobrado, pendiente = neto', () => {
    expect(montoCobradoMesa(mov())).toBe(0);
    expect(montoPendienteMesa(mov())).toBe(980);
  });

  it('parcial: pendiente = neto - cobrado, a centavos', () => {
    expect(montoPendienteMesa(mov({ mesaEstado: 'parcial', mesaMontoCobrado: 400.1 }))).toBe(579.9);
  });

  it('completada: cobrado = lo acreditado, pendiente 0 (también filas anteriores a la migración, sin mesaMontoCobrado)', () => {
    const m = mov({ mesaEstado: 'completada', montoDestino: 980, mesaMontoCobrado: null });
    expect(montoCobradoMesa(m)).toBe(980);
    expect(montoPendienteMesa(m)).toBe(0);
  });

  it('movimiento sin mesa: null', () => {
    expect(montoPendienteMesa(mov({ mesaCambistaId: null, mesaEstado: null }))).toBeNull();
  });
});

describe('validarCobroMesa', () => {
  it('cobro total: sin monto y completa', () => {
    expect(validarCobroMesa({ parcial: false, texto: '', pendiente: 980 })).toEqual({ ok: true, montoCobrado: null, quedaPendiente: 0 });
  });

  it('parcial válido: acepta coma decimal y calcula lo que queda', () => {
    expect(validarCobroMesa({ parcial: true, texto: '400,5', pendiente: 980 })).toEqual({ ok: true, montoCobrado: 400.5, quedaPendiente: 579.5 });
  });

  it('parcial por el total equivale a completar (queda 0 pendiente)', () => {
    expect(validarCobroMesa({ parcial: true, texto: '980', pendiente: 980 })).toEqual({ ok: true, montoCobrado: 980, quedaPendiente: 0 });
  });

  it('rechaza vacío, cero, negativo, mayor al pendiente y fracciones de centavo', () => {
    for (const texto of ['', '0', '-5', 'abc', '980,01', '10.123']) {
      expect(validarCobroMesa({ parcial: true, texto, pendiente: 980 })).toMatchObject({ ok: false });
    }
  });
});
