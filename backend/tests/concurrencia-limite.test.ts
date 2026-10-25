import { describe, it, expect } from 'vitest';
import { ejecutarConLimite } from '../../frontend/src/lib/concurrencia';

const pausa = () => new Promise<void>(r => setTimeout(r, 1));

describe('ejecutarConLimite', () => {
  it('nunca pasa del límite de tareas en vuelo y las completa todas', async () => {
    let enVuelo = 0;
    let maximo = 0;
    const tareas = Array.from({ length: 11 }, (_, i) => async () => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await pausa();
      enVuelo--;
      return i;
    });
    const r = await ejecutarConLimite(tareas, 3);
    expect(maximo).toBe(3);
    expect(r.map(x => (x.status === 'fulfilled' ? x.value : -1))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('una tarea que falla no detiene a las demás ni rechaza el conjunto', async () => {
    const r = await ejecutarConLimite([async () => 1, async () => { throw new Error('x'); }, async () => 3], 2);
    expect(r.map(x => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('sin tareas devuelve una lista vacía; un límite inválido se trata como 1', async () => {
    expect(await ejecutarConLimite([], 3)).toEqual([]);
    const r = await ejecutarConLimite([async () => 'a', async () => 'b'], 0);
    expect(r).toHaveLength(2);
  });
});
