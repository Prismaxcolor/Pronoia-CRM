import { describe, it, expect } from 'vitest';
import { validarMovimiento, type EntradaValidacion } from '../../frontend/src/features/cochinito/validar-movimiento';
import {
  bloqueoPorComision, mostrarAvisoMesaSinComision, TEXTO_MESA_SIN_COMISION_BANCARIA, ofrecerComision, estadoDeConfig,
} from '../../frontend/src/features/cochinito/comision-formulario';
import { FORMULARIO_MESA_VACIO } from '../../frontend/src/features/cochinito/transferencia-mesa';

const planSinComision = { ok: true as const, aplica: false as const, comision: 0, totalDebitado: 100 };

const entrada = (extra: Partial<EntradaValidacion> = {}): EntradaValidacion => ({
  tipo: 'egreso',
  banca: { moneda: 'USD', saldo: 500 },
  monto: 100,
  bloqueoComision: null,
  planComision: planSinComision,
  categoriaFalta: null,
  destino: undefined,
  monedasDistintas: false,
  montoDestino: 0,
  mesa: { activa: false, form: FORMULARIO_MESA_VACIO },
  ...extra,
});

describe('validarMovimiento', () => {
  it('un egreso correcto no tiene error', () => {
    expect(validarMovimiento(entrada())).toBeNull();
  });

  it('exige tipo, cuenta y monto en ese orden', () => {
    expect(validarMovimiento(entrada({ tipo: '' }))).toMatchObject({ campo: 'general', mensaje: expect.stringContaining('tipo de movimiento') });
    expect(validarMovimiento(entrada({ banca: undefined }))).toMatchObject({ mensaje: expect.stringContaining('cuenta o caja') });
    expect(validarMovimiento(entrada({ monto: 0 }))).toMatchObject({ mensaje: 'El monto debe ser mayor a 0.' });
  });

  it('rechaza mas de 2 decimales en el monto antes de enviarlo', () => {
    expect(validarMovimiento(entrada({ monto: 10.005 }))).toMatchObject({ mensaje: expect.stringContaining('2 decimales') });
    expect(validarMovimiento(entrada({ monto: 10.25 }))).toBeNull();
  });

  it('un egreso o transferencia que excede el saldo se rechaza; un ingreso no', () => {
    expect(validarMovimiento(entrada({ monto: 600 }))).toMatchObject({ mensaje: expect.stringContaining('Saldo insuficiente') });
    expect(validarMovimiento(entrada({ tipo: 'ingreso', monto: 600 }))).toBeNull();
  });

  it('la comision no verificada bloquea con su mensaje', () => {
    expect(validarMovimiento(entrada({ bloqueoComision: 'Verificando la comisión' }))).toEqual({ campo: 'general', mensaje: 'Verificando la comisión' });
  });

  it('un plan de comision invalido devuelve su error', () => {
    expect(validarMovimiento(entrada({ planComision: { ok: false, error: 'Elige Sí o No' } }))).toEqual({ campo: 'general', mensaje: 'Elige Sí o No' });
  });

  it('la categoria faltante se reporta en su propio campo', () => {
    expect(validarMovimiento(entrada({ categoriaFalta: 'Elige una categoría' }))).toEqual({ campo: 'categoria', mensaje: 'Elige una categoría' });
  });

  describe('transferencias', () => {
    const t = (extra: Partial<EntradaValidacion> = {}) => entrada({ tipo: 'transferencia', ...extra });

    it('exige la banca destino', () => {
      expect(validarMovimiento(t())).toMatchObject({ mensaje: 'Selecciona la banca destino.' });
    });

    it('entre monedas distintas exige el monto destino (a centavos)', () => {
      const base = { destino: { moneda: 'VES' }, monedasDistintas: true };
      expect(validarMovimiento(t({ ...base, montoDestino: 0 }))).toMatchObject({ mensaje: 'Ingresa el monto que llega a la banca destino.' });
      expect(validarMovimiento(t({ ...base, montoDestino: 10.001 }))).toMatchObject({ mensaje: expect.stringContaining('2 decimales') });
      expect(validarMovimiento(t({ ...base, montoDestino: 4000 }))).toBeNull();
    });

    it('con mesa de cambio exige el cambista y valida el plan', () => {
      const mesa = (cambistaId: string, montoUsd = '') => ({ activa: true, form: { ...FORMULARIO_MESA_VACIO, cambistaId, montoUsd } });
      expect(validarMovimiento(t({ destino: { moneda: 'USD' }, mesa: mesa('') }))).toMatchObject({ mensaje: 'Elige el cambista de la mesa de cambio.' });
      expect(validarMovimiento(t({ destino: { moneda: 'USD' }, mesa: mesa('c-1') }))).toBeNull();
      // VES a VES sin el equivalente en USD: el plan lo rechaza
      const ves = t({ banca: { moneda: 'VES', saldo: 500 }, destino: { moneda: 'VES' }, mesa: mesa('c-1') });
      expect(validarMovimiento(ves)).toMatchObject({ mensaje: expect.stringContaining('USD') });
      expect(validarMovimiento({ ...ves, mesa: mesa('c-1', '2,5') })).toBeNull();
    });
  });
});

describe('estado de la comision bancaria', () => {
  const salidaBs = { tipo: 'egreso' as const, moneda: 'VES', mesaActiva: false };

  it('estadoDeConfig traduce la respuesta del servicio', () => {
    expect(estadoDeConfig({ disponible: true })).toBe('disponible');
    expect(estadoDeConfig({ disponible: false })).toBe('no-disponible');
    expect(estadoDeConfig({ error: 'sin red' })).toBe('error');
  });

  it('mientras carga o en error bloquea las salidas desde una cuenta en Bs, con mensaje claro', () => {
    expect(bloqueoPorComision({ ...salidaBs, estado: 'cargando' })).toMatch(/verific/i);
    expect(bloqueoPorComision({ ...salidaBs, estado: 'error' })).toMatch(/reintent/i);
    expect(bloqueoPorComision({ ...salidaBs, tipo: 'transferencia', estado: 'error' })).not.toBeNull();
  });

  it('no bloquea si la comision esta disponible o no disponible (migracion pendiente)', () => {
    expect(bloqueoPorComision({ ...salidaBs, estado: 'disponible' })).toBeNull();
    expect(bloqueoPorComision({ ...salidaBs, estado: 'no-disponible' })).toBeNull();
  });

  it('no bloquea lo que no lleva comision: ingresos, cuentas en USD, mesa de cambio, sin tipo', () => {
    expect(bloqueoPorComision({ ...salidaBs, tipo: 'ingreso', estado: 'error' })).toBeNull();
    expect(bloqueoPorComision({ ...salidaBs, moneda: 'USD', estado: 'error' })).toBeNull();
    expect(bloqueoPorComision({ ...salidaBs, mesaActiva: true, estado: 'error' })).toBeNull();
    expect(bloqueoPorComision({ ...salidaBs, tipo: '', estado: 'error' })).toBeNull();
  });

  it('con mesa de cambio activa en una salida desde Bs se avisa que no se cobra la comision bancaria', () => {
    const e = { disponible: true, tipo: 'transferencia' as const, moneda: 'VES', mesaActiva: true };
    expect(mostrarAvisoMesaSinComision(e)).toBe(true);
    expect(TEXTO_MESA_SIN_COMISION_BANCARIA).toBe('La mesa de cambio tiene su propia comisión; no se cobra la comisión bancaria 0.3%');
    expect(ofrecerComision(e)).toBe(false);
  });

  it('el aviso de mesa no aparece si no habria comision bancaria de todos modos', () => {
    const e = { disponible: true, tipo: 'transferencia' as const, moneda: 'VES', mesaActiva: true };
    expect(mostrarAvisoMesaSinComision({ ...e, mesaActiva: false })).toBe(false);
    expect(mostrarAvisoMesaSinComision({ ...e, moneda: 'USD' })).toBe(false);
    expect(mostrarAvisoMesaSinComision({ ...e, disponible: false })).toBe(false);
    expect(mostrarAvisoMesaSinComision({ ...e, tipo: '' })).toBe(false);
  });
});
