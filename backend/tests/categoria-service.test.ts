import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
type Resp = { data: unknown; error: { code?: string; message: string } | null };
interface Llamada { tabla: string; op: string; valores?: Fila; filtros: Array<[string, unknown]> }

const bd = vi.hoisted(() => ({
  categorias: [] as Array<Record<string, unknown>>,
  movimiento: null as Record<string, unknown> | null,
  errorEscritura: null as { code?: string; message: string } | null,
  errorLectura: null as { code?: string; message: string } | null,
  llamadas: [] as Array<{ tabla: string; op: string; valores?: Record<string, unknown>; filtros: Array<[string, unknown]> }>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const llamada: Llamada = { tabla, op: 'select', filtros: [] };
      const resolver = (): Resp => {
        bd.llamadas.push(llamada);
        if (llamada.op === 'select') {
          if (bd.errorLectura) return { data: null, error: bd.errorLectura };
          return { data: tabla === 'categorias_wallet' ? bd.categorias : bd.movimiento, error: null };
        }
        if (bd.errorEscritura) return { data: null, error: bd.errorEscritura };
        const id = llamada.filtros.find(([k]) => k === 'id')?.[1] ?? 'nueva';
        const previa = bd.categorias.find(f => f.id === id) ?? {};
        return { data: { id, created_at: '2026-10-11T00:00:00Z', activo: true, padre_id: null, ...previa, ...llamada.valores }, error: null };
      };
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.order = () => c;
      c.limit = () => c;
      c.eq = (k: string, v: unknown) => { llamada.filtros.push([k, v]); return c; };
      c.insert = (v: Fila) => { llamada.op = 'insert'; llamada.valores = v; return c; };
      c.update = (v: Fila) => { llamada.op = 'update'; llamada.valores = v; return c; };
      c.single = () => Promise.resolve(resolver());
      c.maybeSingle = () => Promise.resolve(resolver());
      c.then = (ok: (r: Resp) => unknown) => Promise.resolve(resolver()).then(ok);
      return c;
    },
  },
}));

import {
  actualizarCategoria, aplicarCategoriaSiFalta, asignarCategoriaMovimiento, crearCategoria, listarCategorias, validarCategoriaDeMovimiento,
} from '../src/services/categoria-service.js';

const fila = (id: string, extra: Fila = {}): Fila =>
  ({ id, nombre: id, tipo: 'EGRESO', color: '#DC2626', padre_id: null, activo: true, created_at: '2026-10-01T00:00:00Z', ...extra });
const escrituras = () => bd.llamadas.filter(l => l.op !== 'select');

beforeEach(() => {
  bd.categorias = [fila('serv'), fila('luz', { padre_id: 'serv' })];
  bd.movimiento = null; bd.errorEscritura = null; bd.errorLectura = null; bd.llamadas = [];
});

describe('listarCategorias', () => {
  it('mapea a camelCase', async () => {
    const r = await listarCategorias();
    expect(r).toMatchObject({ categorias: [{ id: 'serv', padreId: null, activo: true }, { id: 'luz', padreId: 'serv', color: '#DC2626' }] });
  });
  it('tabla inexistente => 503 con el nombre de la migración', async () => {
    bd.errorLectura = { code: '42P01', message: 'relation "categorias_wallet" does not exist' };
    const r = await listarCategorias();
    expect(r).toMatchObject({ codigo: 503 });
    expect('error' in r && r.error).toContain('migration_wallet_categorias.sql');
  });
  it('otro error de lectura => 500 genérico (no filtra el mensaje de la BD)', async () => {
    bd.errorLectura = { code: '08006', message: 'host=10.0.0.1 caída' };
    const r = await listarCategorias();
    expect(r).toMatchObject({ codigo: 500 });
    expect('error' in r && r.error).not.toContain('10.0.0.1');
  });
});

describe('crearCategoria', () => {
  it('crea una categoría raíz y registra quién la creó', async () => {
    const r = await crearCategoria({ nombre: 'Nómina', tipo: 'EGRESO', color: '#15803D', padreId: null }, 'u1');
    expect(r).toMatchObject({ categoria: { nombre: 'Nómina', tipo: 'EGRESO', color: '#15803D' } });
    expect(escrituras()[0].valores).toMatchObject({ nombre: 'Nómina', padre_id: null, created_by: 'u1' });
  });
  it('rechaza un padre que ya es subcategoría (dos niveles) sin escribir', async () => {
    const r = await crearCategoria({ nombre: 'X', tipo: 'EGRESO', color: '#15803D', padreId: 'luz' }, 'u1');
    expect(r).toMatchObject({ codigo: 400 });
    expect(escrituras()).toHaveLength(0);
  });
  it('rechaza una subcategoría de tipo distinto al del padre', async () => {
    const r = await crearCategoria({ nombre: 'X', tipo: 'INGRESO', color: '#15803D', padreId: 'serv' }, 'u1');
    expect(r).toMatchObject({ codigo: 400 });
  });
  it('nombre repetido en el mismo nivel (23505) => 409', async () => {
    bd.errorEscritura = { code: '23505', message: 'duplicate key' };
    const r = await crearCategoria({ nombre: 'Nómina', tipo: 'EGRESO', color: '#15803D', padreId: null }, 'u1');
    expect(r).toMatchObject({ codigo: 409 });
  });
});

describe('actualizarCategoria', () => {
  it('cambia nombre y color', async () => {
    const r = await actualizarCategoria('serv', { nombre: 'Servicios básicos', color: '#0369A1' });
    expect(r).toMatchObject({ categoria: { id: 'serv' } });
    expect(escrituras()[0].valores).toEqual({ nombre: 'Servicios básicos', color: '#0369A1' });
  });
  it('inexistente => 404', async () => {
    expect(await actualizarCategoria('zz', { nombre: 'A' })).toMatchObject({ codigo: 404 });
  });
  it('archivar una categoría archiva también sus subcategorías', async () => {
    await actualizarCategoria('serv', { activo: false });
    const w = escrituras();
    expect(w).toHaveLength(2);
    expect(w[1]).toMatchObject({ valores: { activo: false }, filtros: [['padre_id', 'serv']] });
  });
  it('reactivar una subcategoría con padre archivado => 409', async () => {
    bd.categorias = [fila('serv', { activo: false }), fila('luz', { padre_id: 'serv', activo: false })];
    expect(await actualizarCategoria('luz', { activo: true })).toMatchObject({ codigo: 409 });
  });
  it('no deja estrechar el tipo de una categoría si una subcategoría quedaría incompatible', async () => {
    bd.categorias = [fila('serv', { tipo: 'AMBOS' }), fila('luz', { padre_id: 'serv', tipo: 'INGRESO' })];
    expect(await actualizarCategoria('serv', { tipo: 'EGRESO' })).toMatchObject({ codigo: 409 });
  });
  it('no deja ampliar el tipo de una subcategoría más que el de su padre', async () => {
    expect(await actualizarCategoria('luz', { tipo: 'AMBOS' })).toMatchObject({ codigo: 409 });
  });
});

describe('validarCategoriaDeMovimiento', () => {
  it('sin categoría no consulta la BD', async () => {
    expect(await validarCategoriaDeMovimiento(null, 'egreso')).toBeNull();
    expect(await validarCategoriaDeMovimiento(undefined, 'transferencia')).toBeNull();
    expect(bd.llamadas).toHaveLength(0);
  });
  it('categoría válida => null; de otro tipo => 400; tabla faltante => 503', async () => {
    expect(await validarCategoriaDeMovimiento('luz', 'egreso')).toBeNull();
    expect(await validarCategoriaDeMovimiento('luz', 'ingreso')).toMatchObject({ codigo: 400 });
    bd.errorLectura = { code: '42P01', message: 'relation "categorias_wallet" does not exist' };
    expect(await validarCategoriaDeMovimiento('luz', 'egreso')).toMatchObject({ codigo: 503 });
  });
});

describe('asignarCategoriaMovimiento', () => {
  const movimiento = (extra: Fila = {}): Fila => ({ id: 'm1', tipo: 'egreso', anulado: false, subtipo: null, grupo_id: null, ...extra });

  it('asigna la categoría a un movimiento manual vigente', async () => {
    bd.movimiento = movimiento();
    expect(await asignarCategoriaMovimiento('m1', 'luz')).toEqual({ ok: true });
    expect(escrituras()[0]).toMatchObject({ tabla: 'movimientos', valores: { categoria_id: 'luz' }, filtros: [['id', 'm1']] });
  });
  it('null deja el movimiento sin categoría', async () => {
    bd.movimiento = movimiento();
    expect(await asignarCategoriaMovimiento('m1', null)).toEqual({ ok: true });
    expect(escrituras()[0].valores).toEqual({ categoria_id: null });
  });
  it('rechaza: inexistente (404), anulado, pago/cobro, transferencia y categoría de otro tipo (409/400)', async () => {
    bd.movimiento = null;
    expect(await asignarCategoriaMovimiento('m1', 'luz')).toMatchObject({ codigo: 404 });
    bd.movimiento = movimiento({ anulado: true });
    expect(await asignarCategoriaMovimiento('m1', 'luz')).toMatchObject({ codigo: 409 });
    bd.movimiento = movimiento({ subtipo: 'pago', grupo_id: 'g1' });
    expect(await asignarCategoriaMovimiento('m1', 'luz')).toMatchObject({ codigo: 409 });
    bd.movimiento = movimiento({ tipo: 'transferencia' });
    expect(await asignarCategoriaMovimiento('m1', 'luz')).toMatchObject({ codigo: 409 });
    bd.movimiento = movimiento({ tipo: 'ingreso' });
    expect(await asignarCategoriaMovimiento('m1', 'luz')).toMatchObject({ codigo: 400 });
    expect(escrituras()).toHaveLength(0);
  });
  it('quitar la categoría no exige que exista la tabla de categorías', async () => {
    bd.movimiento = movimiento();
    bd.errorLectura = null;
    expect(await asignarCategoriaMovimiento('m1', null)).toEqual({ ok: true });
    expect(bd.llamadas.some(l => l.tabla === 'categorias_wallet')).toBe(false);
  });
});

describe('aplicarCategoriaSiFalta', () => {
  const creado = (categoriaId: string | null) => ({ movimiento: { id: 'm1', categoriaId }, comision: null });

  it('sin categoría pedida, o si el movimiento ya la trae, no escribe', async () => {
    expect(await aplicarCategoriaSiFalta(creado(null), null)).toEqual(creado(null));
    expect(await aplicarCategoriaSiFalta(creado('luz'), 'luz')).toEqual(creado('luz'));
    expect(escrituras()).toHaveLength(0);
  });
  it('si falta, la aplica y devuelve un resultado nuevo con la categoría', async () => {
    const original = creado(null);
    const r = await aplicarCategoriaSiFalta(original, 'luz');
    expect(r.movimiento.categoriaId).toBe('luz');
    expect(original.movimiento.categoriaId).toBeNull();
    expect(escrituras()[0]).toMatchObject({ tabla: 'movimientos', valores: { categoria_id: 'luz' }, filtros: [['id', 'm1']] });
  });
  it('si el update falla, no rompe el registro: devuelve una advertencia', async () => {
    bd.errorEscritura = { code: '08006', message: 'caída' };
    const r = await aplicarCategoriaSiFalta(creado(null), 'luz');
    expect(r.movimiento.categoriaId).toBeNull();
    expect(r.advertencia).toMatch(/categoría/i);
  });
});
