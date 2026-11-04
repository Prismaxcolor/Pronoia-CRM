import { describe, it, expect, vi, beforeEach } from 'vitest';

type Resp = { data: Array<{ banca_id: string }> | null; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({
  resp: { data: [], error: null } as Resp,
  tablas: [] as string[],
  escrituras: [] as Array<{ op: string; valores?: unknown }>,
  rpcs: [] as Array<{ nombre: string; args: unknown }>,
  rpcResp: { error: null } as { error: { code?: string; message: string } | null },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (nombre: string, args: unknown) => { bd.rpcs.push({ nombre, args }); return Promise.resolve(bd.rpcResp); },
    from: (tabla: string) => {
      bd.tablas.push(tabla);
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.or = () => c;
      c.delete = () => { bd.escrituras.push({ op: 'delete' }); return c; };
      c.insert = (v: unknown) => { bd.escrituras.push({ op: 'insert', valores: v }); return c; };
      c.then = (ok: (r: Resp) => unknown) => Promise.resolve(bd.resp).then(ok);
      return c;
    },
  },
}));

import {
  veTodasLasBancas,
  bancaPermitida,
  bancasNoPermitidas,
  filtrarBancas,
  filtrarMovimientos,
  idsBancasDeBody,
} from '../src/utils/banca-acceso.js';
import {
  bancasPermitidas,
  concederBancaAUsuario,
  reemplazarBancasDeUsuario,
  idsBancasDeMovimiento,
  idsBancasDeGrupo,
  ErrorConsultaBanca,
} from '../src/services/banca-acceso-service.js';
import { logger } from '../src/utils/logger.js';

beforeEach(() => {
  bd.resp = { data: [], error: null };
  bd.tablas = [];
  bd.escrituras = [];
  bd.rpcs = [];
  bd.rpcResp = { error: null };
  vi.mocked(logger.warn).mockClear();
});

describe('reglas puras de acceso a bancas', () => {
  it('solo superadmin ve todas; administracion y trabajador no', () => {
    expect(veTodasLasBancas('superadmin')).toBe(true);
    expect(veTodasLasBancas('administracion')).toBe(false);
    expect(veTodasLasBancas('trabajador')).toBe(false);
  });

  it('null significa todas las bancas', () => {
    expect(bancaPermitida(null, 'x')).toBe(true);
    expect(bancasNoPermitidas(null, ['a', 'b'])).toEqual([]);
  });

  it('un conjunto vacio no permite ninguna', () => {
    expect(bancaPermitida(new Set(), 'a')).toBe(false);
  });

  it('bancasNoPermitidas ignora vacios y duplicados', () => {
    const p = new Set(['a']);
    expect(bancasNoPermitidas(p, ['a', null, undefined, 'b', 'b'])).toEqual(['b']);
  });

  it('filtrarBancas deja solo las permitidas sin mutar la lista', () => {
    const lista = [{ id: 'a' }, { id: 'b' }];
    expect(filtrarBancas(lista, new Set(['b']))).toEqual([{ id: 'b' }]);
    expect(lista).toHaveLength(2);
    expect(filtrarBancas(lista, null)).toBe(lista);
  });

  it('un movimiento es visible si alguna de sus bancas (origen o destino) es permitida', () => {
    const movs = [
      { bancaOrigenId: 'a', bancaDestinoId: null },
      { bancaOrigenId: 'x', bancaDestinoId: 'a' },
      { bancaOrigenId: 'x', bancaDestinoId: 'y' },
    ];
    expect(filtrarMovimientos(movs, new Set(['a']))).toEqual(movs.slice(0, 2));
  });
});

describe('idsBancasDeBody', () => {
  it('junta bancaId, bancaDestinoId y bancas[] de cualquier body de dinero', () => {
    expect(idsBancasDeBody({ bancaId: 'a', bancaDestinoId: 'b', bancas: [{ bancaId: 'c' }, { bancaId: 'a' }] }))
      .toEqual(['a', 'b', 'c']);
  });
  it('tolera bodies sin bancas o con basura', () => {
    expect(idsBancasDeBody(undefined)).toEqual([]);
    expect(idsBancasDeBody({ bancas: 'x', bancaId: 5 })).toEqual([]);
  });
});

describe('bancasPermitidas (servicio)', () => {
  it('superadmin no consulta la BD y recibe null', async () => {
    expect(await bancasPermitidas('u1', 'superadmin')).toBeNull();
    expect(bd.tablas).toEqual([]);
  });

  it('administracion con filas ve solo sus bancas', async () => {
    bd.resp = { data: [{ banca_id: 'a' }], error: null };
    const r = await bancasPermitidas('u1', 'administracion');
    expect([...(r ?? [])]).toEqual(['a']);
    expect(bd.tablas).toEqual(['usuarios_bancas']);
  });

  it('administracion sin filas no ve ninguna', async () => {
    const r = await bancasPermitidas('u1', 'administracion');
    expect(r?.size).toBe(0);
  });

  it('trabajador recibe el conjunto de sus bancas', async () => {
    bd.resp = { data: [{ banca_id: 'a' }, { banca_id: 'b' }], error: null };
    const r = await bancasPermitidas('u1', 'trabajador');
    expect([...(r ?? [])]).toEqual(['a', 'b']);
  });

  it('trabajador sin filas no ve ninguna', async () => {
    const r = await bancasPermitidas('u1', 'trabajador');
    expect(r?.size).toBe(0);
  });

  it('tabla inexistente (migracion pendiente) no filtra', async () => {
    bd.resp = { data: null, error: { code: '42P01', message: 'relation "usuarios_bancas" does not exist' } };
    expect(await bancasPermitidas('u1', 'trabajador')).toBeNull();
  });

  it('otro error de BD falla cerrado: ninguna banca', async () => {
    bd.resp = { data: null, error: { code: '08006', message: 'conexion caida' } };
    const r = await bancasPermitidas('u1', 'trabajador');
    expect(r?.size).toBe(0);
  });
});

describe('reemplazarBancasDeUsuario (RPC transaccional)', () => {
  it('llama a la RPC con ids sin duplicados', async () => {
    expect(await reemplazarBancasDeUsuario('u1', ['a', 'a', 'b'])).toEqual({ ok: true });
    expect(bd.rpcs).toEqual([{ nombre: 'reemplazar_bancas_usuario', args: { p_usuario_id: 'u1', p_banca_ids: ['a', 'b'] } }]);
    expect(bd.escrituras).toEqual([]);
  });

  it('si la funcion no existe devuelve mensaje de migracion pendiente', async () => {
    bd.rpcResp = { error: { code: '42883', message: 'function reemplazar_bancas_usuario does not exist' } };
    const r = await reemplazarBancasDeUsuario('u1', ['a']);
    expect(r).toMatchObject({ pendiente: true });
    expect('error' in r && r.error).toContain('migration_usuarios_bancas.sql');
  });

  it('otro error devuelve mensaje generico sin filtrar el crudo', async () => {
    bd.rpcResp = { error: { code: '23503', message: 'violates foreign key constraint secreto' } };
    const r = await reemplazarBancasDeUsuario('u1', ['a']);
    expect(JSON.stringify(r)).not.toContain('secreto');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('idsBancasDeMovimiento / idsBancasDeGrupo fallan cerrado', () => {
  it('error de BD lanza ErrorConsultaBanca (no devuelve [])', async () => {
    bd.resp = { data: null, error: { code: '08006', message: 'caida' } } as never;
    await expect(idsBancasDeMovimiento('m1')).rejects.toBeInstanceOf(ErrorConsultaBanca);
    await expect(idsBancasDeGrupo('g1')).rejects.toBeInstanceOf(ErrorConsultaBanca);
  });

  it('movimiento inexistente devuelve []', async () => {
    bd.resp = { data: [], error: null } as never;
    expect(await idsBancasDeMovimiento('m1')).toEqual([]);
  });

  it('junta origen y destino sin repetidos', async () => {
    bd.resp = { data: [{ banca_origen_id: 'a', banca_destino_id: 'b' }, { banca_origen_id: 'a', banca_destino_id: null }], error: null } as never;
    expect(await idsBancasDeGrupo('g1')).toEqual(['a', 'b']);
  });
});

describe('concederBancaAUsuario', () => {
  it('un error distinto de tabla inexistente se devuelve', async () => {
    bd.resp = { data: null, error: { code: '23503', message: 'fk' } };
    expect(await concederBancaAUsuario('u1', 'b9')).toEqual({ error: 'fk' });
  });
  it('inserta la fila usuario-banca', async () => {
    expect(await concederBancaAUsuario('u1', 'b9')).toEqual({ ok: true });
    expect(bd.escrituras).toEqual([{ op: 'insert', valores: { usuario_id: 'u1', banca_id: 'b9' } }]);
  });
  it('si la tabla no existe (migración pendiente) no falla', async () => {
    bd.resp = { data: null, error: { code: '42P01', message: 'relation "usuarios_bancas" does not exist' } };
    expect(await concederBancaAUsuario('u1', 'b9')).toEqual({ ok: true });
  });
});
