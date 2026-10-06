import { describe, it, expect } from 'vitest';
import { filaSalidaNuevaVacia, productoEfectivo, validarFilasNuevas } from '../../frontend/src/lib/salida-nueva-edicion';
import type { Transformacion } from '../../shared/types/index';

const ALM = 'alm-1';
const pcb = { categoria: 'pcb', almacenId: ALM, productoEntradaId: null, loteOrigenId: 'origen' } as unknown as Transformacion;
const ferroso = { categoria: 'ferroso_no_ferroso', almacenId: ALM, productoEntradaId: 'prod-in', loteOrigenId: null } as unknown as Transformacion;

describe('filaSalidaNuevaVacia', () => {
  it('PCB empieza como lote sin almacén; ferroso como material en el almacén de la transformación', () => {
    expect(filaSalidaNuevaVacia(pcb)).toMatchObject({ tipo: 'lote', almacenId: '' });
    expect(filaSalidaNuevaVacia(ferroso)).toMatchObject({ tipo: 'material', almacenId: ALM });
  });
});

describe('productoEfectivo', () => {
  it('en ferroso un lote usa el material de entrada; en PCB conserva el de la fila', () => {
    expect(productoEfectivo(ferroso, { ...filaSalidaNuevaVacia(ferroso), tipo: 'lote' })).toBe('prod-in');
    expect(productoEfectivo(pcb, { ...filaSalidaNuevaVacia(pcb), tipo: 'lote' })).toBe('');
  });
});

describe('validarFilasNuevas', () => {
  it('PCB: lote sin almacén es válido; lote igual al origen no', () => {
    const f = { ...filaSalidaNuevaVacia(pcb), loteDestinoId: 'l1', pesoBruto: '10' };
    expect(validarFilasNuevas(pcb, [f])).toBeNull();
    expect(validarFilasNuevas(pcb, [{ ...f, loteDestinoId: 'origen' }])).toMatch(/distinto del lote origen/);
  });

  it('ferroso: exige foto y material', () => {
    const f = { ...filaSalidaNuevaVacia(ferroso), productoId: 'p1', pesoBruto: '10' };
    expect(validarFilasNuevas(ferroso, [f])).toMatch(/foto/);
    expect(validarFilasNuevas(ferroso, [{ ...f, productoId: '' }])).toMatch(/producto/);
  });

  it('rechaza neto cero', () => {
    const f = { ...filaSalidaNuevaVacia(pcb), loteDestinoId: 'l1', pesoBruto: '5', tara: '5' };
    expect(validarFilasNuevas(pcb, [f])).toMatch(/neto/);
  });
});
