import { describe, it, expect } from 'vitest';
import { calcularGananciaTransformacion as calcular } from '../../frontend/src/lib/ganancia-transformacion';
import { guardarValoracionSchema } from '../src/schemas/transformaciones-valoracion.js';

// Fuente única del cálculo: frontend/src/lib/ganancia-transformacion.ts.
type Entrada = { pesoEntrada: number; costoUnitario: number | null; salidas: Array<{ pesoNeto: number; precioUnitario: number | null }> };
const calcularGananciaTransformacion = (e: Entrada) => calcular(e.pesoEntrada, e.costoUnitario, e.salidas);

describe('calcularGananciaTransformacion', () => {
  it('calcula ganancia = valor de salidas - costo', () => {
    const r = calcularGananciaTransformacion({
      pesoEntrada: 100,
      costoUnitario: 2,
      salidas: [
        { pesoNeto: 60, precioUnitario: 3 },
        { pesoNeto: 30, precioUnitario: 1.5 },
      ],
    });
    expect(r.valorSalidas).toBe(225);
    expect(r.costo).toBe(200);
    expect(r.ganancia).toBe(25);
    expect(r.completo).toBe(true);
  });

  it('sin ancla ni precios devuelve todo nulo y cero en salidas', () => {
    const r = calcularGananciaTransformacion({
      pesoEntrada: 100,
      costoUnitario: null,
      salidas: [{ pesoNeto: 50, precioUnitario: null }],
    });
    expect(r).toEqual({ valorSalidas: 0, costo: null, ganancia: null, completo: false });
  });

  it('con precios de salida faltantes no inventa ganancia pero suma lo valorado', () => {
    const r = calcularGananciaTransformacion({
      pesoEntrada: 10,
      costoUnitario: 1,
      salidas: [
        { pesoNeto: 5, precioUnitario: 4 },
        { pesoNeto: 4, precioUnitario: null },
      ],
    });
    expect(r.valorSalidas).toBe(20);
    expect(r.costo).toBe(10);
    expect(r.ganancia).toBeNull();
    expect(r.completo).toBe(false);
  });

  it('sin costo unitario no hay ganancia aunque las salidas tengan precio', () => {
    const r = calcularGananciaTransformacion({
      pesoEntrada: 10,
      costoUnitario: null,
      salidas: [{ pesoNeto: 9, precioUnitario: 2 }],
    });
    expect(r.valorSalidas).toBe(18);
    expect(r.ganancia).toBeNull();
  });

  it('permite ganancia negativa', () => {
    const r = calcularGananciaTransformacion({
      pesoEntrada: 100,
      costoUnitario: 5,
      salidas: [{ pesoNeto: 80, precioUnitario: 2 }],
    });
    expect(r.ganancia).toBe(-340);
    expect(r.completo).toBe(true);
  });

  it('redondea a 2 decimales', () => {
    const r = calcularGananciaTransformacion({
      pesoEntrada: 3.333,
      costoUnitario: 1.111,
      salidas: [{ pesoNeto: 2.222, precioUnitario: 1.999 }],
    });
    expect(r.costo).toBe(3.7);
    expect(r.valorSalidas).toBe(4.44);
    expect(r.ganancia).toBe(0.74);
  });

  it('una transformación sin salidas no se considera completa', () => {
    const r = calcularGananciaTransformacion({ pesoEntrada: 10, costoUnitario: 1, salidas: [] });
    expect(r.ganancia).toBeNull();
    expect(r.completo).toBe(false);
  });

  it('precio 0 es un precio válido', () => {
    const r = calcularGananciaTransformacion({
      pesoEntrada: 10,
      costoUnitario: 0,
      salidas: [{ pesoNeto: 10, precioUnitario: 0 }],
    });
    expect(r.ganancia).toBe(0);
    expect(r.completo).toBe(true);
  });
});

describe('guardarValoracionSchema (ausente = sin cambios, null = borrar)', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';

  it('body vacío deja factura y costo indefinidos (no borra nada)', () => {
    const r = guardarValoracionSchema.parse({});
    expect(r.facturaCompraId).toBeUndefined();
    expect(r.costoUnitario).toBeUndefined();
    expect(r.salidas).toEqual([]);
  });

  it('null se conserva para poder borrar', () => {
    const r = guardarValoracionSchema.parse({ facturaCompraId: null, costoUnitario: null });
    expect(r.facturaCompraId).toBeNull();
    expect(r.costoUnitario).toBeNull();
  });

  it('acepta valores y salidas con precio null', () => {
    const r = guardarValoracionSchema.parse({ facturaCompraId: uuid, costoUnitario: 2.5, salidas: [{ id: uuid, precioUnitario: null }] });
    expect(r.costoUnitario).toBe(2.5);
    expect(r.salidas[0].precioUnitario).toBeNull();
  });

  it('rechaza precios negativos y ids inválidos', () => {
    expect(guardarValoracionSchema.safeParse({ costoUnitario: -1 }).success).toBe(false);
    expect(guardarValoracionSchema.safeParse({ salidas: [{ id: 'x', precioUnitario: 1 }] }).success).toBe(false);
  });
});
