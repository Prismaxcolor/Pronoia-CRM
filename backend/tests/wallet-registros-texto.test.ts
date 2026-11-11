import { describe, it, expect } from 'vitest';
import { expandirPatas } from '../../frontend/src/features/wallet/registros/registros-patas';
import {
  estadoVisible, terceroDeFila, textoFaltaCobrar, textoMontoFila, tituloDeFila, tonoDeFila,
} from '../../frontend/src/features/wallet/registros/registros-texto';
import type { Movimiento } from '../../shared/types/index.js';

const mov = (id: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'usd1', bancaDestinoId: null,
  fecha: '2026-11-11', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: null,
  montoDestino: null, creadoEn: '2026-11-11T10:00:00Z', subtipo: null, numero: null, numeroSistema: null, grupoId: null,
  comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...extra,
});
const MONEDAS = new Map([['usd1', 'USD'], ['ves1', 'VES']]);
const mesa = (extra: Partial<Movimiento>) => mov('m', {
  tipo: 'transferencia', bancaDestinoId: 'ves1', monto: 100, mesaCambistaId: 'c', mesaMontoBruto: 4000, mesaComision: 100, mesaMontoCobrado: 0, ...extra,
});
const patas = (m: Movimiento) => expandirPatas([m], MONEDAS, []);

describe('texto del monto de la fila', () => {
  it('egreso negativo, ingreso con +', () => {
    expect(textoMontoFila(patas(mov('e'))[0])).toBe('-$10,00');
    expect(textoMontoFila(patas(mov('i', { tipo: 'ingreso' }))[0])).toBe('+$10,00');
  });

  it('transferencia: origen en su moneda con signo -, destino en la suya con +', () => {
    const [o, d] = patas(mov('t', { tipo: 'transferencia', bancaDestinoId: 'ves1', montoDestino: 4000 }));
    expect(textoMontoFila(o)).toBe('-$10,00');
    expect(textoMontoFila(d)).toBe('+Bs 4.000,00');
  });

  it('pata pendiente de mesa dice "Pendiente", no un monto; parcial muestra lo cobrado', () => {
    expect(textoMontoFila(patas(mesa({ mesaEstado: 'en_proceso' }))[1])).toBe('Pendiente');
    const d = patas(mesa({ mesaEstado: 'parcial', mesaMontoCobrado: 1000 }))[1];
    expect(textoMontoFila(d)).toBe('+Bs 1.000,00');
    expect(textoFaltaCobrar(d)).toBe('Falta cobrar Bs 2.900,00');
    expect(textoFaltaCobrar(patas(mesa({ mesaEstado: 'en_proceso' }))[1])).toBe('Falta cobrar Bs 3.900,00');
  });

  it('monto desconocido se pinta "—" y no hay "falta cobrar" fuera de la mesa', () => {
    const d = patas(mov('t', { tipo: 'transferencia', bancaDestinoId: 'ves1' }))[1];
    expect(textoMontoFila(d)).toBe('—');
    expect(textoFaltaCobrar(d)).toBeNull();
  });
});

describe('tono de la fila', () => {
  it('rojo egreso/origen, verde ingreso/destino, neutro anulado o sin monto', () => {
    const [o, d] = patas(mov('t', { tipo: 'transferencia', bancaDestinoId: 'ves1', montoDestino: 4000 }));
    expect(tonoDeFila(o)).toBe('negativo');
    expect(tonoDeFila(d)).toBe('positivo');
    expect(tonoDeFila(patas(mov('a', { anulado: true }))[0])).toBe('neutro');
    expect(tonoDeFila(patas(mesa({ mesaEstado: 'en_proceso' }))[1])).toBe('neutro');
  });
});

describe('estado y tercero', () => {
  it('estado visible con texto: anulado, en proceso, parcial, completada', () => {
    expect(estadoVisible(mov('a', { anulado: true }))).toEqual({ texto: 'Anulado', tono: 'peligro' });
    expect(estadoVisible(mesa({ mesaEstado: 'en_proceso' }))).toEqual({ texto: 'En proceso', tono: 'aviso' });
    expect(estadoVisible(mesa({ mesaEstado: 'parcial' }))).toEqual({ texto: 'Cobro parcial', tono: 'aviso' });
    expect(estadoVisible(mesa({ mesaEstado: 'completada' }))).toEqual({ texto: 'Completada', tono: 'exito' });
    expect(estadoVisible(mov('n'))).toBeNull();
  });

  it('tercero: proveedor o cliente, con el nombre si se conoce', () => {
    expect(terceroDeFila(mov('p', { proveedorId: 'x' }), 'ACME')).toEqual({ rol: 'Proveedor', texto: 'Proveedor: ACME', tono: 'info' });
    expect(terceroDeFila(mov('c', { clienteId: 'x' }), null)).toEqual({ rol: 'Cliente', texto: 'Cliente', tono: 'marca' });
    expect(terceroDeFila(mov('n'), null)).toBeNull();
  });

  it('título de la fila: patas de transferencia y comisiones', () => {
    const [o, d] = patas(mov('t', { tipo: 'transferencia', bancaDestinoId: 'ves1' }));
    expect(tituloDeFila(o, null)).toBe('Transferencia enviada');
    expect(tituloDeFila(d, null)).toBe('Transferencia recibida');
    expect(tituloDeFila(patas(mov('c', { comisionDeId: 'x' }))[0], null)).toBe('Comisión bancaria');
    expect(tituloDeFila(patas(mov('s'))[0], 'Comida')).toBe('Comida');
  });
});
