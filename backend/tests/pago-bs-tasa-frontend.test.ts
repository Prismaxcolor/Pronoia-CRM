import { describe, it, expect } from 'vitest';
import {
  FUENTE_TASA_PAGO_INICIAL, errorEleccionComisionPago, llevaComisionDeLinea, montoBsDePago, resumenPagoBs, tasaDePago,
} from '../../frontend/src/features/estado-cuenta/pago-bs-tasa';
import type { TasasUsd } from '../../shared/types/equivalente-usd';

const TASAS: TasasUsd = {
  binance: { tasa: 600, fecha: '2026-10-16T12:00:00Z' },
  bcv: { tasa: 480, fecha: '2026-10-16T08:00:00Z' },
};
const SIN_TASAS: TasasUsd = { binance: null, bcv: null };

describe('tasaDePago', () => {
  it('toma la tasa Binance o BCV de las ya cargadas', () => {
    expect(tasaDePago('binance', TASAS, '')).toBe(600);
    expect(tasaDePago('bcv', TASAS, '')).toBe(480);
  });
  it('la manual sale del texto escrito (acepta coma decimal)', () => {
    expect(tasaDePago('manual', TASAS, '510.5')).toBe(510.5);
    expect(tasaDePago('manual', TASAS, '510,5')).toBe(510.5);
  });
  it('devuelve null si la tasa no está disponible o no es válida; nunca usa otra de reemplazo', () => {
    expect(tasaDePago('binance', SIN_TASAS, '')).toBeNull();
    expect(tasaDePago('bcv', { ...TASAS, bcv: null }, '')).toBeNull();
    expect(tasaDePago('manual', TASAS, '')).toBeNull();
    expect(tasaDePago('manual', TASAS, '0')).toBeNull();
    expect(tasaDePago('manual', TASAS, '-5')).toBeNull();
    expect(tasaDePago('manual', TASAS, 'abc')).toBeNull();
  });
  it('por defecto se usa BCV (lo que hacía el formulario antes de poder elegir)', () => {
    expect(FUENTE_TASA_PAGO_INICIAL).toBe('bcv');
  });
});

describe('montoBsDePago', () => {
  it('multiplica USD por la tasa y redondea a centavos', () => {
    expect(montoBsDePago(100, 600)).toBe(60000);
    expect(montoBsDePago(33.33, 481.234)).toBe(16039.53);
  });
  it('sin tasa o con un monto no válido devuelve null', () => {
    expect(montoBsDePago(100, null)).toBeNull();
    expect(montoBsDePago(0, 600)).toBeNull();
    expect(montoBsDePago(Number.NaN, 600)).toBeNull();
  });
});

describe('resumenPagoBs', () => {
  it('describe el equivalente USD y Bs con la fuente usada', () => {
    expect(resumenPagoBs(100, 'binance', 600)).toBe('USD 100,00 = Bs 60.000,00 (tasa Binance: Bs 600,00 por USD)');
    expect(resumenPagoBs(50, 'manual', 500)).toBe('USD 50,00 = Bs 25.000,00 (tasa manual: Bs 500,00 por USD)');
  });
  it('sin tasa avisa en vez de inventar un monto', () => {
    expect(resumenPagoBs(100, 'bcv', null)).toBe('Tasa BCV no disponible: elige otra o escribe una tasa manual.');
    expect(resumenPagoBs(100, 'manual', null)).toBe('Escribe la tasa manual (Bs por USD).');
  });
  it('sin monto no muestra nada', () => {
    expect(resumenPagoBs(0, 'bcv', 480)).toBe('');
  });
});

describe('llevaComisionDeLinea', () => {
  it('solo manda la elección en cuentas en Bs con la comisión habilitada', () => {
    expect(llevaComisionDeLinea('si', true, true)).toBe(true);
    expect(llevaComisionDeLinea('no', true, true)).toBe(false);
    expect(llevaComisionDeLinea('', true, true)).toBeUndefined();
    expect(llevaComisionDeLinea('si', false, true)).toBeUndefined();
    expect(llevaComisionDeLinea('si', true, false)).toBeUndefined();
  });
});

describe('errorEleccionComisionPago', () => {
  it('pide elegir en una cuenta en Bs cuando la comisión está habilitada', () => {
    expect(errorEleccionComisionPago('', 'Banesco')).toMatch(/Banesco/);
    expect(errorEleccionComisionPago('si', 'Banesco')).toBeNull();
    expect(errorEleccionComisionPago('no', 'Banesco')).toBeNull();
  });
});
