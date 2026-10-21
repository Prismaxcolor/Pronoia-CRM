import { describe, it, expect } from 'vitest';
import type { MaterialFila } from '../../frontend/src/features/pesaje/material-fila';
import type { LoteTrasladoFila } from '../../frontend/src/features/pesaje/lote-traslado-fila';
import { sanearBorradorPesaje, type EntradaSaneoPesaje } from '../../frontend/src/features/pesaje/pesaje-saneo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cast = (v: unknown) => v as any;
const fila = (extra: Partial<MaterialFila> = {}): MaterialFila => ({
  uid: 1, productoId: 'p1', subcategoria: '', pesoBruto: '10', taraModo: 'preconfigurada', taraId: 't1',
  taraCantidad: '1', taraManual: '', destino: 'l1', fotos: [], ...extra,
});
const loteFila = (loteId: string): LoteTrasladoFila => ({ uid: 9, loteId, pesoBruto: '1', tara: '0', fotos: [] });
const lote = (id: string, almacenId: string, stockKg: number) => ({ id, activo: true, stockPorAlmacen: [{ almacenId, stockKg }] });

const base = (extra: Partial<EntradaSaneoPesaje> = {}): EntradaSaneoPesaje => ({
  tipo: 'compra', materiales: [fila()], loteFilas: [], almacenOrigenId: 'a1', almacenDestinoId: '', entidadId: 'e1',
  taras: cast([{ id: 't1' }]), productos: cast([{ id: 'p1' }]), lotes: cast([lote('l1', 'a1', 5)]),
  almacenes: cast([{ id: 'a1' }, { id: 'a2' }]), proveedores: cast([{ id: 'e1' }]), clientes: cast([{ id: 'c1' }]), ...extra,
});

describe('sanearBorradorPesaje', () => {
  it('no cambia nada ni avisa cuando todo sigue vigente', () => {
    expect(sanearBorradorPesaje(base())).toEqual({
      materiales: null, loteFilas: null, limpiarAlmacenOrigen: false, limpiarAlmacenDestino: false, limpiarEntidad: false, mensaje: null,
    });
  });
  it('deja sin elegir el material y la tara que ya no existen', () => {
    const r = sanearBorradorPesaje(base({ productos: [], taras: [] }));
    expect(r.materiales?.[0]).toMatchObject({ productoId: '', destino: '', taraId: '' });
    expect(r.mensaje).toContain('un material, una tara');
  });
  it('avisa del lote destino que ya no existe', () => {
    const r = sanearBorradorPesaje(base({ lotes: [] }));
    expect(r.materiales?.[0].destino).toBe('');
    expect(r.mensaje).toContain('un lote destino');
  });
  it('limpia los lotes a trasladar sin stock en el almacén de origen', () => {
    const r = sanearBorradorPesaje(base({ tipo: 'traslado', loteFilas: [loteFila('l1'), loteFila('l2')], lotes: cast([lote('l1', 'a1', 5), lote('l2', 'a2', 5)]) }));
    expect(r.loteFilas?.map(f => f.loteId)).toEqual(['l1', '']);
    expect(r.mensaje).toContain('un lote a trasladar');
  });
  it('cuenta en plural varios lotes a trasladar', () => {
    const r = sanearBorradorPesaje(base({ tipo: 'traslado', loteFilas: [loteFila('x'), loteFila('y')] }));
    expect(r.mensaje).toContain('2 lotes a trasladar');
  });
  it('marca para limpiar los almacenes inexistentes', () => {
    const r = sanearBorradorPesaje(base({ almacenOrigenId: 'zz', almacenDestinoId: 'yy' }));
    expect(r.limpiarAlmacenOrigen).toBe(true);
    expect(r.limpiarAlmacenDestino).toBe(true);
    expect(r.mensaje).toContain('el almacén de origen, el almacén de destino');
  });
  it('un almacén vacío no cuenta como reseteo', () => {
    expect(sanearBorradorPesaje(base({ almacenDestinoId: '' })).limpiarAlmacenDestino).toBe(false);
  });
  it('valida la entidad contra proveedores en compra y clientes en venta', () => {
    expect(sanearBorradorPesaje(base({ entidadId: 'c1' })).limpiarEntidad).toBe(true);
    expect(sanearBorradorPesaje(base({ entidadId: 'c1', tipo: 'venta' })).limpiarEntidad).toBe(false);
    expect(sanearBorradorPesaje(base({ entidadId: 'zz', tipo: 'venta' })).mensaje).toContain('el cliente');
    expect(sanearBorradorPesaje(base({ entidadId: 'zz' })).mensaje).toContain('el proveedor');
  });
  it('en traslado no valida la entidad', () => {
    expect(sanearBorradorPesaje(base({ tipo: 'traslado', entidadId: 'zz' })).limpiarEntidad).toBe(false);
  });
});
