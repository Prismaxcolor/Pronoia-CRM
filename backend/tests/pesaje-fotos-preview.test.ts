import { describe, it, expect, vi } from 'vitest';
import type { FotoLocal } from '../../frontend/src/lib/foto-picker';
import { conFotosAgregadas, fotosNuevasDeFiles, quitarFotoLiberando, revocarFoto, revocarFotos, revocarFotosDeFilas, sinFotoEn } from '../../frontend/src/features/pesaje/fotos-preview';

const nueva = (preview: string): FotoLocal => ({ tipo: 'nueva', file: new File(['x'], 'f.jpg'), preview });
const existente = (url: string): FotoLocal => ({ tipo: 'existente', url });

describe('revocarFoto', () => {
  it('libera la vista previa de una foto nueva', () => {
    const revocar = vi.fn();
    revocarFoto(nueva('blob:a'), revocar);
    expect(revocar).toHaveBeenCalledTimes(1);
    expect(revocar).toHaveBeenCalledWith('blob:a');
  });
  it('no toca las fotos ya subidas ni un índice inexistente', () => {
    const revocar = vi.fn();
    revocarFoto(existente('https://x/f.jpg'), revocar);
    revocarFoto(undefined, revocar);
    expect(revocar).not.toHaveBeenCalled();
  });
});

describe('revocarFotos y revocarFotosDeFilas', () => {
  it('libera solo las nuevas de una lista', () => {
    const revocar = vi.fn();
    revocarFotos([nueva('blob:a'), existente('https://x/1'), nueva('blob:b')], revocar);
    expect(revocar.mock.calls.map(c => c[0])).toEqual(['blob:a', 'blob:b']);
  });
  it('recorre las fotos de todas las filas', () => {
    const revocar = vi.fn();
    revocarFotosDeFilas([{ fotos: [nueva('blob:a')] }, { fotos: [] }, { fotos: [nueva('blob:b')] }], revocar);
    expect(revocar.mock.calls.map(c => c[0])).toEqual(['blob:a', 'blob:b']);
  });
});

describe('sinFotoEn', () => {
  it('devuelve una copia sin la posición indicada y no muta el original', () => {
    const fotos = [existente('a'), existente('b'), existente('c')];
    const resto = sinFotoEn(fotos, 1);
    expect(resto.map(f => (f.tipo === 'existente' ? f.url : ''))).toEqual(['a', 'c']);
    expect(fotos).toHaveLength(3);
  });
});

describe('fotosNuevasDeFiles', () => {
  it('crea una foto nueva por archivo con su vista previa', () => {
    const crear = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake');
    const fotos = fotosNuevasDeFiles([new File(['x'], 'a.jpg'), new File(['y'], 'b.jpg')]);
    expect(fotos).toHaveLength(2);
    expect(fotos[0]).toMatchObject({ tipo: 'nueva', preview: 'blob:fake' });
    expect(crear).toHaveBeenCalledTimes(2);
    crear.mockRestore();
  });
});

describe('conFotosAgregadas y quitarFotoLiberando', () => {
  it('agrega fotos nuevas sin mutar la lista original', () => {
    const crear = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake');
    const original = [existente('a')];
    const r = conFotosAgregadas(original, [new File(['x'], 'a.jpg')]);
    expect(r).toHaveLength(2);
    expect(original).toHaveLength(1);
    crear.mockRestore();
  });
  it('al quitar una foto nueva libera su vista previa y devuelve el resto', () => {
    const revocar = vi.fn();
    const r = quitarFotoLiberando([existente('a'), nueva('blob:b')], 1, revocar);
    expect(revocar).toHaveBeenCalledWith('blob:b');
    expect(r).toHaveLength(1);
  });
  it('al quitar una foto ya subida no libera nada', () => {
    const revocar = vi.fn();
    expect(quitarFotoLiberando([existente('a'), nueva('blob:b')], 0, revocar)).toHaveLength(1);
    expect(revocar).not.toHaveBeenCalled();
  });
});
