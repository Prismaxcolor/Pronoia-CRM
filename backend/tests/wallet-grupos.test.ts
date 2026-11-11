import { describe, it, expect } from 'vitest';
import { agruparCuentas, formatearMonto, grupoDeBanca, totalEnUsd } from '../../frontend/src/features/wallet/wallet-grupos';
import type { Banca } from '../../shared/types/index.js';

const banca = (id: string, tipo: Banca['tipo'], extra: Partial<Banca> = {}): Banca => ({
  id, nombre: id, tipo, saldo: 0, moneda: 'USD', descripcion: '', archivada: false, ...extra,
});

describe('grupo de cuenta de la Wallet nueva', () => {
  it('usa el grupo guardado y, si falta, lo deduce del tipo', () => {
    expect(grupoDeBanca({ tipo: 'efectivo', grupoWallet: null })).toBe('efectivo');
    expect(grupoDeBanca({ tipo: 'banco_nacional' })).toBe('corriente');
    expect(grupoDeBanca({ tipo: 'banco_internacional', grupoWallet: null })).toBe('corriente');
    expect(grupoDeBanca({ tipo: 'exchange' })).toBe('general');
    expect(grupoDeBanca({ tipo: 'efectivo', grupoWallet: 'inversiones' })).toBe('inversiones');
  });

  it('agrupa en el orden fijo, omite grupos vacíos y conserva el orden dentro del grupo', () => {
    const secciones = agruparCuentas([
      banca('binance', 'exchange'),
      banca('caja2', 'efectivo'),
      banca('oro', 'efectivo', { grupoWallet: 'ahorros' }),
      banca('caja1', 'efectivo'),
    ]);
    expect(secciones.map(s => s.grupo.clave)).toEqual(['efectivo', 'ahorros', 'general']);
    expect(secciones[0].cuentas.map(c => c.id)).toEqual(['caja2', 'caja1']);
  });

  it('no muta la lista recibida', () => {
    const entrada = [banca('a', 'efectivo'), banca('b', 'exchange')];
    agruparCuentas(entrada);
    expect(entrada.map(b => b.id)).toEqual(['a', 'b']);
  });
});

describe('formato de montos', () => {
  it('pone el signo delante del símbolo y deja Bs separado', () => {
    expect(formatearMonto(1234.5, 'USD')).toBe('$1.234,50');
    expect(formatearMonto(-97650.11, 'USD')).toBe('-$97.650,11');
    expect(formatearMonto(67886.5, 'VES')).toBe('Bs 67.886,50');
    expect(formatearMonto(-0.001, 'USD')).toBe('$0,00');
  });
});

describe('total en USD', () => {
  it('suma USD y convierte Bs con la tasa', () => {
    const r = totalEnUsd([{ saldo: 100, moneda: 'USD' }, { saldo: 600, moneda: 'VES' }], 60);
    expect(r).toEqual({ totalUsd: 110, omitidas: 0 });
  });
  it('sin tasa no inventa: cuenta las cuentas en Bs como omitidas', () => {
    const r = totalEnUsd([{ saldo: 100, moneda: 'USD' }, { saldo: 600, moneda: 'VES' }], null);
    expect(r).toEqual({ totalUsd: 100, omitidas: 1 });
  });
  it('omite monedas sin conversión conocida y respeta los saldos negativos', () => {
    const r = totalEnUsd([{ saldo: -50, moneda: 'USD' }, { saldo: 10, moneda: 'EUR' }], 60);
    expect(r).toEqual({ totalUsd: -50, omitidas: 1 });
  });
});
