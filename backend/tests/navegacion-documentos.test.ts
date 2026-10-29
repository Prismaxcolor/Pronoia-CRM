import { describe, it, expect } from 'vitest';
import { ordenarPorCreacion, vecinosEnSecuencia, vecinosPorCreacion } from '../../frontend/src/lib/navegacion-documentos';
import { filtrosDeVuelta, vecinosEnEstadoCuenta } from '../../frontend/src/features/estado-cuenta/navegacion-estado-cuenta';
import type { EntradaEstadoCuenta } from '../../frontend/src/services/estado-cuenta-service';

describe('vecinosEnSecuencia', () => {
  it('devuelve anterior y siguiente del documento actual', () => {
    const v = vecinosEnSecuencia(['a', 'b', 'c'], x => x === 'b');
    expect(v).toEqual({ anterior: 'a', siguiente: 'c', posicion: 2, total: 3 });
  });

  it('el primero no tiene anterior y el último no tiene siguiente', () => {
    expect(vecinosEnSecuencia(['a', 'b'], x => x === 'a').anterior).toBeNull();
    expect(vecinosEnSecuencia(['a', 'b'], x => x === 'b').siguiente).toBeNull();
  });

  it('si el documento no está en la secuencia no hay posición ni vecinos', () => {
    expect(vecinosEnSecuencia(['a'], x => x === 'z')).toEqual({ anterior: null, siguiente: null, posicion: null, total: 1 });
  });
});

describe('ordenarPorCreacion / vecinosPorCreacion', () => {
  const docs = [
    { id: 'c', t: '2026-10-03T10:00:00Z', n: 3 },
    { id: 'a', t: '2026-10-01T10:00:00Z', n: 1 },
    { id: 'b2', t: '2026-10-02T10:00:00Z', n: 2 },
    { id: 'b1', t: '2026-10-02T10:00:00Z', n: 2 },
  ];
  const clave = (d: (typeof docs)[number]) => ({ id: d.id, creadoEn: d.t, numero: d.n });

  it('ordena por instante de creación y desempata por correlativo e id, sin mutar la entrada', () => {
    const copia = [...docs];
    expect(ordenarPorCreacion(docs, clave).map(d => d.id)).toEqual(['a', 'b1', 'b2', 'c']);
    expect(docs).toEqual(copia);
  });

  it('arma los destinos con la ruta y el estado del enrutador', () => {
    const v = vecinosPorCreacion(docs, clave, 'b1', d => `/pesaje/${d.id}`, { volverA: '/pesaje' });
    expect(v.anterior).toEqual({ to: '/pesaje/a', state: { volverA: '/pesaje' } });
    expect(v.siguiente?.to).toBe('/pesaje/b2');
    expect(v.posicion).toBe(2);
  });
});

describe('navegación dentro del estado de cuenta', () => {
  const base = { cargo: 0, abono: 0, descripcion: '', referencia: null, fecha: '2026-10-01' };
  const entradas: EntradaEstadoCuenta[] = [
    { ...base, tipo: 'factura', facturaId: 'f1', cargo: 100 },
    { ...base, tipo: 'pago', pagoId: 'g1', abono: 40 },
    { ...base, tipo: 'nota_credito', notaId: 'n1', abono: 5 },
    { ...base, tipo: 'factura', facturaId: 'f2', cargo: 50 },
  ];

  it('recorre las filas en el orden del estado de cuenta, de un tipo de documento a otro', () => {
    const v = vecinosEnEstadoCuenta('proveedor', 'p1', entradas, 'g1');
    expect(v.anterior?.to).toBe('/compras/f1');
    expect(v.siguiente?.to).toBe('/proveedores/p1/notas/n1');
    expect(v.posicion).toBe(2);
    expect(v.total).toBe(4);
  });

  it('en clientes usa las rutas de ventas y cobros', () => {
    const v = vecinosEnEstadoCuenta('cliente', 'c1', entradas, 'n1');
    expect(v.anterior?.to).toBe('/clientes/c1/pagos/g1');
    expect(v.siguiente?.to).toBe('/ventas/f2');
  });

  it('respeta el filtro por tipo de la pantalla de origen', () => {
    const v = vecinosEnEstadoCuenta('proveedor', 'p1', entradas, 'f1', 'factura');
    expect(v.anterior).toBeNull();
    expect(v.siguiente?.to).toBe('/compras/f2');
    expect(v.total).toBe(2);
  });

  it('lee periodo y tipo de la ruta de vuelta solo si viene de un estado de cuenta', () => {
    expect(filtrosDeVuelta('/proveedores/p1/estado-cuenta?desde=2026-10-01&hasta=2026-10-31&tipo=pago'))
      .toEqual({ desde: '2026-10-01', hasta: '2026-10-31', tipo: 'pago' });
    expect(filtrosDeVuelta('/compras?desde=2026-10-01')).toEqual({});
    expect(filtrosDeVuelta(undefined)).toEqual({});
  });
});
