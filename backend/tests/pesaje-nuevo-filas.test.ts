import { describe, it, expect } from 'vitest';
import type { MaterialFila } from '../../frontend/src/features/pesaje/material-fila';
import {
  almacenIdDeTicket,
  avisoStockInsuficiente,
  filasConProducto,
  formatearKgPesaje,
  lotesConStockEnAlmacen,
  mensajeTicketGuardado,
  mensajeTrasladoGenerado,
  opcionesLoteFila,
  stockLoteEnAlmacen,
} from '../../frontend/src/features/pesaje/pesaje-nuevo-logica';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cast = (...v: unknown[]) => v as any;
const fila = (extra: Partial<MaterialFila> = {}): MaterialFila => ({
  uid: 1, productoId: 'p1', subcategoria: '', pesoBruto: '10', taraModo: 'manual', taraId: '',
  taraCantidad: '', taraManual: '', destino: 'l1', fotos: [], ...extra,
});

describe('formatearKgPesaje', () => {
  it('usa formato es-VE con 2 a 3 decimales', () => {
    const esperado = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    expect(formatearKgPesaje(1234.5)).toBe(esperado(1234.5));
    expect(formatearKgPesaje(0)).toBe(esperado(0));
    expect(formatearKgPesaje(0.1234)).toBe(esperado(0.1234));
  });
});

describe('lotes en un almacén', () => {
  const lotes = cast(
    { id: 'a', activo: true, stockPorAlmacen: [{ almacenId: 'x', stockKg: 5 }] },
    { id: 'b', activo: false, stockPorAlmacen: [{ almacenId: 'x', stockKg: 5 }] },
    { id: 'c', activo: true, stockPorAlmacen: [{ almacenId: 'x', stockKg: 0 }] },
    { id: 'd', activo: true, stockPorAlmacen: [{ almacenId: 'y', stockKg: 9 }] },
  );
  it('lista los que tienen stock positivo en el almacén (solo activos por defecto)', () => {
    expect(lotesConStockEnAlmacen(lotes, 'x').map((l: { id: string }) => l.id)).toEqual(['a']);
  });
  it('puede incluir inactivos', () => {
    expect(lotesConStockEnAlmacen(lotes, 'x', false).map((l: { id: string }) => l.id)).toEqual(['a', 'b']);
  });
  it('stockLoteEnAlmacen devuelve 0 sin registro', () => {
    expect(stockLoteEnAlmacen(lotes[3], 'y')).toBe(9);
    expect(stockLoteEnAlmacen(lotes[3], 'x')).toBe(0);
    expect(stockLoteEnAlmacen(undefined, 'x')).toBe(0);
  });
  it('opcionesLoteFila oculta los lotes que ya eligió otra fila pero conserva el propio', () => {
    const enOrigen = cast({ id: 'a' }, { id: 'b' }, { id: 'c' });
    const filas = [
      { uid: 1, loteId: 'a', pesoBruto: '', tara: '', fotos: [] },
      { uid: 2, loteId: 'b', pesoBruto: '', tara: '', fotos: [] },
    ];
    expect(opcionesLoteFila(enOrigen, filas, filas[0]).map((l: { id: string }) => l.id)).toEqual(['a', 'c']);
  });
});

describe('avisoStockInsuficiente', () => {
  it('no avisa si alcanza', () => {
    expect(avisoStockInsuficiente(5, 5)).toBeNull();
    expect(avisoStockInsuficiente(3, 5)).toBeNull();
  });
  it('avisa con lo disponible y lo que quedará', () => {
    expect(avisoStockInsuficiente(8, 5)).toEqual({ disponible: 5, quedara: -3 });
  });
});

describe('filasConProducto', () => {
  const productos = cast({ id: 'p1', loteIds: ['l1'] }, { id: 'p2', loteIds: [] });
  it('limpia el destino si no es uno de los lotes anclados del material nuevo', () => {
    const r = filasConProducto([fila({ destino: 'otro' })], 1, 'p1', productos);
    expect(r[0]).toMatchObject({ productoId: 'p1', destino: '' });
  });
  it('conserva el destino si es uno de los anclados', () => {
    expect(filasConProducto([fila({ destino: 'l1' })], 1, 'p1', productos)[0].destino).toBe('l1');
  });
  it('conserva el destino si el material no tiene lotes anclados', () => {
    expect(filasConProducto([fila({ destino: 'otro' })], 1, 'p2', productos)[0].destino).toBe('otro');
  });
  it('no toca otras filas ni muta las originales', () => {
    const filas = [fila({ uid: 1 }), fila({ uid: 2, productoId: 'pX' })];
    const r = filasConProducto(filas, 1, 'p2', productos);
    expect(r[1]).toBe(filas[1]);
    expect(filas[0].productoId).toBe('p1');
  });
});

describe('almacenIdDeTicket', () => {
  it('es null con un solo almacén', () => {
    expect(almacenIdDeTicket(cast({ id: 'a', esPredeterminado: true }), 'a')).toBeNull();
  });
  it('con varios usa el elegido, luego el predeterminado, luego null', () => {
    const alms = cast({ id: 'a' }, { id: 'b', esPredeterminado: true });
    expect(almacenIdDeTicket(alms, 'a')).toBe('a');
    expect(almacenIdDeTicket(alms, '')).toBe('b');
    expect(almacenIdDeTicket(cast({ id: 'a' }, { id: 'b' }), '')).toBeNull();
  });
});

describe('mensajes de guardado', () => {
  it('traslado generado', () => {
    expect(mensajeTrasladoGenerado('T-1', 10)).toBe(`T-1 generado (${formatearKgPesaje(10)} kg). Queda pendiente hasta que el almacén destino confirme la recepción.`);
  });
  it('ticket en bruto y completo', () => {
    expect(mensajeTicketGuardado('bruto', 'P-1', 9)).toBe('P-1 guardado como pesaje global (por recepcionar). Complétalo luego desde la lista.');
    expect(mensajeTicketGuardado('completo', 'P-1', 9)).toBe(`P-1 generado (neto ${formatearKgPesaje(9)} kg).`);
  });
});
