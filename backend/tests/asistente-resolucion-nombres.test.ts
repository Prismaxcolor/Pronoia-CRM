import { describe, it, expect } from 'vitest';
import {
  normalizarNombreLote,
  numerosEnLetras,
  resolverAlmacenEntre,
} from '../src/utils/asistente-resolucion-nombres';

const G1 = { id: 'g1', nombre: 'ALMACEN G1' };
const G2 = { id: 'g2', nombre: 'ALMACEN G2' };
const LISTA = [G1, G2];

describe('numerosEnLetras', () => {
  it('convierte cardinales y ordinales a dígitos', () => {
    expect(numerosEnLetras('lote dos')).toBe('lote 2');
    expect(numerosEnLetras('el segundo galpon')).toBe('el 2 galpon');
    expect(numerosEnLetras('primer galpon')).toBe('1 galpon');
    expect(numerosEnLetras('galpon uno')).toBe('galpon 1');
    expect(numerosEnLetras('lote diez')).toBe('lote 10');
  });

  it('no toca palabras que solo contienen un número en letras', () => {
    expect(numerosEnLetras('dostal')).toBe('dostal');
    expect(numerosEnLetras('bandos')).toBe('bandos');
  });
});

describe('normalizarNombreLote', () => {
  it('"lote 2", "LOTE 2", "lote dos" y "Lote  #2" son lo mismo', () => {
    for (const t of ['lote 2', 'LOTE 2', 'lote dos', 'Lote  #2', 'lote número 2', 'lote nro 2']) {
      expect(normalizarNombreLote(t)).toBe('lote 2');
    }
  });

  it('respeta los nombres sin número', () => {
    expect(normalizarNombreLote('PCB LIGADO')).toBe('pcb ligado');
    expect(normalizarNombreLote('BGPP')).toBe('bgpp');
  });
});

describe('resolverAlmacenEntre: sinónimos y números', () => {
  it.each([
    'G1', 'g1', 'almacén g1', 'ALMACEN G1', 'Almacen  g1 ', 'galpón 1', 'galpon 1', 'el galpon uno',
    'galpón uno', 'primer galpón', 'el primer galpón', 'bodega 1', 'depósito 1', 'deposito uno',
    'almacén 1', 'almacen uno', 'g 1', 'Galpón #1', 'galpón G1', 'el galpón número 1', 'el primero',
  ])('"%s" resuelve a ALMACEN G1', texto => {
    expect(resolverAlmacenEntre(LISTA, texto)).toEqual({ almacen: G1 });
  });

  it.each([
    'G2', 'g2', 'galpón 2', 'galpon 2', 'el galpon dos', 'segundo galpón', 'el segundo galpón',
    'bodega dos', 'depósito 2', 'almacén 2', 'almacen dos', 'ALMACEN G2', 'g dos', 'galpón g2', '2',
  ])('"%s" resuelve a ALMACEN G2', texto => {
    expect(resolverAlmacenEntre(LISTA, texto)).toEqual({ almacen: G2 });
  });

  it('un número que no existe no resuelve a otro almacén', () => {
    expect(resolverAlmacenEntre(LISTA, 'galpón 3')).toMatchObject({ error: 'no_encontrado', candidatos: LISTA });
    expect(resolverAlmacenEntre(LISTA, 'tercer galpón')).toMatchObject({ error: 'no_encontrado' });
  });

  it('un nombre sin número entre varios almacenes es ambiguo y devuelve las opciones', () => {
    expect(resolverAlmacenEntre(LISTA, 'galpón')).toEqual({ error: 'ambiguo', candidatos: LISTA });
    expect(resolverAlmacenEntre(LISTA, 'almacén')).toEqual({ error: 'ambiguo', candidatos: LISTA });
  });

  it('con un solo almacén activo, "el galpón" lo resuelve sin preguntar', () => {
    expect(resolverAlmacenEntre([G1], 'el galpón')).toEqual({ almacen: G1 });
  });

  it('el mismo número con letras distintas: la letra desempata y sin letra es ambiguo', () => {
    const H1 = { id: 'h1', nombre: 'ALMACEN H1' };
    const lista = [G1, H1];
    expect(resolverAlmacenEntre(lista, 'h1')).toEqual({ almacen: H1 });
    expect(resolverAlmacenEntre(lista, 'g1')).toEqual({ almacen: G1 });
    expect(resolverAlmacenEntre(lista, 'galpón 1')).toEqual({ error: 'ambiguo', candidatos: lista });
  });

  it('"g1" no se confunde con "g10"', () => {
    const G10 = { id: 'g10', nombre: 'ALMACEN G10' };
    expect(resolverAlmacenEntre([G1, G10], 'g1')).toEqual({ almacen: G1 });
    expect(resolverAlmacenEntre([G1, G10], 'galpón 10')).toEqual({ almacen: G10 });
  });

  it('almacenes con nombre propio se siguen resolviendo por texto', () => {
    const principal = { id: 'p', nombre: 'ALMACEN PRINCIPAL' };
    expect(resolverAlmacenEntre([G1, principal], 'principal')).toEqual({ almacen: principal });
    expect(resolverAlmacenEntre([G1, principal], 'galpón principal')).toEqual({ almacen: principal });
  });

  it('un lote o nombre desconocido no es un almacén', () => {
    expect(resolverAlmacenEntre(LISTA, 'BGPP')).toMatchObject({ error: 'no_encontrado' });
    expect(resolverAlmacenEntre(LISTA, 'lote 2')).toMatchObject({ error: 'no_encontrado' });
    expect(resolverAlmacenEntre([], 'g1')).toMatchObject({ error: 'no_encontrado' });
  });
});
