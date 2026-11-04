import { describe, it, expect } from 'vitest';
import type { SalidaTransformacion } from '../../shared/types/index';
import { precioUnificado, unificarSalidas, contarPreciosDistintos, salidasAGuardar } from '../../frontend/src/lib/salidas-unificadas';

const salida = (parcial: Partial<SalidaTransformacion>): SalidaTransformacion => ({
  id: 's1',
  productoId: 'plastico-2',
  nombreProducto: 'Plástico dos',
  loteDestinoId: null,
  nombreLoteDestino: null,
  almacenId: 'a1',
  nombreAlmacen: 'Principal',
  pesoBruto: 12,
  tara: 2,
  pesoNeto: 10,
  fotos: [],
  ...parcial,
});

describe('unificarSalidas', () => {
  it('suma en un solo renglón varias pesadas del mismo material', () => {
    const r = unificarSalidas([
      salida({ id: 'a', pesoNeto: 10, pesoBruto: 12, tara: 2 }),
      salida({ id: 'b', pesoNeto: 5, pesoBruto: 6, tara: 1 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ etiqueta: 'Plástico dos', pesoNeto: 15, pesoBruto: 18, tara: 3, ids: ['a', 'b'] });
  });

  it('separa materiales distintos y el mismo material hacia lotes distintos', () => {
    const r = unificarSalidas([
      salida({ id: 'a' }),
      salida({ id: 'b', productoId: 'hierro', nombreProducto: 'Hierro' }),
      salida({ id: 'c', loteDestinoId: 'l1', nombreLoteDestino: 'L1' }),
    ]);
    expect(r.map(x => x.ids)).toEqual([['a'], ['b'], ['c']]);
  });

  it('no repite almacenes y no muta la entrada', () => {
    const entrada = [salida({ id: 'a' }), salida({ id: 'b', almacenId: 'a2', nombreAlmacen: 'Patio' }), salida({ id: 'c' })];
    const copia = JSON.parse(JSON.stringify(entrada));
    expect(unificarSalidas(entrada)[0].almacenes).toEqual(['Principal', 'Patio']);
    expect(entrada).toEqual(copia);
  });

  it('es idempotente: unificar lo ya unificado no cambia los totales', () => {
    const una = unificarSalidas([salida({ id: 'a', pesoNeto: 4 }), salida({ id: 'b', pesoNeto: 6 })]);
    const dos = unificarSalidas([salida({ id: 'a', pesoNeto: 4 }), salida({ id: 'b', pesoNeto: 6 })]);
    expect(dos).toEqual(una);
    expect(una[0].pesoNeto).toBe(10);
  });
});

describe('precioUnificado (promedio ponderado por peso)', () => {
  it('sin precios devuelve null', () => {
    expect(precioUnificado([{ pesoNeto: 5, precioUnitario: null }, { pesoNeto: 5 }])).toBeNull();
  });

  it('pondera por peso neto cuando los precios difieren', () => {
    expect(precioUnificado([
      { pesoNeto: 10, precioUnitario: 1 },
      { pesoNeto: 30, precioUnitario: 2 },
    ])).toBeCloseTo(1.75, 6);
  });

  it('ignora pesadas sin precio y mantiene el valor total (kg x $/kg)', () => {
    const r = unificarSalidas([
      salida({ id: 'a', pesoNeto: 10, precioUnitario: 3 }),
      salida({ id: 'b', pesoNeto: 90, precioUnitario: null }),
    ]);
    expect(r[0].precioUnitario).toBe(3);
  });
});

describe('precio único por renglón', () => {
  const tres = (precios: Array<number | null>) =>
    unificarSalidas(precios.map((p, i) => salida({ id: `s${i}`, pesoNeto: 10, precioUnitario: p })));

  it('3 pesadas de 10 kg del mismo lote dan un renglón de 30 kg sin precio inventado', () => {
    const [r] = tres([null, null, null]);
    expect(r.pesoNeto).toBe(30);
    expect(r.precioUnitario).toBeNull();
    expect(r.preciosDistintos).toBe(0);
  });

  it('si todas tenían el mismo precio lo muestra tal cual (sin marcar promedio)', () => {
    const [r] = tres([2.5, 2.5, 2.5]);
    expect(r.precioUnitario).toBe(2.5);
    expect(r.preciosDistintos).toBe(1);
    expect(r.pesadasSinPrecio).toBe(0);
  });

  it('con precios distintos marca cuántos son y muestra el promedio ponderado', () => {
    const [r] = tres([1, 2, 3]);
    expect(r.preciosDistintos).toBe(3);
    expect(r.precioUnitario).toBeCloseTo(2, 6);
  });

  it('tolera ruido de coma flotante al contar precios distintos', () => {
    expect(contarPreciosDistintos([{ precioUnitario: 0.1 + 0.2 }, { precioUnitario: 0.3 }])).toBe(1);
  });
});

describe('salidasAGuardar', () => {
  const renglones = unificarSalidas([
    salida({ id: 'a', pesoNeto: 10, precioUnitario: null }),
    salida({ id: 'b', pesoNeto: 10, precioUnitario: null }),
    salida({ id: 'c', pesoNeto: 10, precioUnitario: null }),
    salida({ id: 'h', productoId: 'hierro', nombreProducto: 'Hierro', precioUnitario: 4 }),
  ]);
  const claveP = renglones[0].clave;
  const claveH = renglones[1].clave;

  it('escribe el mismo precio en las 3 pesadas del renglón editado y no toca el intacto', () => {
    expect(salidasAGuardar(renglones, () => 1.5, new Set([claveP]))).toEqual([
      { id: 'a', precioUnitario: 1.5 },
      { id: 'b', precioUnitario: 1.5 },
      { id: 'c', precioUnitario: 1.5 },
    ]);
  });

  it('sin ediciones no envía nada (no pisa precios existentes)', () => {
    expect(salidasAGuardar(renglones, () => 9, new Set())).toEqual([]);
  });

  it('vaciar el campo de un renglón editado borra el precio de todas sus pesadas', () => {
    expect(salidasAGuardar(renglones, () => null, new Set([claveH]))).toEqual([{ id: 'h', precioUnitario: null }]);
  });

  it('no pisa un promedio de precios distintos si el usuario no lo editó', () => {
    const viejos = unificarSalidas([salida({ id: 'x', precioUnitario: 1 }), salida({ id: 'y', precioUnitario: 3 })]);
    expect(salidasAGuardar(viejos, () => 2, new Set())).toEqual([]);
  });

  it('completa una pesada nueva sin precio cuando el renglón ya tenía un único precio', () => {
    const r = unificarSalidas([salida({ id: 'x', precioUnitario: 2 }), salida({ id: 'y', precioUnitario: null })]);
    expect(salidasAGuardar(r, () => 99, new Set())).toEqual([
      { id: 'x', precioUnitario: 2 },
      { id: 'y', precioUnitario: 2 },
    ]);
  });

  it('es idempotente: reenviar el mismo estado produce el mismo payload', () => {
    const ed = new Set([claveP]);
    expect(salidasAGuardar(renglones, () => 1.5, ed)).toEqual(salidasAGuardar(renglones, () => 1.5, ed));
  });
});
