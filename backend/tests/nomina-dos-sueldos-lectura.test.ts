import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));

import { partesDePago } from '../src/utils/nomina-partes-pago';
import { mapNomina } from '../src/services/nomina-service';
import { mapTrabajador } from '../src/services/nomina-trabajador-service';

const lineaNueva = {
  trabajador_id: 't1', trabajador_nombre: 'Ana Pérez', moneda_pago: 'MIXTO', dias_trabajados: '5', monto_base_usd: '20.00',
  monto_base_bs: '400.00', total_bruto_usd: '150.00', bruto_bs: '2000.00', monto_ref_bs: '6000.00', bonificacion_usd: '0',
  descuento_trabajo_usd: '10.00', descuento_prestamo_usd: '0', pagar_usd: '90.00', pagar_bs: '2000.00', total_usd: '140.00',
  total_bs: '5600.00', nota: null, cuotas: [],
};

describe('partesDePago', () => {
  it('renglón con los dos sueldos: lo que se paga en cada moneda sale de sus columnas', () => {
    expect(partesDePago(lineaNueva)).toEqual({ pagarUsd: 90, pagarBs: 2000, equivalenteBsUsd: 50 });
  });

  it('el equivalente no arrastra error de coma flotante', () => {
    expect(partesDePago({ ...lineaNueva, total_usd: '150.10', pagar_usd: '100.05' }).equivalenteBsUsd).toBe(50.05);
  });

  it('renglón anterior a los dos sueldos pagado en USD: todo en divisas', () => {
    const vieja = { moneda_pago: 'USD', total_usd: '100.00', total_bs: '4000.00' };
    expect(partesDePago(vieja)).toEqual({ pagarUsd: 100, pagarBs: 0, equivalenteBsUsd: 0 });
  });

  it('renglón anterior pagado en BS: todo en bolívares, con su equivalente', () => {
    const vieja = { moneda_pago: 'BS', total_usd: '50.00', total_bs: '2000.00' };
    expect(partesDePago(vieja)).toEqual({ pagarUsd: 0, pagarBs: 2000, equivalenteBsUsd: 50 });
  });

  it('pagado en BS sin tasa: los Bs quedan null (no 0)', () => {
    expect(partesDePago({ moneda_pago: 'BS', total_usd: '50.00', total_bs: null }).pagarBs).toBeNull();
  });
});

describe('mapNomina con los dos sueldos', () => {
  const nomina = {
    id: 'n1', numero: 7, tipo: 'OPERATIVO', semana_inicio: '2026-10-05', tasa_bs: '40', estado: 'CERRADA', version: 2,
    cantidad_divisas: 1, cantidad_bs: 1, total_divisas_usd: 90, total_bs: 2000, total_equivalente_usd: 50, total_combinado_usd: 140,
    total_combinado_bs: 5600, lineas: [lineaNueva],
  };

  it('el renglón trae los dos sueldos y las dos partes a pagar', () => {
    const l = mapNomina(nomina).lineas[0];
    expect(l).toMatchObject({
      monedaPago: 'MIXTO', montoBaseUsd: 20, montoBaseBs: 400, brutoBs: 2000, pagarUsd: 90, pagarBs: 2000, equivalenteBsUsd: 50, totalUsd: 140,
    });
  });

  it('un renglón sin las columnas nuevas (antes de la migración) se lee como sueldo solo en divisas', () => {
    const { monto_base_bs: _a, bruto_bs: _b, pagar_usd: _c, pagar_bs: _d, ...vieja } = lineaNueva;
    const l = mapNomina({ ...nomina, lineas: [{ ...vieja, moneda_pago: 'USD', total_usd: '100.00' }] }).lineas[0];
    expect(l).toMatchObject({ montoBaseBs: 0, brutoBs: 0, pagarUsd: 100, pagarBs: 0 });
  });
});

describe('mapTrabajador', () => {
  const fila = {
    id: 't1', tipo: 'OPERATIVO', nombres: 'Ana', apellidos: 'Pérez', cedula: 'V1', pago_diario_usd: '12.50', pago_diario_bs: '350.25',
    activo: true, created_at: '2026-10-01T00:00:00Z',
  };
  it('lee el sueldo en divisas y el sueldo en Bs', () => {
    expect(mapTrabajador(fila)).toMatchObject({ pagoDiarioUsd: 12.5, pagoDiarioBs: 350.25 });
  });
  it('sin la columna nueva el sueldo en Bs es 0', () => {
    const { pago_diario_bs: _x, ...vieja } = fila;
    expect(mapTrabajador(vieja).pagoDiarioBs).toBe(0);
  });
});
