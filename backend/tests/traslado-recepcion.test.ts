import { describe, it, expect } from 'vitest';
import type { Tara } from '../../shared/types/index';
import {
  diferenciaRecepcion, filaRecepcionDesdeNeto, filaRecepcionInicial, netoRecibidoFila, recepcionAPayload, validarRecepcion,
} from '../../frontend/src/features/inventario/recepcion-traslado';
import { completarTrasladoSchema } from '../src/schemas/traslados';

const SACA: Tara = { id: 's1', nombre: 'Saca', peso: 0.35, fotos: [], activo: true, createdAt: '2026-10-01T00:00:00Z' };
const CESTA: Tara = { id: 'c1', nombre: 'Cesta', peso: 1.2, fotos: [], activo: true, createdAt: '2026-10-01T00:00:00Z' };
const INACTIVA: Tara = { ...SACA, id: 'x1', activo: false };
const TARAS = [SACA, CESTA];

describe('recepción de traslado: neto = bruto - taras a 3 decimales', () => {
  it('sin taras el neto es el bruto', () => {
    expect(netoRecibidoFila(filaRecepcionInicial(10.125), TARAS)).toBe(10.125);
  });

  it('resta tara preconfigurada por cantidad sin ruido de punto flotante', () => {
    const f = { ...filaRecepcionInicial(0), pesoBruto: '10.001', taraModo: 'preconfigurada' as const, taraId: 's1', taraCantidad: '3' };
    expect(netoRecibidoFila(f, TARAS)).toBe(8.951);
  });

  it('suma tara manual y taras adicionales', () => {
    const f = {
      ...filaRecepcionInicial(0), pesoBruto: '20', taraModo: 'manual' as const, taraManual: '0.125',
      tarasExtra: [{ taraModo: 'preconfigurada' as const, taraId: 'c1', taraCantidad: '2', taraManual: '' }],
    };
    expect(netoRecibidoFila(f, TARAS)).toBe(17.475);
  });

  it('el payload lleva bruto, tara y neto coherentes', () => {
    const f = { ...filaRecepcionInicial(0), pesoBruto: '12.5', taraModo: 'preconfigurada' as const, taraId: 'c1', taraCantidad: '1' };
    expect(recepcionAPayload('d1', f, TARAS)).toEqual({ detalleId: 'd1', pesoRecibido: 11.3, pesoBrutoRecibido: 12.5, taraRecibida: 1.2 });
  });

  it('un borrador anterior (solo neto) pasa a bruto sin tara', () => {
    expect(netoRecibidoFila(filaRecepcionDesdeNeto('7.5'), TARAS)).toBe(7.5);
  });

  it('diferencia a 3 decimales', () => {
    expect(diferenciaRecepcion(9.995, 10)).toBe(-0.005);
  });
});

describe('validarRecepcion', () => {
  it('acepta una recepción completa', () => {
    expect(validarRecepcion([filaRecepcionInicial(5)], TARAS)).toBeNull();
  });
  it('rechaza bruto vacío o negativo', () => {
    expect(validarRecepcion([{ ...filaRecepcionInicial(5), pesoBruto: '' }], TARAS)).toMatch(/peso bruto/);
    expect(validarRecepcion([{ ...filaRecepcionInicial(5), pesoBruto: '-1' }], TARAS)).toMatch(/peso bruto/);
  });
  it('permite recibir 0 kg', () => {
    expect(validarRecepcion([{ ...filaRecepcionInicial(5), pesoBruto: '0' }], TARAS)).toBeNull();
  });
  it('rechaza tara con unidades pero sin elegir cuál', () => {
    const f = { ...filaRecepcionInicial(5), taraModo: 'preconfigurada' as const, taraCantidad: '2' };
    expect(validarRecepcion([f], TARAS)).toMatch(/tara preconfigurada/);
  });
  it('rechaza una tara que ya no está vigente', () => {
    const f = { ...filaRecepcionInicial(5), taraId: 'x1', taraCantidad: '1' };
    expect(validarRecepcion([f], [...TARAS, INACTIVA])).toMatch(/ya no está disponible/);
  });
  it('rechaza neto negativo (tara mayor que el bruto)', () => {
    const f = { ...filaRecepcionInicial(1), taraModo: 'manual' as const, taraManual: '2' };
    expect(validarRecepcion([f], TARAS)).toMatch(/negativo/);
  });
});

describe('completarTrasladoSchema con bruto y tara', () => {
  const base = { fotos: ['https://x/y.jpg'] };
  const detalleId = '4f9f6a3e-6a4f-4b3c-9d44-1a2b3c4d5e6f';

  it('acepta solo el neto (clientes y colas offline anteriores)', () => {
    expect(completarTrasladoSchema.safeParse({ ...base, recepciones: [{ detalleId, pesoRecibido: 9.99 }] }).success).toBe(true);
  });
  it('acepta bruto y tara coherentes con 3 decimales', () => {
    const r = completarTrasladoSchema.safeParse({ ...base, recepciones: [{ detalleId, pesoRecibido: 8.951, pesoBrutoRecibido: 10.001, taraRecibida: 1.05 }] });
    expect(r.success).toBe(true);
  });
  it('rechaza un neto que no es bruto - tara', () => {
    const r = completarTrasladoSchema.safeParse({ ...base, recepciones: [{ detalleId, pesoRecibido: 9, pesoBrutoRecibido: 10, taraRecibida: 0.5 }] });
    expect(r.success).toBe(false);
  });
  it('rechaza tara sin bruto y valores negativos', () => {
    expect(completarTrasladoSchema.safeParse({ ...base, recepciones: [{ detalleId, pesoRecibido: 1, taraRecibida: 1 }] }).success).toBe(false);
    expect(completarTrasladoSchema.safeParse({ ...base, recepciones: [{ detalleId, pesoRecibido: 1, pesoBrutoRecibido: 2, taraRecibida: -1 }] }).success).toBe(false);
  });
});
