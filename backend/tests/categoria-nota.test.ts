import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Categoría en notas de crédito/débito de proveedor y cliente: reglas puras, esquemas y servicios con
 * supabase mockeado (nunca se toca la BD real). La categoría solo se guarda y se muestra en la nota.
 */

type Fila = Record<string, unknown>;
type ErrorBd = { code?: string; message: string };
type Resp = { data: unknown; error: ErrorBd | null };
interface Llamada { tabla: string; op: string; valores?: Fila; columnas?: string; filtros: Array<[string, unknown]> }

const bd = vi.hoisted(() => ({
  categorias: [] as Array<Record<string, unknown>>,
  nota: null as Record<string, unknown> | null,
  /** Error al leer la nota cuando el select incluye categoria_id (columna inexistente). */
  errorLecturaConCategoria: null as { code?: string; message: string } | null,
  errorInsert: null as { code?: string; message: string } | null,
  errorUpdate: null as { code?: string; message: string } | null,
  /** Filas que devuelve el UPDATE (vacío = la nota se anuló entre la lectura y la escritura). */
  filasActualizadas: [{ id: 'n1' }] as Array<{ id: string }>,
  llamadas: [] as Array<{ tabla: string; op: string; valores?: Record<string, unknown>; columnas?: string; filtros: Array<[string, unknown]> }>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const llamada: Llamada = { tabla, op: 'select', filtros: [] };
      const resolver = (): Resp => {
        bd.llamadas.push(llamada);
        if (llamada.op === 'insert') {
          if (bd.errorInsert) return { data: null, error: bd.errorInsert };
          return { data: { id: 'nota-nueva', tipo: llamada.valores?.tipo, numero: 7 }, error: null };
        }
        if (llamada.op === 'update') return { data: bd.errorUpdate ? null : bd.filasActualizadas, error: bd.errorUpdate };
        if (tabla === 'categorias_wallet') return { data: bd.categorias, error: null };
        if (tabla.startsWith('notas_ajuste')) {
          if (bd.errorLecturaConCategoria && llamada.columnas?.includes('categoria_id')) return { data: null, error: bd.errorLecturaConCategoria };
          return { data: bd.nota, error: null };
        }
        return { data: null, error: null };
      };
      const c: Record<string, unknown> = {};
      c.select = (columnas?: string) => { llamada.columnas = columnas; return c; };
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
vi.mock('../src/services/telegram-eventos-service.js', () => ({ notificarNota: vi.fn() }));

import { categoriaParaMostrar, validarCategoriaParaNota } from '../src/utils/categoria-nota.js';
import { actualizarCategoriaNotaSchema, crearNotaAjusteSchema } from '../src/schemas/notas-ajuste.js';
import { asignarCategoriaNota, categoriasParaNotas, leerConCategoria } from '../src/services/categoria-nota-service.js';
import { crearNotaAjuste, obtenerNotaAjuste } from '../src/services/nota-ajuste-service.js';
import { crearNotaAjusteCliente, obtenerNotaAjusteCliente } from '../src/services/nota-ajuste-cliente-service.js';
import { generarNotaPdf } from '../src/services/document-generator-financiero.js';

const UUID_CAT = '11111111-1111-4111-8111-111111111111';
const UUID_HIJA = '22222222-2222-4222-8222-222222222222';
const UUID_ARCH = '33333333-3333-4333-8333-333333333333';

const fila = (id: string, extra: Fila = {}): Fila =>
  ({ id, nombre: id, tipo: 'EGRESO', color: '#DC2626', padre_id: null, activo: true, created_at: '2026-10-01T00:00:00Z', ...extra });
const escrituras = () => bd.llamadas.filter(l => l.op !== 'select');

beforeEach(() => {
  bd.categorias = [
    fila(UUID_CAT, { nombre: 'Servicios', tipo: 'EGRESO', imagen_url: 'https://x.test/s.png' }),
    fila(UUID_HIJA, { nombre: 'Luz', tipo: 'INGRESO', padre_id: UUID_CAT }),
    fila(UUID_ARCH, { nombre: 'Vieja', activo: false }),
  ];
  bd.nota = null; bd.errorLecturaConCategoria = null; bd.errorInsert = null; bd.errorUpdate = null; bd.filasActualizadas = [{ id: 'n1' }]; bd.llamadas = [];
});

const catFila = (id: string, extra: Partial<{ activo: boolean; padreId: string | null; tipo: 'INGRESO' | 'EGRESO' | 'AMBOS' }> = {}) =>
  ({ id, nombre: id, tipo: 'EGRESO' as const, color: '#112233', padreId: null, activo: true, ...extra });

describe('validarCategoriaParaNota', () => {
  it('acepta sin categoría', () => {
    expect(validarCategoriaParaNota(null, [])).toBeNull();
    expect(validarCategoriaParaNota(undefined, [])).toBeNull();
  });
  it('rechaza una categoría que no existe', () => {
    expect(validarCategoriaParaNota('x', [catFila('a')])).toMatch(/no existe/);
  });
  it('rechaza una categoría archivada o con padre archivado', () => {
    expect(validarCategoriaParaNota('a', [catFila('a', { activo: false })])).toMatch(/archivada/);
    expect(validarCategoriaParaNota('h', [catFila('p', { activo: false }), catFila('h', { padreId: 'p' })])).toMatch(/archivada/);
  });
  it('acepta cualquier tipo, raíz o subcategoría', () => {
    const todas = [catFila('p', { tipo: 'INGRESO' }), catFila('h', { padreId: 'p', tipo: 'INGRESO' }), catFila('e', { tipo: 'EGRESO' })];
    for (const id of ['p', 'h', 'e']) expect(validarCategoriaParaNota(id, todas)).toBeNull();
  });
});

describe('categoriaParaMostrar', () => {
  it('arma el nombre completo con color e imagen', () => {
    const lista = [{ ...catFila('p'), nombre: 'Servicios', imagenUrl: 'https://x.test/i.png' }, { ...catFila('h', { padreId: 'p' }), nombre: 'Luz' }];
    expect(categoriaParaMostrar('h', lista)).toEqual({ id: 'h', nombre: 'Servicios › Luz', color: '#112233', imagenUrl: null });
    expect(categoriaParaMostrar('p', lista)?.imagenUrl).toBe('https://x.test/i.png');
  });
  it('muestra una categoría archivada después de usarse; null si falta o no hay id', () => {
    expect(categoriaParaMostrar('a', [catFila('a', { activo: false })])?.nombre).toBe('a');
    expect(categoriaParaMostrar('x', [])).toBeNull();
    expect(categoriaParaMostrar(null, [catFila('a')])).toBeNull();
  });
});

describe('esquemas de notas con categoría', () => {
  const base = { tipo: 'debito', monto: 10, motivo: 'Flete' };
  it('categoriaId es opcional y admite null', () => {
    expect(crearNotaAjusteSchema.safeParse(base).success).toBe(true);
    expect(crearNotaAjusteSchema.safeParse({ ...base, categoriaId: null }).success).toBe(true);
    expect(crearNotaAjusteSchema.safeParse({ ...base, categoriaId: UUID_CAT }).success).toBe(true);
  });
  it('rechaza una categoría que no es uuid', () => {
    expect(crearNotaAjusteSchema.safeParse({ ...base, categoriaId: 'abc' }).success).toBe(false);
  });
  it('actualizarCategoriaNotaSchema exige la clave (uuid o null)', () => {
    expect(actualizarCategoriaNotaSchema.safeParse({}).success).toBe(false);
    expect(actualizarCategoriaNotaSchema.safeParse({ categoriaId: null }).success).toBe(true);
    expect(actualizarCategoriaNotaSchema.safeParse({ categoriaId: UUID_CAT }).success).toBe(true);
    expect(actualizarCategoriaNotaSchema.safeParse({ categoriaId: 'x' }).success).toBe(false);
  });
});

describe.each([
  { nombre: 'proveedor', crear: crearNotaAjuste, obtener: obtenerNotaAjuste, col: 'proveedor_id' },
  { nombre: 'cliente', crear: crearNotaAjusteCliente, obtener: obtenerNotaAjusteCliente, col: 'cliente_id' },
])('crear y leer nota de $nombre con categoría', ({ crear, obtener, col }) => {
  const input = { tipo: 'debito' as const, monto: 25, motivo: 'Flete' };
  const notaBase = (extra: Fila = {}): Fila => ({
    id: 'n1', [col]: 'ent-1', tipo: 'credito', monto: 5, motivo: 'm', anulada: false, pagada: false, numero: 1,
    fecha: '2026-10-01', registrado_por: null, anula_nota_id: null, factura_id: null, ...extra,
  });

  it('guarda categoria_id cuando la categoría es válida (también una subcategoría de otro tipo)', async () => {
    const r = await crear('ent-1', { ...input, categoriaId: UUID_HIJA }, 'user-1');
    expect(r).toMatchObject({ id: 'nota-nueva' });
    expect(escrituras()[0].valores).toMatchObject({ categoria_id: UUID_HIJA, [col]: 'ent-1' });
  });

  it('sin categoría no manda la columna ni consulta las categorías', async () => {
    await crear('ent-1', input, 'user-1');
    expect(escrituras()[0].valores).not.toHaveProperty('categoria_id');
    expect(bd.llamadas.some(l => l.tabla === 'categorias_wallet')).toBe(false);
  });

  it('rechaza una categoría archivada o inexistente sin insertar', async () => {
    const archivada = await crear('ent-1', { ...input, categoriaId: UUID_ARCH }, 'user-1');
    const inexistente = await crear('ent-1', { ...input, categoriaId: '44444444-4444-4444-8444-444444444444' }, 'user-1');
    expect(archivada).toEqual({ error: expect.stringMatching(/archivada/) });
    expect(inexistente).toEqual({ error: expect.stringMatching(/no existe/) });
    expect(escrituras()).toHaveLength(0);
  });

  it('avisa de la migración pendiente si la columna no existe y se pidió categoría', async () => {
    bd.errorInsert = { code: '42703', message: 'column "categoria_id" of relation does not exist' };
    const r = await crear('ent-1', { ...input, categoriaId: UUID_CAT }, 'user-1');
    expect(r).toEqual({ error: expect.stringMatching(/migration_notas_categoria\.sql/) });
  });

  it('el detalle devuelve la categoría con nombre, color e imagen', async () => {
    bd.nota = notaBase({ categoria_id: UUID_CAT });
    const r = await obtener('ent-1', 'n1');
    expect(r).toMatchObject({ categoria: { id: UUID_CAT, nombre: 'Servicios', color: '#DC2626', imagenUrl: 'https://x.test/s.png' } });
  });

  it('el detalle sin categoría devuelve null y no consulta categorías', async () => {
    bd.nota = notaBase({ categoria_id: null });
    const r = await obtener('ent-1', 'n1');
    expect(r).toMatchObject({ categoria: null });
    expect(bd.llamadas.some(l => l.tabla === 'categorias_wallet')).toBe(false);
  });

  it('el detalle se lee igual si la columna aún no existe (reintenta sin categoria_id)', async () => {
    bd.errorLecturaConCategoria = { code: '42703', message: 'column notas.categoria_id does not exist' };
    bd.nota = notaBase();
    const r = await obtener('ent-1', 'n1');
    expect(r).toMatchObject({ id: 'n1', categoria: null });
  });
});

describe('leerConCategoria', () => {
  it('no reintenta ante un error que no es de columna inexistente', async () => {
    const consulta = vi.fn().mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    const r = await leerConCategoria(consulta, 'id');
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(r.error).not.toBeNull();
  });
});

describe('categoriasParaNotas', () => {
  it('sin ids no consulta la BD', async () => {
    expect((await categoriasParaNotas([null, undefined])).size).toBe(0);
    expect(bd.llamadas).toHaveLength(0);
  });
  it('resuelve cada id con una sola lectura', async () => {
    const m = await categoriasParaNotas([UUID_CAT, UUID_CAT, UUID_HIJA, null]);
    expect(m.get(UUID_HIJA)?.nombre).toBe('Servicios › Luz');
    expect(bd.llamadas.filter(l => l.tabla === 'categorias_wallet')).toHaveLength(1);
  });
});

describe('asignarCategoriaNota', () => {
  const asignar = (categoriaId: string | null) => asignarCategoriaNota('notas_ajuste_proveedor', 'proveedor_id', 'prov-1', 'n1', categoriaId);

  it('404 si la nota no es de esa entidad', async () => {
    expect(await asignar(UUID_CAT)).toMatchObject({ codigo: 404 });
    expect(escrituras()).toHaveLength(0);
  });
  it('409 si la nota está anulada', async () => {
    bd.nota = { id: 'n1', anulada: true };
    expect(await asignar(UUID_CAT)).toMatchObject({ codigo: 409 });
    expect(escrituras()).toHaveLength(0);
  });
  it('400 si la categoría está archivada', async () => {
    bd.nota = { id: 'n1', anulada: false };
    expect(await asignar(UUID_ARCH)).toMatchObject({ codigo: 400 });
    expect(escrituras()).toHaveLength(0);
  });
  it('actualiza solo categoria_id (sin tocar montos) y permite quitarla con null', async () => {
    bd.nota = { id: 'n1', anulada: false };
    expect(await asignar(UUID_CAT)).toEqual({ ok: true, anterior: null });
    expect(escrituras()[0].valores).toEqual({ categoria_id: UUID_CAT });
    expect(await asignar(null)).toEqual({ ok: true, anterior: null });
    expect(escrituras()[1].valores).toEqual({ categoria_id: null });
  });
  it('el UPDATE exige anulada = false y, si una anulación se cuela, responde 409', async () => {
    bd.nota = { id: 'n1', anulada: false };
    bd.filasActualizadas = [];
    expect(await asignar(UUID_CAT)).toEqual({ error: 'La nota está anulada.', codigo: 409 });
    expect(escrituras()[0].filtros).toContainEqual(['anulada', false]);
  });
  it('503 con el nombre de la migración si la columna no existe', async () => {
    bd.nota = { id: 'n1', anulada: false };
    bd.errorUpdate = { code: '42703', message: 'column "categoria_id" does not exist' };
    expect(await asignar(UUID_CAT)).toMatchObject({ codigo: 503, error: expect.stringMatching(/migration_notas_categoria\.sql/) });
  });
});

describe('PDF de la nota (Telegram)', () => {
  const nota = { id: 'n1', codigo: 'ND-0001', tipo: 'debito' as const, monto: 10, motivo: 'm', anulada: false, fecha: '2026-10-01', anuladaAt: null, anuladaMotivo: null, facturaAsociada: null };
  it('genera el PDF con y sin categoría', () => {
    expect(generarNotaPdf({ ...nota, categoria: { nombre: 'Servicios › Luz' } }, 'Prov', true).length).toBeGreaterThan(500);
    expect(generarNotaPdf(nota, 'Prov', true).length).toBeGreaterThan(500);
  });
});
