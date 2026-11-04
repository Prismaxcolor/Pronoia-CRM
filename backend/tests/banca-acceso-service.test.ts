import { describe, it, expect, vi, beforeEach } from 'vitest';

type Resp = { data: unknown; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({
  selects: [] as string[],
  respuestas: [] as unknown[],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  rpcRespuestas: [] as unknown[],
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: (cols: string) => {
        bd.selects.push(cols);
        return { eq: async () => bd.respuestas.shift() as Resp };
      },
    }),
    rpc: async (fn: string, args: unknown) => {
      bd.rpcs.push({ fn, args });
      return (bd.rpcRespuestas.shift() ?? { data: null, error: null }) as Resp;
    },
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { accesoBancas, bancasPermitidas, listarBancasDeUsuario, reemplazarBancasDeUsuario } from '../src/services/banca-acceso-service.js';

const colFaltante = { code: '42703', message: 'column usuarios_bancas.puede_editar does not exist' };

beforeEach(() => {
  bd.selects = [];
  bd.respuestas = [];
  bd.rpcs = [];
  bd.rpcRespuestas = [];
});

describe('accesoBancas', () => {
  it('superadmin ve y edita todo sin consultar la BD', async () => {
    const r = await accesoBancas('u', 'superadmin');
    expect(r).toEqual({ ver: null, editar: null });
    expect(bd.selects).toHaveLength(0);
  });

  it('separa ver de editar con una sola consulta', async () => {
    bd.respuestas.push({ data: [{ banca_id: 'a', puede_editar: true }, { banca_id: 'b', puede_editar: false }], error: null });
    const r = await accesoBancas('u', 'trabajador');
    expect([...(r.ver as Set<string>)]).toEqual(['a', 'b']);
    expect([...(r.editar as Set<string>)]).toEqual(['a']);
    expect(bd.selects).toEqual(['banca_id, puede_editar']);
  });

  it('sin la columna reintenta sin ella: todo lo visible es editable (comportamiento anterior)', async () => {
    bd.respuestas.push({ data: null, error: colFaltante }, { data: [{ banca_id: 'a' }], error: null });
    const r = await accesoBancas('u', 'administracion');
    expect([...(r.ver as Set<string>)]).toEqual(['a']);
    expect([...(r.editar as Set<string>)]).toEqual(['a']);
    expect(bd.selects).toEqual(['banca_id, puede_editar', 'banca_id']);
  });

  it('sin la tabla no filtra (bypass temporal previo)', async () => {
    bd.respuestas.push({ data: null, error: { code: '42P01', message: 'relation "usuarios_bancas" does not exist' } });
    expect(await accesoBancas('u', 'trabajador')).toEqual({ ver: null, editar: null });
  });

  it('otro error de BD falla cerrado: ni ve ni edita', async () => {
    bd.respuestas.push({ data: null, error: { code: 'XX000', message: 'boom' } });
    const r = await accesoBancas('u', 'trabajador');
    expect((r.ver as Set<string>).size).toBe(0);
    expect((r.editar as Set<string>).size).toBe(0);
  });

  it('si el reintento sin columna también falla, falla cerrado', async () => {
    bd.respuestas.push({ data: null, error: colFaltante }, { data: null, error: { code: 'XX000', message: 'boom' } });
    const r = await accesoBancas('u', 'trabajador');
    expect((r.ver as Set<string>).size).toBe(0);
  });

  it('bancasPermitidas devuelve solo el conjunto de ver', async () => {
    bd.respuestas.push({ data: [{ banca_id: 'a', puede_editar: false }], error: null });
    expect([...((await bancasPermitidas('u', 'trabajador')) as Set<string>)]).toEqual(['a']);
  });
});

describe('listarBancasDeUsuario', () => {
  it('devuelve ids de ver y de editar', async () => {
    bd.respuestas.push({ data: [{ banca_id: 'a', puede_editar: true }, { banca_id: 'b', puede_editar: false }], error: null });
    expect(await listarBancasDeUsuario('u')).toEqual({ bancaIds: ['a', 'b'], bancaIdsEditar: ['a'] });
  });

  it('sin la columna, todo es editable', async () => {
    bd.respuestas.push({ data: null, error: colFaltante }, { data: [{ banca_id: 'a' }], error: null });
    expect(await listarBancasDeUsuario('u')).toEqual({ bancaIds: ['a'], bancaIdsEditar: ['a'] });
  });
});

describe('reemplazarBancasDeUsuario', () => {
  it('sin lista de editar (o igual a ver) usa la función original', async () => {
    expect(await reemplazarBancasDeUsuario('u', ['a', 'b'])).toEqual({ ok: true });
    expect(await reemplazarBancasDeUsuario('u', ['a', 'b'], ['b', 'a'])).toEqual({ ok: true });
    expect(bd.rpcs.map(r => r.fn)).toEqual(['reemplazar_bancas_usuario', 'reemplazar_bancas_usuario']);
  });

  it('con solo-ver usa la función nueva con ambas listas', async () => {
    await reemplazarBancasDeUsuario('u', ['a', 'b', 'a'], ['a']);
    expect(bd.rpcs).toEqual([{
      fn: 'reemplazar_accesos_bancas_usuario',
      args: { p_usuario_id: 'u', p_banca_ids: ['a', 'b'], p_banca_ids_editar: ['a'] },
    }]);
  });

  it('ignora ids de editar que no están en ver (nunca da edición sin vista)', async () => {
    await reemplazarBancasDeUsuario('u', ['a'], ['zzz']);
    expect(bd.rpcs[0].args).toMatchObject({ p_banca_ids: ['a'], p_banca_ids_editar: [] });
  });

  it('si la función nueva no existe devuelve migración pendiente y no cae a la original', async () => {
    bd.rpcRespuestas.push({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const r = await reemplazarBancasDeUsuario('u', ['a'], []);
    expect(r).toMatchObject({ pendiente: true });
    expect(bd.rpcs).toHaveLength(1);
  });
});
