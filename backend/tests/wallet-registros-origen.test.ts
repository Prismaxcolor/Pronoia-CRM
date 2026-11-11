import { describe, it, expect } from 'vitest';
import { RUTA_ORIGEN_POR_DEFECTO, destinoVolver, origenDeEstado } from '../../frontend/src/features/cochinito/origen-detalle';

describe('origen del detalle de un movimiento', () => {
  it('sin estado (enlace directo) vuelve a la Wallet clásica', () => {
    expect(origenDeEstado(null)).toBe(RUTA_ORIGEN_POR_DEFECTO);
    expect(origenDeEstado(undefined)).toBe('/cochinito');
    expect(origenDeEstado({ navegacion: ['a'] })).toBe('/cochinito');
  });

  it('usa el origen que pasa la lista de la que viene la persona, con sus filtros', () => {
    expect(origenDeEstado({ navegacion: [], origen: '/wallet/registros?cat=abc&p=30D' })).toBe('/wallet/registros?cat=abc&p=30D');
  });

  it('descarta orígenes que no son rutas internas', () => {
    expect(origenDeEstado({ origen: 'https://malo.example/x' })).toBe('/cochinito');
    expect(origenDeEstado({ origen: '//malo.example' })).toBe('/cochinito');
    expect(origenDeEstado({ origen: 5 })).toBe('/cochinito');
    expect(origenDeEstado({ origen: '' })).toBe('/cochinito');
  });

  it('etiqueta de la miga y del botón según el origen', () => {
    expect(destinoVolver({ origen: '/wallet/registros?p=7D' })).toEqual({ ruta: '/wallet/registros?p=7D', etiqueta: 'Registros' });
    expect(destinoVolver({ origen: '/wallet' })).toEqual({ ruta: '/wallet', etiqueta: 'Wallet' });
    expect(destinoVolver(null)).toEqual({ ruta: '/cochinito', etiqueta: 'Wallet' });
  });
});
