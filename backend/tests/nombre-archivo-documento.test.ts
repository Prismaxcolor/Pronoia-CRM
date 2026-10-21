import { describe, it, expect } from 'vitest';
import { nombreArchivoDocumento as nombreFront } from '../../frontend/src/lib/nombre-archivo';
import { nombreArchivoDocumento as nombreBack } from '../src/utils/nombre-archivo.js';

describe.each([['frontend', nombreFront], ['backend', nombreBack]])('nombreArchivoDocumento (%s)', (_n, nombre) => {
  it('arma prefijo, código y tercero', () => {
    expect(nombre({ prefijo: 'Factura', codigo: 'F-000123', entidad: 'Cliente Uno' })).toBe('Factura-F-000123-Cliente-Uno.pdf');
    expect(nombre({ prefijo: 'Ticket', codigo: 'T 000045', entidad: 'Proveedor X' })).toBe('Ticket-T-000045-Proveedor-X.pdf');
  });

  it('quita acentos y símbolos inválidos de Windows/iOS', () => {
    expect(nombre({ prefijo: 'Factura', codigo: 'F-1', entidad: 'Ñandú & Cía. S/A: "El *Mejor*" <x>|y?' }))
      .toBe('Factura-F-1-Nandu-Cia.-S-A-El-Mejor-x-y.pdf');
    expect(nombre({ prefijo: 'Factura', codigo: 'F-1', entidad: 'A\B/C' })).not.toMatch(/[\/:*?"<>|]/);
  });

  it('cae al código cuando no hay nombre', () => {
    expect(nombre({ prefijo: 'Factura', codigo: 'F-1', entidad: null })).toBe('Factura-F-1.pdf');
    expect(nombre({ prefijo: 'Factura', codigo: 'F-1', entidad: '  —  ' })).toBe('Factura-F-1.pdf');
    expect(nombre({ prefijo: '', codigo: '', entidad: '' })).toBe('Documento.pdf');
  });

  it('limita el largo recortando el tercero y conserva código y extensión', () => {
    const r = nombre({ prefijo: 'Factura', codigo: 'F-000123', entidad: 'A'.repeat(300), extension: 'docx' });
    expect(r.endsWith('.docx')).toBe(true);
    expect(r.startsWith('Factura-F-000123-')).toBe(true);
    expect(r.length).toBeLessThanOrEqual(80 + 5);
  });
});
