import { describe, it, expect, vi } from 'vitest';
import type { MaterialFila } from '../../frontend/src/features/pesaje/material-fila';
import type { LoteTrasladoFila } from '../../frontend/src/features/pesaje/lote-traslado-fila';
import type { PesajeGlobalFila } from '../../frontend/src/features/pesaje/pesaje-global-fila';
import {
  subirLotesTraslado,
  subirMaterialesTicket,
  subirMaterialesTraslado,
  subirPesajesGlobales,
  type SubidorFotos,
} from '../../frontend/src/features/pesaje/pesaje-subida';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cast = (...v: unknown[]) => v as any;
const taras = cast({ id: 't1', nombre: 'Saca', peso: 2, activo: true });
const productos = cast({ id: 'p1', tipoMaterialSinLote: false, loteIds: ['l1'] }, { id: 'p2', tipoMaterialSinLote: true, loteIds: [] });
const foto = (url: string) => ({ tipo: 'existente' as const, url });
const fila = (extra: Partial<MaterialFila> = {}): MaterialFila => ({
  uid: 1, productoId: 'p1', subcategoria: '  sub  ', pesoBruto: '10', taraModo: 'preconfigurada', taraId: 't1',
  taraCantidad: '2', taraManual: '', destino: 'l1', fotos: [foto('a')], ...extra,
});
/** Subidor falso: devuelve "subida:<url>" por foto; falla (null) si alguna foto se llama "mala". */
const subidor = (): SubidorFotos & { subirFotos: ReturnType<typeof vi.fn> } => ({
  subirFotos: vi.fn(async (fotos: Array<{ tipo: string; url?: string }>) =>
    (fotos.some(f => f.url === 'mala') ? null : fotos.map(f => `subida:${f.url}`))),
});

describe('subirMaterialesTraslado', () => {
  it('arma el payload con tara calculada, subcategoría recortada y las URLs subidas', async () => {
    const r = await subirMaterialesTraslado(subidor(), [fila()], taras);
    expect(r).toEqual([{ productoId: 'p1', subcategoria: 'sub', pesoBruto: 10, tara: 4, fotos: ['subida:a'] }]);
  });
  it('subcategoría vacía se manda como null y un bruto inválido como 0', async () => {
    const r = await subirMaterialesTraslado(subidor(), [fila({ subcategoria: ' ', pesoBruto: 'x' })], taras);
    expect(r?.[0]).toMatchObject({ subcategoria: null, pesoBruto: 0 });
  });
  it('sube fila por fila y se detiene en la primera que falla', async () => {
    const s = subidor();
    const r = await subirMaterialesTraslado(s, [fila({ fotos: [foto('mala')] }), fila({ uid: 2 })], taras);
    expect(r).toBeNull();
    expect(s.subirFotos).toHaveBeenCalledTimes(1);
  });
});

describe('subirLotesTraslado', () => {
  const lote = (extra: Partial<LoteTrasladoFila> = {}): LoteTrasladoFila => ({ uid: 1, loteId: 'l1', pesoBruto: '5', tara: '1', fotos: [foto('b')], ...extra });
  it('arma loteId, pesos numéricos y fotos subidas', async () => {
    expect(await subirLotesTraslado(subidor(), [lote()])).toEqual([{ loteId: 'l1', pesoBruto: 5, tara: 1, fotos: ['subida:b'] }]);
  });
  it('devuelve null si una subida falla', async () => {
    expect(await subirLotesTraslado(subidor(), [lote({ fotos: [foto('mala')] })])).toBeNull();
  });
});

describe('subirMaterialesTicket', () => {
  it('usa el payload del material (destino, tara detallada) y agrega las fotos subidas', async () => {
    const r = await subirMaterialesTicket(subidor(), [fila(), fila({ uid: 2, productoId: 'p2', destino: '' })], taras, productos);
    expect(r?.[0]).toMatchObject({ productoId: 'p1', destinoTipo: 'lote', loteId: 'l1', tara: 4, fotos: ['subida:a'] });
    expect(r?.[1]).toMatchObject({ productoId: 'p2', destinoTipo: 'mpp', loteId: null });
  });
  it('devuelve null si una subida falla', async () => {
    expect(await subirMaterialesTicket(subidor(), [fila({ fotos: [foto('mala')] })], taras, productos)).toBeNull();
  });
});

describe('subirPesajesGlobales', () => {
  const global = (extra: Partial<PesajeGlobalFila> = {}): PesajeGlobalFila => ({ uid: 1, peso: '100', tara: '5', fotos: [foto('g')], ...extra });
  it('sube las fotos de cada pesada y convierte pesos a número', async () => {
    expect(await subirPesajesGlobales(subidor(), [global()])).toEqual([{ peso: 100, tara: 5, fotos: ['subida:g'] }]);
  });
  it('una pesada sin fotos no sube nada y va con fotos vacías', async () => {
    const s = subidor();
    expect(await subirPesajesGlobales(s, [global({ fotos: [], tara: '' })])).toEqual([{ peso: 100, tara: 0, fotos: [] }]);
    expect(s.subirFotos).not.toHaveBeenCalled();
  });
  it('devuelve null si una subida falla', async () => {
    expect(await subirPesajesGlobales(subidor(), [global({ fotos: [foto('mala')] })])).toBeNull();
  });
});
