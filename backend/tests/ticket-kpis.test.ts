import { describe, it, expect } from 'vitest';
import {
  calcularKpisTicket,
  composicionPorMaterial,
  formatearPesoTicket,
  severidadDiferencia,
  type MaterialTicketEntrada,
  type TicketKpisEntrada,
} from '../../frontend/src/lib/ticket-kpis';

const mat = (id: string, productoId: string | null, nombre: string, neto: number): MaterialTicketEntrada =>
  ({ id, productoId, nombreProducto: nombre, pesoNeto: neto });

const base: TicketKpisEntrada = {
  estado: 'completo', pesajeExterior: false, pesoGlobal: 1000, pesoNetoTotal: 990, devolucion: 0, diferencia: 10,
  materiales: [mat('1', 'a', 'Cobre', 600), mat('2', 'b', 'Aluminio', 390)],
  pesajesGlobales: [{ peso: 1100, tara: 100 }],
};

describe('severidadDiferencia', () => {
  it('no aplica en pesaje exterior ni sin peso global', () => {
    expect(severidadDiferencia(5, 100, true)).toBe('sinDato');
    expect(severidadDiferencia(5, 0, false)).toBe('sinDato');
  });
  it('cuadrada, normal, alta y favorece al proveedor', () => {
    expect(severidadDiferencia(0, 1000, false)).toBe('cuadrada');
    expect(severidadDiferencia(5, 1000, false)).toBe('normal');
    expect(severidadDiferencia(7, 1000, false)).toBe('alta');
    expect(severidadDiferencia(-5, 1000, false)).toBe('favorece');
  });
  it('tolera ruido de redondeo en negativos', () => {
    expect(severidadDiferencia(-0.005, 1000, false)).toBe('normal');
  });
});

describe('composicionPorMaterial', () => {
  it('agrupa pesadas del mismo producto y ordena de mayor a menor', () => {
    const c = composicionPorMaterial([mat('1', 'a', 'Cobre', 100), mat('2', 'b', 'Aluminio', 300), mat('3', 'a', 'Cobre', 100)]);
    expect(c.map(p => p.nombre)).toEqual(['Aluminio', 'Cobre']);
    expect(c[1]).toMatchObject({ kg: 200, pesadas: 2 });
    expect(c[0].porcentaje + c[1].porcentaje).toBeCloseTo(100);
  });
  it('agrupa el excedente en "Otros" y descarta netos no positivos', () => {
    const ms = Array.from({ length: 8 }, (_, i) => mat(String(i), `p${i}`, `M${i}`, 10 + i));
    ms.push(mat('x', 'z', 'Cero', 0));
    const c = composicionPorMaterial(ms);
    expect(c).toHaveLength(6);
    expect(c[5].nombre).toBe('Otros');
    expect(c.reduce((s, p) => s + p.porcentaje, 0)).toBeCloseTo(100);
  });
  it('devuelve vacío sin kilos', () => {
    expect(composicionPorMaterial([])).toEqual([]);
  });
});

describe('calcularKpisTicket', () => {
  it('calcula cifras de un ticket completo', () => {
    const k = calcularKpisTicket(base);
    expect(k).toMatchObject({ netoTotal: 990, materialesDistintos: 2, pesadasMaterial: 2, pesoGlobal: 1000, pesadasGlobales: 1, diferencia: 10, severidad: 'alta' });
    expect(k.diferenciaPct).toBeCloseTo(1);
  });
  it('un ticket en bruto no tiene diferencia', () => {
    const k = calcularKpisTicket({ ...base, estado: 'bruto', materiales: [], pesoNetoTotal: 0 });
    expect(k.diferencia).toBeNull();
    expect(k.diferenciaPct).toBeNull();
    expect(k.materialesDistintos).toBe(0);
  });
  it('pesaje exterior: sin diferencia', () => {
    expect(calcularKpisTicket({ ...base, pesajeExterior: true, pesoGlobal: 0 }).diferencia).toBeNull();
  });
});

describe('formatearPesoTicket', () => {
  it('usa 2 decimales y 3 solo si hay gramos, con miles es-VE', () => {
    expect(formatearPesoTicket(1234.5)).toBe('1.234,50');
    expect(formatearPesoTicket(12.345)).toBe('12,345');
    expect(formatearPesoTicket(0)).toBe('0,00');
  });
});
