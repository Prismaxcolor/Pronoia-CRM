import { describe, it, expect, vi } from 'vitest';
import { leerPaginado, TAMANO_PAGINA, trocear } from '../src/utils/paginacion.js';

const filas = (n: number, desde = 0) => Array.from({ length: n }, (_, i) => ({ id: desde + i }));

describe('leerPaginado', () => {
  it('junta varias páginas hasta una incompleta (sin truncar en 1000)', async () => {
    const total = TAMANO_PAGINA * 2 + 5;
    const consulta = vi.fn(async (d: number, h: number) => ({
      data: filas(Math.min(h + 1, total) - d, d),
      error: null,
    }));
    const r = await leerPaginado<{ id: number }>(consulta);
    expect(r).toHaveLength(total);
    expect(consulta).toHaveBeenCalledTimes(3);
    expect(consulta).toHaveBeenNthCalledWith(2, TAMANO_PAGINA, TAMANO_PAGINA * 2 - 1);
  });

  it('una página llena exacta pide una más para confirmar el final', async () => {
    const consulta = vi.fn(async (d: number) => ({ data: d === 0 ? filas(TAMANO_PAGINA) : [], error: null }));
    expect(await leerPaginado(consulta)).toHaveLength(TAMANO_PAGINA);
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('propaga el error en vez de devolver datos parciales', async () => {
    await expect(leerPaginado(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom');
  });
});

describe('trocear', () => {
  it('parte en trozos del tamaño pedido, con el último incompleto', () => {
    expect(trocear([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('lista vacía da cero trozos y no muta la entrada', () => {
    const entrada = [1, 2, 3];
    expect(trocear([], 2)).toEqual([]);
    trocear(entrada, 2);
    expect(entrada).toEqual([1, 2, 3]);
  });
  it('por defecto usa 200 ids por trozo', () => {
    const r = trocear(Array.from({ length: 450 }, (_, i) => i));
    expect(r.map(t => t.length)).toEqual([200, 200, 50]);
  });
});

describe('leerPaginado: error con codigo', () => {
  it('conserva el codigo de Postgres para poder distinguir "tabla inexistente" de otros fallos', async () => {
    const err = await leerPaginado(async () => ({ data: null, error: { message: 'relation x does not exist', code: '42P01' } })).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('42P01');
  });
});
