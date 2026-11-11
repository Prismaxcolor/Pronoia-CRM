import { describe, it, expect } from 'vitest';
import {
  expandirPatas, flujoNetoUsdFilas, idsNavegacionDeFilas, usdParaMostrar,
} from '../../frontend/src/features/wallet/registros/registros-patas';
import { MONTO_OCULTO } from '../../frontend/src/features/wallet/wallet-grupos';
import { enmascararSiOculto, filaConCuentaOculta } from '../../frontend/src/features/wallet/registros/registros-privacidad';
import type { Movimiento } from '../../shared/types/index.js';

const mov = (id: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'usd1', bancaDestinoId: null,
  fecha: '2026-11-11', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: null,
  montoDestino: null, creadoEn: '2026-11-11T10:00:00Z', subtipo: null, numero: null, numeroSistema: null, grupoId: null,
  comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...extra,
});

const MONEDAS = new Map([['usd1', 'USD'], ['usd2', 'USD'], ['ves1', 'VES'], ['ves2', 'VES']]);

/** USD -> Bs, sin mesa: salen 100 USD y entran Bs 4.000. */
const usdABs = mov('t1', { tipo: 'transferencia', bancaOrigenId: 'usd1', bancaDestinoId: 'ves1', monto: 100, moneda: 'USD', montoDestino: 4000 });

describe('expandirPatas: transferencias en dos filas virtuales', () => {
  it('sin cuentas elegidas salen ambas patas: origen negativo en su moneda, destino positivo en la suya', () => {
    const filas = expandirPatas([usdABs], MONEDAS, []);
    expect(filas.map(f => f.clave)).toEqual(['t1:origen', 't1:destino']);
    expect(filas[0]).toMatchObject({ pata: 'origen', bancaId: 'usd1', monto: -100, moneda: 'USD' });
    expect(filas[1]).toMatchObject({ pata: 'destino', bancaId: 'ves1', monto: 4000, moneda: 'VES', estadoCobro: 'normal' });
  });

  it('con cuentas elegidas solo salen las patas de esas cuentas', () => {
    expect(expandirPatas([usdABs], MONEDAS, ['ves1']).map(f => f.clave)).toEqual(['t1:destino']);
    expect(expandirPatas([usdABs], MONEDAS, ['usd1']).map(f => f.clave)).toEqual(['t1:origen']);
    expect(expandirPatas([usdABs], MONEDAS, ['usd1', 'ves1']).map(f => f.clave)).toEqual(['t1:origen', 't1:destino']);
    expect(expandirPatas([usdABs], MONEDAS, ['usd2'])).toEqual([]);
  });

  it('ingresos y egresos son una sola fila "unica" con su signo y las claves no se repiten', () => {
    const filas = expandirPatas([mov('e1'), mov('i1', { tipo: 'ingreso' }), usdABs], MONEDAS, []);
    expect(filas.find(f => f.movimiento.id === 'e1')).toMatchObject({ clave: 'e1:unica', monto: -10, pata: 'unica' });
    expect(filas.find(f => f.movimiento.id === 'i1')).toMatchObject({ clave: 'i1:unica', monto: 10 });
    expect(new Set(filas.map(f => f.clave)).size).toBe(filas.length);
  });

  it('transferencia entre cuentas de la misma moneda: destino recibe el mismo monto', () => {
    const t = mov('t2', { tipo: 'transferencia', bancaOrigenId: 'usd1', bancaDestinoId: 'usd2', monto: 50 });
    const [o, d] = expandirPatas([t], MONEDAS, []);
    expect(o.monto).toBe(-50);
    expect(d).toMatchObject({ monto: 50, moneda: 'USD' });
  });

  it('moneda distinta sin monto destino: no inventa el monto (null), no mezcla monedas', () => {
    const t = mov('t3', { tipo: 'transferencia', bancaOrigenId: 'usd1', bancaDestinoId: 'ves1', monto: 20, montoDestino: null });
    const d = expandirPatas([t], MONEDAS, [])[1];
    expect(d.monto).toBeNull();
    expect(d.moneda).toBe('VES');
  });

  it('no muta la entrada', () => {
    const entrada = [usdABs];
    const copia = JSON.stringify(entrada);
    expandirPatas(entrada, MONEDAS, []);
    expect(JSON.stringify(entrada)).toBe(copia);
  });
});

describe('expandirPatas: mesa de cambio', () => {
  const mesa = (extra: Partial<Movimiento>) => mov('m1', {
    tipo: 'transferencia', bancaOrigenId: 'usd1', bancaDestinoId: 'ves1', monto: 100, moneda: 'USD',
    mesaCambistaId: 'c1', mesaMontoBruto: 4000, mesaComision: 100, mesaMontoCobrado: 0, ...extra,
  });

  it('en proceso: la pata destino queda "pendiente" (sin monto) y muestra cuánto falta', () => {
    const d = expandirPatas([mesa({ mesaEstado: 'en_proceso' })], MONEDAS, [])[1];
    expect(d).toMatchObject({ estadoCobro: 'pendiente', monto: null, faltaCobrar: 3900, sumable: false, usd: null });
  });

  it('parcial: muestra lo cobrado y falta cobrar el resto', () => {
    const d = expandirPatas([mesa({ mesaEstado: 'parcial', mesaMontoCobrado: 1000 })], MONEDAS, [])[1];
    expect(d).toMatchObject({ estadoCobro: 'parcial', monto: 1000, faltaCobrar: 2900, sumable: true });
    // 1000 de 3900 del equivalente de 100 USD
    expect(d.usd).toBe(25.64);
  });

  it('completada: lo acreditado al destino', () => {
    const d = expandirPatas([mesa({ mesaEstado: 'completada', montoDestino: 3900, mesaMontoCobrado: 3900 })], MONEDAS, [])[1];
    expect(d).toMatchObject({ estadoCobro: 'normal', monto: 3900, faltaCobrar: null, usd: 100 });
  });

  it('la pata origen siempre sale completa aunque el cobro esté en proceso', () => {
    const o = expandirPatas([mesa({ mesaEstado: 'en_proceso' })], MONEDAS, [])[0];
    expect(o).toMatchObject({ monto: -100, estadoCobro: 'normal', moneda: 'USD' });
  });

  it('anulada: ya no hay "pendiente"', () => {
    const d = expandirPatas([mesa({ mesaEstado: 'en_proceso', anulado: true })], MONEDAS, [])[1];
    expect(d.estadoCobro).toBe('normal');
  });
});

describe('equivalente en USD de la fila', () => {
  it('solo se muestra si la fila está en Bs y hay dato', () => {
    const bs = mov('b1', { moneda: 'VES', monto: 4000, bancaOrigenId: 'ves1', montoUsd: 100 });
    const sinDato = mov('b2', { moneda: 'VES', monto: 4000, bancaOrigenId: 'ves1' });
    const usd = mov('u1', { montoUsd: 10 });
    const [fBs, fSin, fUsd] = expandirPatas([bs, sinDato, usd], MONEDAS, []);
    expect(usdParaMostrar(fBs)).toBe(100);
    expect(usdParaMostrar(fSin)).toBeNull();
    expect(usdParaMostrar(fUsd)).toBeNull();
  });

  it('la pata destino en Bs de una transferencia USD->Bs muestra los USD enviados', () => {
    const d = expandirPatas([usdABs], MONEDAS, [])[1];
    expect(usdParaMostrar(d)).toBe(100);
  });
});

describe('∑ con y sin filtro de cuentas', () => {
  const eg = mov('e1', { monto: 30 });
  const ing = mov('i1', { tipo: 'ingreso', monto: 100 });
  const anulado = mov('a1', { monto: 500, anulado: true });
  const todas = [eg, ing, anulado, usdABs];

  it('sin filtro ignora las transferencias y los anulados', () => {
    const r = flujoNetoUsdFilas(expandirPatas(todas, MONEDAS, []), false);
    expect(r).toEqual({ netoUsd: 70, sinEquivalente: 0 });
  });

  it('con filtro incluye las patas que entran o salen de la selección', () => {
    expect(flujoNetoUsdFilas(expandirPatas([usdABs], MONEDAS, ['ves1']), true).netoUsd).toBe(100);
    expect(flujoNetoUsdFilas(expandirPatas([usdABs], MONEDAS, ['usd1']), true).netoUsd).toBe(-100);
    expect(flujoNetoUsdFilas(expandirPatas([usdABs], MONEDAS, ['usd1', 'ves1']), true).netoUsd).toBe(0);
  });

  it('pata pendiente de mesa no suma ni cuenta como "sin equivalente"', () => {
    const m = mov('m1', { tipo: 'transferencia', bancaOrigenId: 'usd1', bancaDestinoId: 'ves1', monto: 100, mesaCambistaId: 'c', mesaEstado: 'en_proceso', mesaMontoBruto: 4000 });
    expect(flujoNetoUsdFilas(expandirPatas([m], MONEDAS, ['ves1']), true)).toEqual({ netoUsd: 0, sinEquivalente: 0 });
  });

  it('lo que no tiene equivalente se cuenta aparte', () => {
    const bs = mov('b2', { moneda: 'VES', monto: 4000, bancaOrigenId: 'ves1' });
    expect(flujoNetoUsdFilas(expandirPatas([bs], MONEDAS, []), false)).toEqual({ netoUsd: 0, sinEquivalente: 1 });
  });
});

describe('navegación anterior/siguiente', () => {
  it('deduplica por id: una transferencia con dos patas aparece una sola vez, en orden cronológico', () => {
    const viejo = mov('v', { fecha: '2026-11-01' });
    const ids = idsNavegacionDeFilas(expandirPatas([usdABs, viejo], MONEDAS, []));
    expect(ids).toEqual(['v', 't1']);
  });
});

describe('privacidad por cuenta', () => {
  it('la fila de una cuenta oculta enmascara su monto; las demás no', () => {
    const [o, d] = expandirPatas([usdABs], MONEDAS, []);
    const ocultas = new Set(['ves1']);
    expect(filaConCuentaOculta(o, ocultas)).toBe(false);
    expect(filaConCuentaOculta(d, ocultas)).toBe(true);
  });

  it('enmascara con ocultarCantidades o con cuenta oculta', () => {
    expect(enmascararSiOculto('$10,00', false, false)).toBe('$10,00');
    expect(enmascararSiOculto('$10,00', true, false)).toBe(MONTO_OCULTO);
    expect(enmascararSiOculto('$10,00', false, true)).toBe(MONTO_OCULTO);
  });
});
