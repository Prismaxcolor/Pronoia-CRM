import { describe, it, expect } from 'vitest';
import {
  inicialDeCategoria, tarjetasDeCategorias, SIN_CATEGORIA_ID,
} from '../../frontend/src/features/cochinito/categorias/selector-categoria-tarjetas';

type Cat = Parameters<typeof tarjetasDeCategorias>[0][number];
const cat = (id: string, nombre: string, tipo: Cat['tipo'], padreId: string | null = null, extra: Partial<Cat> = {}): Cat =>
  ({ id, nombre, tipo, padreId, activo: true, color: '#15803D', imagenUrl: null, creadoEn: '2026-10-01', ...extra });

const todas: Cat[] = [
  cat('serv', 'Servicios', 'EGRESO'),
  cat('luz', 'Luz', 'EGRESO', 'serv', { imagenUrl: 'https://x/luz.png' }),
  cat('ventas', 'Ventas', 'INGRESO'),
  cat('mixta', 'Ajustes', 'AMBOS'),
  cat('vieja', 'Vieja', 'EGRESO', null, { activo: false }),
  cat('hija-vieja', 'Hija', 'EGRESO', 'vieja'),
];

const ids = (r: ReturnType<typeof tarjetasDeCategorias>) => r.map(t => t.id);

describe('inicialDeCategoria', () => {
  it('primera letra en mayúscula; ? si no hay nombre', () => {
    expect(inicialDeCategoria(' luz')).toBe('L');
    expect(inicialDeCategoria('  ')).toBe('?');
  });
});

describe('tarjetasDeCategorias', () => {
  it('sin filtros: solo activas, categoría seguida de sus subcategorías, ordenadas por nombre', () => {
    expect(ids(tarjetasDeCategorias(todas, {}))).toEqual(['mixta', 'serv', 'luz', 'ventas']);
  });
  it('la subcategoría lleva el nombre de su categoría padre y su imagen', () => {
    const luz = tarjetasDeCategorias(todas, {}).find(t => t.id === 'luz');
    expect(luz).toMatchObject({ nombre: 'Luz', padreNombre: 'Servicios', imagenUrl: 'https://x/luz.png', color: '#15803D', inicial: 'L' });
    expect(tarjetasDeCategorias(todas, {}).find(t => t.id === 'serv')?.padreNombre).toBeNull();
  });
  it('filtra por tipo de movimiento (AMBOS entra en los dos)', () => {
    expect(ids(tarjetasDeCategorias(todas, { tipoMovimiento: 'egreso' }))).toEqual(['mixta', 'serv', 'luz']);
    expect(ids(tarjetasDeCategorias(todas, { tipoMovimiento: 'ingreso' }))).toEqual(['mixta', 'ventas']);
  });
  it('soloIds limita a esas categorías', () => {
    expect(ids(tarjetasDeCategorias(todas, { soloIds: ['luz', 'ventas', 'no-existe'] }))).toEqual(['luz', 'ventas']);
    expect(tarjetasDeCategorias(todas, { soloIds: [] })).toEqual([]);
  });
  it('busca por nombre o por categoría padre, sin importar mayúsculas ni tildes', () => {
    expect(ids(tarjetasDeCategorias(todas, { busqueda: 'LUZ' }))).toEqual(['luz']);
    expect(ids(tarjetasDeCategorias(todas, { busqueda: 'servicios' }))).toEqual(['serv', 'luz']);
    expect(ids(tarjetasDeCategorias(todas, { busqueda: 'ajústes' }))).toEqual(['mixta']);
    expect(tarjetasDeCategorias(todas, { busqueda: 'zzz' })).toEqual([]);
  });
  it('no muta la lista recibida', () => {
    const copia = JSON.parse(JSON.stringify(todas));
    tarjetasDeCategorias(todas, { tipoMovimiento: 'egreso', busqueda: 'a' });
    expect(todas).toEqual(copia);
  });
  it('SIN_CATEGORIA_ID no choca con un uuid', () => {
    expect(SIN_CATEGORIA_ID).toBe('sin');
  });
});
