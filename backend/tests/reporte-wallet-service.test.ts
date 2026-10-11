import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
type ErrorBd = { code?: string; message: string } | null;
const bd = vi.hoisted(() => ({
  banca: null as Record<string, unknown> | null,
  movimientos: [] as Array<Record<string, unknown>>,
  categorias: [] as Array<Record<string, unknown>>,
  nombres: [] as Array<Record<string, unknown>>,
  errorCategorias: null as { code?: string; message: string } | null,
  errorMovimientos: null as { code?: string; message: string } | null,
  rangos: [] as Array<[number, number]>,
  filtros: [] as Array<[string, ...unknown[]]>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const c: Record<string, unknown> = {};
      const registrar = (m: string) => (...args: unknown[]) => { bd.filtros.push([`${tabla}.${m}`, ...args]); return c; };
      for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'or', 'in', 'not', 'limit']) c[m] = registrar(m);
      c.maybeSingle = () => Promise.resolve({ data: bd.banca, error: null });
      c.range = (d: number, h: number) => {
        bd.rangos.push([d, h]);
        const error: ErrorBd = bd.errorMovimientos;
        return Promise.resolve(error ? { data: null, error } : { data: bd.movimientos.slice(d, Math.min(h, d + 999) + 1), error: null });
      };
      c.then = (ok: (r: unknown) => unknown) => {
        if (tabla === 'categorias_wallet') return Promise.resolve(bd.errorCategorias ? { data: null, error: bd.errorCategorias } : { data: bd.categorias, error: null }).then(ok);
        return Promise.resolve({ data: bd.nombres, error: null }).then(ok);
      };
      return c;
    },
  },
}));

import { obtenerReporteCategorias, obtenerReporteCuenta } from '../src/services/reporte-wallet-service.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const rango = { desde: '2026-10-01', hasta: '2026-10-31' };
const filaMov = (id: string, extra: Fila = {}): Fila => ({
  id, tipo: 'egreso', subtipo: null, numero: null, numero_sistema: 1, monto: 10, moneda: 'USD', fecha: '2026-10-05', descripcion: 'x', referencia: '',
  banca_origen_id: U1, banca_destino_id: null, categoria_id: null, anulado: false, ...extra,
});
const filaCat = (id: string, extra: Fila = {}): Fila => ({ id, nombre: id, tipo: 'AMBOS', color: '#15803D', padre_id: null, activo: true, created_at: '2026-10-01', ...extra });

beforeEach(() => {
  bd.banca = { id: U1, nombre: 'Banesco', moneda: 'USD' };
  bd.movimientos = []; bd.categorias = []; bd.nombres = [];
  bd.errorCategorias = null; bd.errorMovimientos = null; bd.rangos = []; bd.filtros = [];
});

describe('obtenerReporteCuenta', () => {
  const filtro = { bancaId: U1, ...rango };

  it('arma el reporte de la cuenta con categoría resuelta y filtra por cuenta y fechas en la consulta', async () => {
    bd.categorias = [filaCat('c1', { nombre: 'Servicios' })];
    bd.movimientos = [filaMov('m1', { tipo: 'ingreso', monto: 100, categoria_id: 'c1' }), filaMov('m2', { monto: 30 })];
    const r = await obtenerReporteCuenta(filtro, null);
    if ('error' in r) throw new Error(r.error);
    expect(r.reporte.banca).toEqual({ id: U1, nombre: 'Banesco', moneda: 'USD' });
    expect(r.reporte.totales).toEqual({ entradas: 100, salidas: 30, neto: 70 });
    expect(r.reporte.filas[0].categoria).toEqual({ nombre: 'Servicios', color: '#15803D' });
    const f = bd.filtros.map(x => x.join('|'));
    expect(f).toContain(`movimientos.or|banca_origen_id.eq.${U1},banca_destino_id.eq.${U1}`);
    expect(f).toContain('movimientos.gte|fecha|2026-10-01');
    expect(f).toContain('movimientos.lte|fecha|2026-10-31');
  });

  it('pagina: con más de 1000 movimientos los trae todos', async () => {
    bd.movimientos = Array.from({ length: 2300 }, (_, i) => filaMov(`m${i}`, { numero_sistema: i + 1 }));
    const r = await obtenerReporteCuenta(filtro, null);
    if ('error' in r) throw new Error(r.error);
    expect(r.reporte.filas).toHaveLength(2300);
    expect(bd.rangos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('cuenta inexistente => 404; cuenta sin acceso => 403 sin devolver movimientos', async () => {
    bd.banca = null;
    expect(await obtenerReporteCuenta(filtro, null)).toMatchObject({ codigo: 404 });
    bd.banca = { id: U1, nombre: 'Banesco', moneda: 'USD' };
    bd.movimientos = [filaMov('m1')];
    const r = await obtenerReporteCuenta(filtro, new Set([U2]));
    expect(r).toMatchObject({ codigo: 403 });
    expect('reporte' in r).toBe(false);
  });

  it('404 y 403 tienen prioridad sobre un fallo al leer movimientos (la lectura corre en paralelo)', async () => {
    bd.errorMovimientos = { code: '08006', message: 'caída' };
    bd.banca = null;
    expect(await obtenerReporteCuenta(filtro, null)).toMatchObject({ codigo: 404 });
    bd.banca = { id: U1, nombre: 'Banesco', moneda: 'USD' };
    expect(await obtenerReporteCuenta(filtro, new Set([U2]))).toMatchObject({ codigo: 403 });
  });

  it('acepta las cuentas permitidas como promesa (la consulta de accesos corre a la vez)', async () => {
    bd.movimientos = [filaMov('m1')];
    const r = await obtenerReporteCuenta(filtro, Promise.resolve(new Set([U1])));
    expect('reporte' in r).toBe(true);
    expect(await obtenerReporteCuenta(filtro, Promise.resolve(new Set([U2])))).toMatchObject({ codigo: 403 });
  });

  it('sin la migración de categorías el reporte igual sale (sin categorías)', async () => {
    bd.errorCategorias = { code: '42P01', message: 'relation "categorias_wallet" does not exist' };
    bd.movimientos = [filaMov('m1', { categoria_id: 'c1' })];
    const r = await obtenerReporteCuenta(filtro, null);
    if ('error' in r) throw new Error(r.error);
    expect(r.reporte.filas[0].categoria).toBeNull();
  });

  it('un error leyendo movimientos es un fallo 500, nunca un reporte parcial', async () => {
    bd.errorMovimientos = { code: '08006', message: 'caída' };
    expect(await obtenerReporteCuenta(filtro, null)).toMatchObject({ codigo: 500 });
  });

  it('enmascara el nombre de la cuenta contraria restringida', async () => {
    bd.movimientos = [filaMov('t1', { tipo: 'transferencia', banca_destino_id: U2 })];
    bd.nombres = [{ id: U2, nombre: 'Secreta' }];
    const r = await obtenerReporteCuenta(filtro, new Set([U1]));
    if ('error' in r) throw new Error(r.error);
    expect(r.reporte.filas[0].cuentaContraria).toBe('Cuenta restringida');
  });
});

describe('obtenerReporteCategorias', () => {
  const base = { categorias: [] as string[], sinCategoria: false, ...rango };

  beforeEach(() => {
    bd.categorias = [filaCat('serv', { nombre: 'Servicios' }), filaCat('luz', { nombre: 'Luz', padre_id: 'serv' })];
  });

  it('agrupa por categoría y consulta solo ingresos/egresos vigentes con categoría', async () => {
    bd.movimientos = [filaMov('m1', { categoria_id: 'luz', monto: 30 }), filaMov('m2', { categoria_id: 'serv', tipo: 'ingreso', monto: 100 })];
    const r = await obtenerReporteCategorias(base, null);
    if ('error' in r) throw new Error(r.error);
    expect(r.reporte.grupos[0].totales).toEqual([{ moneda: 'USD', ingresos: 100, egresos: 30, total: 70 }]);
    const f = bd.filtros.map(x => x.join('|'));
    expect(f).toContain('movimientos.in|tipo|ingreso,egreso');
    expect(f).toContain('movimientos.eq|anulado|false');
    expect(f).toContain('movimientos.not|categoria_id|is|');
  });

  it('con selección pide solo esas categorías (y sus subcategorías) a la BD', async () => {
    await obtenerReporteCategorias({ ...base, categorias: ['serv'] }, null);
    const f = bd.filtros.find(x => x[0] === 'movimientos.in' && x[1] === 'categoria_id');
    expect([...(f![2] as string[])].sort()).toEqual(['luz', 'serv']);
  });

  it('con "sin categoría" no restringe por categoría en la consulta', async () => {
    await obtenerReporteCategorias({ ...base, sinCategoria: true }, null);
    const f = bd.filtros.map(x => x[0]);
    expect(f).not.toContain('movimientos.not');
  });

  it('selección que no existe => 400; sin migración => 503', async () => {
    expect(await obtenerReporteCategorias({ ...base, categorias: [U2] }, null)).toMatchObject({ codigo: 400 });
    bd.errorCategorias = { code: '42P01', message: 'relation "categorias_wallet" does not exist' };
    expect(await obtenerReporteCategorias(base, null)).toMatchObject({ codigo: 503 });
  });

  it('solo incluye cuentas permitidas e informa cuántos movimientos quedaron fuera', async () => {
    bd.movimientos = [filaMov('m1', { categoria_id: 'luz', monto: 30 }), filaMov('m2', { categoria_id: 'luz', monto: 70, banca_origen_id: U2 })];
    const r = await obtenerReporteCategorias(base, new Set([U1]));
    if ('error' in r) throw new Error(r.error);
    expect(r.reporte.totalesGenerales[0].egresos).toBe(30);
    expect(r.reporte.movimientosExcluidosPorAcceso).toBe(1);
  });

  it('error leyendo movimientos => 500', async () => {
    bd.errorMovimientos = { code: '08006', message: 'caída' };
    expect(await obtenerReporteCategorias(base, null)).toMatchObject({ codigo: 500 });
  });
});
