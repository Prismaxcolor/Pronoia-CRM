import { describe, it, expect } from 'vitest';
import {
  esManualVigente,
  etiquetaOperacion,
  numeroMovimiento,
  rutaComprobanteOperacion,
  rutaDetalleMovimiento,
  tasaDe,
  tituloCompartirMovimiento,
} from '../../frontend/src/features/cochinito/detalle-movimiento';
import { nombreArchivoImagen } from '../../frontend/src/lib/compartir-imagen';

describe('numeroMovimiento', () => {
  it('conserva el correlativo propio de pagos y adelantos', () => {
    expect(numeroMovimiento({ subtipo: 'pago', numero: 7 })).toBe('PG-0007');
    expect(numeroMovimiento({ subtipo: 'adelanto', numero: 12 })).toBe('AD-0012');
  });
  it('da formato N000123 a los movimientos manuales', () => {
    expect(numeroMovimiento({ subtipo: null, numero: 123 })).toBe('N000123');
  });
  it('sin número muestra una raya', () => {
    expect(numeroMovimiento({ subtipo: null, numero: null })).toBe('—');
  });
});

describe('tasaDe', () => {
  it('calcula bolívares por dólar', () => {
    expect(tasaDe({ monto: 3650, moneda: 'VES', montoUsd: 100 })).toBe(36.5);
  });
  it('no aplica en USD ni sin equivalente', () => {
    expect(tasaDe({ monto: 100, moneda: 'USD', montoUsd: 100 })).toBeNull();
    expect(tasaDe({ monto: 100, moneda: 'VES', montoUsd: null })).toBeNull();
    expect(tasaDe({ monto: 100, moneda: 'VES', montoUsd: 0 })).toBeNull();
  });
});

describe('esManualVigente', () => {
  it('solo los sueltos y no anulados se editan', () => {
    expect(esManualVigente({ anulado: false, grupoId: null, subtipo: null })).toBe(true);
    expect(esManualVigente({ anulado: true, grupoId: null, subtipo: null })).toBe(false);
    expect(esManualVigente({ anulado: false, grupoId: 'g', subtipo: null })).toBe(false);
    expect(esManualVigente({ anulado: false, grupoId: null, subtipo: 'pago' })).toBe(false);
  });
});

describe('rutaComprobanteOperacion', () => {
  it('enlaza al comprobante del proveedor o del cliente', () => {
    expect(rutaComprobanteOperacion({ grupoId: 'g1', proveedorId: 'p1', clienteId: null })).toBe('/proveedores/p1/pagos/g1');
    expect(rutaComprobanteOperacion({ grupoId: 'g1', proveedorId: null, clienteId: 'c1' })).toBe('/clientes/c1/pagos/g1');
  });
  it('sin grupo o sin tercero no hay enlace', () => {
    expect(rutaComprobanteOperacion({ grupoId: null, proveedorId: 'p1', clienteId: null })).toBeNull();
    expect(rutaComprobanteOperacion({ grupoId: 'g1', proveedorId: null, clienteId: null })).toBeNull();
  });
  it('etiqueta la operación según el subtipo', () => {
    expect(etiquetaOperacion({ subtipo: 'cobro', proveedorId: null })).toBe('cobro a cliente');
    expect(etiquetaOperacion({ subtipo: null, proveedorId: 'p' })).toBe('pago o cruce con proveedor');
  });
});

describe('nombre del archivo compartido', () => {
  it('queda como Movimiento-N000123-<tercero o banca>.png', () => {
    const titulo = tituloCompartirMovimiento({ subtipo: null, numero: 123 }, 'Pescadería Ñandú');
    expect(nombreArchivoImagen(titulo)).toBe('Movimiento-N000123-Pescaderia-Nandu.png');
  });
  it('sin número solo lleva el tercero', () => {
    expect(nombreArchivoImagen(tituloCompartirMovimiento({ subtipo: null, numero: null }, 'Caja'))).toBe('Movimiento-Caja.png');
  });
  it('la ruta del detalle usa el id', () => {
    expect(rutaDetalleMovimiento('abc')).toBe('/cochinito/movimientos/abc');
  });
});
