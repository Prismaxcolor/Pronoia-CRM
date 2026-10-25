import { describe, it, expect } from 'vitest';
import type { Tara } from '../../shared/types/index';
import {
  aPesadasConFotos,
  MAX_PESADAS_ENTRADA,
  netoPesadaEntrada,
  pesadaEntradaVacia,
  pesadasDeBorrador,
  totalesEntrada,
  validarPesadasEntrada,
  type PesadaEntradaForm,
} from '../../frontend/src/lib/entrada-pesadas';
import { salidasParaCompletar, varianteDeCompletar } from '../../frontend/src/lib/offline/f4/salidas-f4';
import { itemsConNeto, packingListProvisional, resumenDePackingList, type DatosPackingList } from '../../frontend/src/lib/offline/f4/packing-f4';

const taras = [
  { id: 't1', nombre: 'Saca', peso: 2.5, fotos: [], activo: true, createdAt: '' },
  { id: 't2', nombre: 'Vieja', peso: 9, fotos: [], activo: false, createdAt: '' },
] as Tara[];
const foto = { tipo: 'existente' as const, url: 'https://x/f.jpg' };

const pesada = (extra: Partial<PesadaEntradaForm> = {}): PesadaEntradaForm => ({
  ...pesadaEntradaVacia(), pesoBruto: '100', taraModo: 'manual', taraManual: '10', fotos: [foto], ...extra,
});

describe('pesadas de entrada de una transformación', () => {
  it('una sola pesada equivale al formulario anterior (neto = bruto - tara)', () => {
    const p = pesada();
    expect(netoPesadaEntrada(p, taras)).toBe(90);
    expect(totalesEntrada([p], taras)).toEqual({ cantidad: 1, bruto: 100, tara: 10, neto: 90 });
    expect(validarPesadasEntrada([p], taras)).toBeNull();
  });

  it('varias pesadas se suman en el neto de entrada, mezclando tara preconfigurada y manual', () => {
    const a = pesada({ pesoBruto: '100.5', taraModo: 'preconfigurada', taraId: 't1', taraCantidad: '2' }); // tara 5
    const b = pesada({ pesoBruto: '200', taraManual: '10' });
    const c = pesada({ pesoBruto: '0.125', taraManual: '0' });
    const t = totalesEntrada([a, b, c], taras);
    expect(t).toEqual({ cantidad: 3, bruto: 300.625, tara: 15, neto: 285.625 });
  });

  it('valida cada pesada y dice cuál falla', () => {
    expect(validarPesadasEntrada([], taras)).toMatch(/al menos una pesada/);
    expect(validarPesadasEntrada([pesada(), pesada({ pesoBruto: '' })], taras)).toMatch(/Pesada 2: ingresa el peso bruto/);
    expect(validarPesadasEntrada([pesada({ taraManual: '100' })], taras)).toMatch(/neto debe ser mayor a 0/);
    expect(validarPesadasEntrada([pesada({ fotos: [] })], taras)).toMatch(/al menos una foto/);
    expect(validarPesadasEntrada([pesada({ taraModo: 'preconfigurada', taraId: 't2', taraCantidad: '1' })], taras)).toMatch(/ya no está disponible/);
  });

  it('con una sola pesada los mensajes no llevan número de pesada', () => {
    expect(validarPesadasEntrada([pesada({ fotos: [] })], taras)).toBe('agrega al menos una foto.');
  });

  it('rechaza más pesadas que el tope', () => {
    const muchas = Array.from({ length: MAX_PESADAS_ENTRADA + 1 }, () => pesada());
    expect(validarPesadasEntrada(muchas, taras)).toMatch(/Máximo/);
  });

  it('arma las pesadas para enviar con bruto y tara numéricos y sus fotos', () => {
    const r = aPesadasConFotos([pesada(), pesada({ pesoBruto: '50', taraModo: 'preconfigurada', taraId: 't1', taraCantidad: '4' })], taras);
    expect(r).toEqual([
      { pesoBruto: 100, tara: 10, fotos: [foto] },
      { pesoBruto: 50, tara: 10, fotos: [foto] },
    ]);
  });

  it('un borrador anterior (un solo peso) se convierte en una pesada sin perder nada', () => {
    const r = pesadasDeBorrador({ pesoBruto: '80', campoTara: { taraModo: 'preconfigurada', taraId: 't1', taraCantidad: '2' }, fotos: [foto] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ pesoBruto: '80', taraId: 't1', taraCantidad: '2', fotos: [foto] });
    // PCB guardaba la tara como texto manual.
    const pcb = pesadasDeBorrador({ pesoBruto: '60', tara: '3', fotos: [foto] });
    expect(pcb[0]).toMatchObject({ pesoBruto: '60', taraModo: 'manual', taraManual: '3' });
  });

  it('un borrador nuevo conserva todas sus pesadas con ids de fila frescos', () => {
    const guardadas = [pesada({ uid: 1 }), pesada({ uid: 1 })];
    const r = pesadasDeBorrador({ pesadasEntrada: guardadas });
    expect(r).toHaveLength(2);
    expect(new Set(r.map(p => p.uid)).size).toBe(2);
  });
});

describe('salidas al completar', () => {
  const fila = (extra: Record<string, unknown> = {}) => ({
    tipo: 'material' as const, productoId: 'p1', loteDestinoId: '', almacenId: 'a1', pesoBruto: 50, tara: 5, fotos: [foto], ...extra,
  });

  it('elige la variante: la de siempre si no hay salidas mixtas, mixta si las hay', () => {
    expect(varianteDeCompletar('ferroso_no_ferroso', [fila()])).toBe('ferroso');
    expect(varianteDeCompletar('ferroso_no_ferroso', [fila(), fila({ tipo: 'lote' })])).toBe('mixta');
    expect(varianteDeCompletar('pcb', [fila({ tipo: 'lote' })])).toBe('pcb');
    expect(varianteDeCompletar('pcb', [fila({ tipo: 'material' })])).toBe('mixta');
  });

  it('arma los datos de cada salida según la variante', () => {
    expect(salidasParaCompletar('ferroso', 'ferroso_no_ferroso', [fila()])[0].datos).toEqual({ productoId: 'p1' });
    expect(salidasParaCompletar('pcb', 'pcb', [fila({ tipo: 'lote', loteDestinoId: 'l2' })])[0].datos).toEqual({ loteDestinoId: 'l2' });
    const mixta = salidasParaCompletar('mixta', 'pcb', [fila({ tipo: 'lote', loteDestinoId: 'l2' }), fila()]);
    expect(mixta[0].datos).toEqual({ tipo: 'lote', loteDestinoId: 'l2' });
    expect(mixta[1].datos).toEqual({ tipo: 'material', productoId: 'p1', almacenId: 'a1' });
    expect(mixta[1]).toMatchObject({ pesoBruto: 50, tara: 5, fotos: [foto] });
  });
});

describe('packing list provisional', () => {
  const datos = {
    contenedor: 'C-1', fecha: '2026-10-07', tipoEmbalaje: 'paleta', esPcb: false,
    descripcionEs: null, descripcionEn: null, observacionesEs: null, observacionesEn: null, referenciaTipo: null, referenciaId: null,
    items: [{ numero: 1, pesoBruto: 100.5, pesoPaleta: 5.25 }, { numero: 2, numeroPaleta: 3, pesoBruto: 50, pesoPaleta: 0 }],
  } as unknown as DatosPackingList;

  it('calcula el neto de cada paleta y el resumen del listado', () => {
    expect(itemsConNeto(datos.items).map(i => i.pesoNeto)).toEqual([95.25, 50]);
    const detalle = packingListProvisional(datos, 'tmp_x', '2026-10-07T00:00:00Z');
    expect(detalle).toMatchObject({ id: 'tmp_x', version: 1, createdAt: '2026-10-07T00:00:00Z' });
    expect(resumenDePackingList(detalle)).toMatchObject({ totalBultos: 2, totalNeto: 145.25 });
    expect(resumenDePackingList(detalle)).not.toHaveProperty('items');
  });

  it('al reeditar conserva la fecha de creación', () => {
    const d = packingListProvisional(datos, 'tmp_x', '2026-10-08T00:00:00Z', 1, '2026-10-07T00:00:00Z');
    expect(d.createdAt).toBe('2026-10-07T00:00:00Z');
    expect(d.updatedAt).toBe('2026-10-08T00:00:00Z');
  });
});
