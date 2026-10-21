import { describe, it, expect } from 'vitest';
import type { MaterialFila } from '../../frontend/src/features/pesaje/material-fila';
import type { LoteTrasladoFila } from '../../frontend/src/features/pesaje/lote-traslado-fila';
import type { PesajeGlobalFila } from '../../frontend/src/features/pesaje/pesaje-global-fila';
import {
  materialesLlenos,
  validarTicket,
  validarTraslado,
  type EntradaValidarTicket,
  type EntradaValidarTraslado,
} from '../../frontend/src/features/pesaje/pesaje-validacion';

const FOTO = [{ tipo: 'existente', url: 'https://x/f.jpg' }] as unknown as MaterialFila['fotos'];
const fila = (extra: Partial<MaterialFila> = {}): MaterialFila => ({
  uid: 1, productoId: 'p1', subcategoria: '', pesoBruto: '10', taraModo: 'manual', taraId: '',
  taraCantidad: '', taraManual: '2', destino: 'l1', fotos: FOTO, ...extra,
});
const loteFila = (extra: Partial<LoteTrasladoFila> = {}): LoteTrasladoFila => ({
  uid: 1, loteId: 'l1', pesoBruto: '5', tara: '0', fotos: FOTO, ...extra,
});
const global = (extra: Partial<PesajeGlobalFila> = {}): PesajeGlobalFila => ({ uid: 1, peso: '10', tara: '0', fotos: FOTO, ...extra });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cast = (v: unknown) => v as any;
const productos = cast([{ id: 'p1', tipoMaterialSinLote: false, loteIds: ['l1'] }, { id: 'p2', tipoMaterialSinLote: true, loteIds: [] }]);
const taras = cast([{ id: 't1', nombre: 'Saca', peso: 1, activo: true }, { id: 't2', nombre: 'Vieja', peso: 1, activo: false }]);

describe('validarTraslado', () => {
  const base = (extra: Partial<EntradaValidarTraslado> = {}): EntradaValidarTraslado => ({
    almacenOrigenId: 'a1', almacenDestinoId: 'a2', materiales: [fila()], loteFilas: [], taras, ...extra,
  });
  it('un traslado completo es válido', () => {
    expect(validarTraslado(base())).toBeNull();
  });
  it('pide origen, destino y que sean distintos, en ese orden', () => {
    expect(validarTraslado(base({ almacenOrigenId: '', almacenDestinoId: '' }))).toBe('Elige el almacén de origen.');
    expect(validarTraslado(base({ almacenDestinoId: '' }))).toBe('Elige el almacén de destino.');
    expect(validarTraslado(base({ almacenDestinoId: 'a1' }))).toBe('El almacén de origen y destino no pueden ser el mismo.');
  });
  it('ignora las filas sin material y exige algo que trasladar', () => {
    const vacia = fila({ productoId: '' });
    expect(materialesLlenos([vacia, fila()])).toHaveLength(1);
    expect(validarTraslado(base({ materiales: [vacia] }))).toBe('Agrega al menos un material o un lote a trasladar.');
  });
  it('un traslado solo de lotes es válido aunque la fila de material esté vacía', () => {
    expect(validarTraslado(base({ materiales: [fila({ productoId: '' })], loteFilas: [loteFila()] }))).toBeNull();
  });
  it('valida tara vigente, neto y fotos de los materiales', () => {
    const noVigente = fila({ taraModo: 'preconfigurada', taraId: 't2', taraCantidad: '1' });
    expect(validarTraslado(base({ materiales: [noVigente] }))).toBe('Una tara elegida ya no está disponible. Vuelve a elegirla.');
    expect(validarTraslado(base({ materiales: [fila({ pesoBruto: '1', taraManual: '3' })] })))
      .toBe('El peso neto de un material no puede ser negativo. Revisa bruto y tara.');
    expect(validarTraslado(base({ materiales: [fila({ pesoBruto: '2', taraManual: '2' })] })))
      .toBe('Cada material debe tener un peso neto mayor a 0.');
    expect(validarTraslado(base({ materiales: [fila({ fotos: [] })] }))).toBe('Cada material necesita al menos una foto.');
  });
  it('valida lote elegido, neto y foto de cada lote a trasladar', () => {
    expect(validarTraslado(base({ loteFilas: [loteFila({ loteId: '' })] }))).toBe('Selecciona el lote de cada fila.');
    expect(validarTraslado(base({ loteFilas: [loteFila({ pesoBruto: '1', tara: '1' })] }))).toBe('Cada lote debe tener un peso neto mayor a 0.');
    expect(validarTraslado(base({ loteFilas: [loteFila({ fotos: [] })] }))).toBe('Cada lote necesita al menos una foto del pesaje.');
  });
});

describe('validarTicket', () => {
  const base = (extra: Partial<EntradaValidarTicket> = {}): EntradaValidarTicket => ({
    estado: 'completo', entidadId: 'e1', labelEntidad: 'Proveedor', sinPesajeGlobal: false,
    pesajesGlobales: [global()], materiales: [fila()], productos, taras, devolucion: '', fotosDevolucion: [], diferencia: 2, ...extra,
  });
  it('un ticket completo es válido', () => {
    expect(validarTicket(base())).toBeNull();
  });
  it('pide la entidad con la etiqueta en minúsculas', () => {
    expect(validarTicket(base({ entidadId: '' }))).toBe('Elige un proveedor.');
    expect(validarTicket(base({ entidadId: '', labelEntidad: 'Cliente' }))).toBe('Elige un cliente.');
  });
  it('exige pesaje global con peso y fotos, salvo peso exterior', () => {
    expect(validarTicket(base({ pesajesGlobales: [global({ peso: '0' })] }))).toBe('Registra al menos un pesaje global con peso mayor a 0.');
    expect(validarTicket(base({ pesajesGlobales: [global({ fotos: [] })] }))).toBe('Cada pesaje global necesita al menos una foto.');
    expect(validarTicket(base({ sinPesajeGlobal: true, pesajesGlobales: [global({ peso: '0', fotos: [] })], diferencia: 0 }))).toBeNull();
  });
  it('en estado bruto solo valida entidad y pesaje global', () => {
    expect(validarTicket(base({ estado: 'bruto', materiales: [fila({ productoId: '', fotos: [] })] }))).toBeNull();
  });
  it('en estado completo valida cada material', () => {
    expect(validarTicket(base({ materiales: [fila({ productoId: '' })] }))).toBe('Cada material debe tener un producto seleccionado.');
    expect(validarTicket(base({ materiales: [fila({ destino: '' })] }))).toBe('Cada material debe tener un destino seleccionado.');
    expect(validarTicket(base({ materiales: [fila({ productoId: 'p2', destino: '' })] }))).toBeNull();
    expect(validarTicket(base({ materiales: [fila({ taraModo: 'preconfigurada', taraId: '', taraCantidad: '2' })] })))
      .toBe('Selecciona la tara preconfigurada para las unidades ingresadas.');
    expect(validarTicket(base({ materiales: [fila({ fotos: [] })] }))).toBe('Cada material necesita al menos una foto.');
  });
  it('exige foto de la devolución cuando hay kilos devueltos', () => {
    expect(validarTicket(base({ devolucion: '1' }))).toBe('Agrega al menos una foto de la devolución.');
    expect(validarTicket(base({ devolucion: '1', fotosDevolucion: FOTO }))).toBeNull();
  });
  it('bloquea cuando los materiales pesan más que el peso global', () => {
    expect(validarTicket(base({ diferencia: -1 }))).toBe(
      'La suma de materiales + devolución supera el peso global — eso favorece al proveedor. Revisa los pesos antes de guardar.',
    );
    expect(validarTicket(base({ diferencia: -1, sinPesajeGlobal: true }))).toBeNull();
  });
});
