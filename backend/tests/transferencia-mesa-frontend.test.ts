import { describe, it, expect } from 'vitest';
import {
  esTransferenciaEnProceso, etiquetaEstadoMesa, montoQueRecibeElDestino, textoComisionMesa,
} from '../../frontend/src/features/cochinito/detalle-movimiento';
import {
  comisionDeFormulario, cuerpoTransferenciaMesa, leerNumero, planDeFormulario, type FormularioMesa,
} from '../../frontend/src/features/cochinito/transferencia-mesa';

const mov = (extra: Record<string, unknown> = {}) => ({
  anulado: false, monto: 1000, montoDestino: null, mesaCambistaId: 'c-1', mesaEstado: 'en_proceso' as const,
  mesaMontoBruto: 1000, mesaComision: 20, mesaComisionModo: 'porcentaje' as const, mesaComisionPct: 2, moneda: 'USD', ...extra,
});

describe('estado de la transferencia con mesa (Wallet)', () => {
  it('en proceso vigente: badge "En proceso" y aun no recibe el destino', () => {
    expect(esTransferenciaEnProceso(mov())).toBe(true);
    expect(etiquetaEstadoMesa(mov())).toBe('En proceso');
  });

  it('completada: badge "Completada" y deja de estar en proceso', () => {
    const m = mov({ mesaEstado: 'completada', montoDestino: 980 });
    expect(esTransferenciaEnProceso(m)).toBe(false);
    expect(etiquetaEstadoMesa(m)).toBe('Completada');
  });

  it('anulada o movimiento normal: sin badge de mesa', () => {
    expect(esTransferenciaEnProceso(mov({ anulado: true }))).toBe(false);
    expect(etiquetaEstadoMesa(mov({ anulado: true }))).toBeNull();
    expect(etiquetaEstadoMesa(mov({ mesaCambistaId: null, mesaEstado: null }))).toBeNull();
  });

  it('monto que recibira (en proceso) = bruto menos comision; completada = lo acreditado', () => {
    expect(montoQueRecibeElDestino(mov())).toBe(980);
    expect(montoQueRecibeElDestino(mov({ mesaEstado: 'completada', montoDestino: 980 }))).toBe(980);
    expect(montoQueRecibeElDestino(mov({ mesaCambistaId: null, mesaEstado: null }))).toBeNull();
  });

  it('texto de la comision indica porcentaje o monto manual', () => {
    expect(textoComisionMesa(mov(), 'USD')).toBe('USD 20,00 (2%)');
    expect(textoComisionMesa(mov({ mesaComisionModo: 'monto', mesaComisionPct: null }), 'USD')).toBe('USD 20,00 (monto manual)');
    expect(textoComisionMesa(mov({ mesaComision: 0, mesaComisionModo: null, mesaComisionPct: null }), 'USD')).toBe('Sin comisión');
  });
});

describe('formulario de transferencia con mesa', () => {
  const form = (extra: Partial<FormularioMesa> = {}): FormularioMesa => ({
    cambistaId: 'c-1', modo: 'porcentaje', valor: '2', montoUsd: '', ...extra,
  });

  it('lee numeros con coma o punto', () => {
    expect(leerNumero('1,5')).toBe(1.5);
    expect(leerNumero(' 2.25 ')).toBe(2.25);
    expect(leerNumero('')).toBeNull();
    expect(leerNumero('abc')).toBeNull();
  });

  it('sin comision, porcentaje o monto manual', () => {
    expect(comisionDeFormulario(form({ modo: 'ninguna' }))).toBeNull();
    expect(comisionDeFormulario(form())).toEqual({ modo: 'porcentaje', valor: 2 });
    expect(comisionDeFormulario(form({ modo: 'monto', valor: '12,5' }))).toEqual({ modo: 'monto', valor: 12.5 });
    // un valor vacio con modo elegido se trata como invalido (no como 0 silencioso)
    expect(comisionDeFormulario(form({ valor: '' }))).toEqual({ modo: 'porcentaje', valor: Number.NaN });
  });

  const entrada = { monedaOrigen: 'USD', monedaDestino: 'USD', monto: 1000, montoDestino: null, saldoOrigen: 5000 };

  it('el plan muestra comision y neto', () => {
    expect(planDeFormulario(form(), entrada)).toMatchObject({ ok: true, comision: 20, montoNeto: 980, montoUsd: 1000 });
  });

  it('un valor de comision vacio o no numerico se rechaza con mensaje', () => {
    expect(planDeFormulario(form({ valor: '' }), entrada)).toMatchObject({ ok: false });
  });

  it('VES a VES usa el equivalente USD escrito a mano', () => {
    const e = { ...entrada, monedaOrigen: 'VES', monedaDestino: 'VES' };
    expect(planDeFormulario(form({ modo: 'ninguna' }), e)).toMatchObject({ ok: false });
    expect(planDeFormulario(form({ modo: 'ninguna', montoUsd: '25,5' }), e)).toMatchObject({ ok: true, montoUsd: 25.5 });
  });

  it('un equivalente USD escrito antes de elegir una cuenta en USD se descarta (el servidor lo rechazaría)', () => {
    expect(planDeFormulario(form({ modo: 'ninguna', montoUsd: '25,5' }), entrada)).toMatchObject({ ok: true, montoUsd: 1000 });
  });

  const datos = {
    bancaId: 'b-o', bancaDestinoId: 'b-d', monto: 1000, montoDestino: null, descripcion: ' Cambio ', referencia: '', fecha: '2026-10-11',
    comprobantes: ['u'], monedaOrigen: 'VES', monedaDestino: 'VES',
  };

  it('el cuerpo para el servidor lleva cambista, comision y USD manual (cuentas que no son USD)', () => {
    const cuerpo = cuerpoTransferenciaMesa(form({ montoUsd: '30' }), datos);
    expect(cuerpo).toEqual({
      cambistaId: 'c-1', bancaId: 'b-o', bancaDestinoId: 'b-d', monto: 1000, montoDestino: null, montoUsd: 30,
      comision: { modo: 'porcentaje', valor: 2 }, descripcion: 'Cambio', referencia: '', fecha: '2026-10-11', comprobantes: ['u'],
    });
  });

  it('con una cuenta en USD el cuerpo no manda montoUsd aunque el campo tenga texto', () => {
    expect(cuerpoTransferenciaMesa(form({ montoUsd: '30' }), { ...datos, monedaOrigen: 'USD' }).montoUsd).toBeNull();
    expect(cuerpoTransferenciaMesa(form({ montoUsd: '30' }), { ...datos, monedaDestino: 'USD' }).montoUsd).toBeNull();
  });

  it('manda el clientRequestId cuando se le da (reintentos y doble clic no duplican)', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    expect(cuerpoTransferenciaMesa(form(), { ...datos, clientRequestId: id })).toMatchObject({ clientRequestId: id });
    expect(cuerpoTransferenciaMesa(form(), datos)).not.toHaveProperty('clientRequestId');
  });
});
