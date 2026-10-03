import { describe, it, expect, vi } from 'vitest';
import { leerPaginado, TAMANO_PAGINA } from '../src/utils/paginacion.js';

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
