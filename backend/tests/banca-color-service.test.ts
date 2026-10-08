import { describe, it, expect, vi, beforeEach } from 'vitest';

type Resp = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({ respuestas: [] as unknown[], escrituras: [] as Array<Record<string, unknown>> }));

vi.mock('../src/config/supabase.js', () => {
  const cadena = (valores: Record<string, unknown>) => {
    bd.escrituras.push(valores);
    const resp = () => Promise.resolve(bd.respuestas.shift() as Resp);
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'select']) c[m] = () => c;
    c.single = resp;
    c.maybeSingle = resp;
    return c;
  };
  return { supabaseAdmin: { from: () => ({ insert: cadena, update: cadena }) } };
});

import { actualizarBanca, crearBanca } from '../src/services/banca-service.js';

const fila = { id: 'b1', nombre: 'BNC', tipo: 'banco_nacional', saldo: 0, moneda: 'USD', descripcion: '', archivada: false };
const columnaFalta = { code: '42703', message: 'column "color" of relation "bancas" does not exist' };
const base = { nombre: 'BNC', tipo: 'banco_nacional' as const, moneda: 'USD', descripcion: null };

beforeEach(() => { bd.respuestas = []; bd.escrituras = []; });

describe('color de banca en el servicio', () => {
  it('crear con color lo envía y lo devuelve', async () => {
    bd.respuestas = [{ data: { ...fila, color: 'azul' }, error: null }];
    const r = await crearBanca({ ...base, color: 'azul' });
    expect(bd.escrituras[0].color).toBe('azul');
    expect(r).toMatchObject({ banca: { color: 'azul' } });
  });
  it('crear sin color no envía la columna', async () => {
    bd.respuestas = [{ data: fila, error: null }];
    const r = await crearBanca(base);
    expect('color' in bd.escrituras[0]).toBe(false);
    expect(r).toMatchObject({ banca: { color: null } });
  });
  it('crear con color y migración sin aplicar degrada: reintenta sin color', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }, { data: fila, error: null }];
    const r = await crearBanca({ ...base, color: 'rojo' });
    expect(bd.escrituras).toHaveLength(2);
    expect('color' in bd.escrituras[1]).toBe(false);
    expect(r).toMatchObject({ banca: { color: null } });
  });
  it('editar degrada igual si falta la columna', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }, { data: fila, error: null }];
    const r = await actualizarBanca('b1', { nombre: 'BNC', color: 'verde' });
    expect(bd.escrituras[1]).toEqual({ nombre: 'BNC' });
    expect('banca' in r).toBe(true);
  });
  it('otros errores no se degradan', async () => {
    bd.respuestas = [{ data: null, error: { code: '23514', message: 'check' } }];
    const r = await actualizarBanca('b1', { color: 'verde' });
    expect(r).toEqual({ error: 'check' });
    expect(bd.escrituras).toHaveLength(1);
  });
});
