import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { RespuestaSaldos, SaldoEntidad } from '../../shared/types/saldos.js';

const bd = vi.hoisted(() => ({
  lecturas: 0,
  respuesta: { data: [{ id: 'oculto-1', oculto: true }, { id: 'oculto-2', oculto: true }] as unknown, error: null as { code?: string; message: string } | null },
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => {
          bd.lecturas += 1;
          return Promise.resolve(bd.respuesta);
        },
      }),
    }),
  },
}));

import {
  conVisibilidadProveedores, contextoVisibilidadStaff, exigirProveedorVisible, filtrarOcultos, filtroSinOcultos,
  idsProveedoresOcultos, proveedorVisible, sinProveedoresOcultos, sinOcultosDeTabla,
} from '../src/services/proveedor-oculto.js';
import { excluirEntidadesDeSaldos } from '../src/services/saldos-service.js';

beforeEach(() => {
  bd.lecturas = 0;
  bd.respuesta = { data: [{ id: 'oculto-1', oculto: true }, { id: 'oculto-2', oculto: true }], error: null };
});

describe('proveedores ocultos: contexto de la petición', () => {
  it('sin contexto (procesos internos) no oculta nada ni consulta la base', async () => {
    expect(await idsProveedoresOcultos()).toEqual([]);
    expect(bd.lecturas).toBe(0);
  });

  it('el superadmin ve todo y no consulta la base', async () => {
    await conVisibilidadProveedores(false, async () => {
      expect(await idsProveedoresOcultos()).toEqual([]);
      expect(await proveedorVisible('oculto-1')).toBe(true);
    });
    expect(bd.lecturas).toBe(0);
  });

  it('un usuario que no es superadmin no ve los ocultos y la lectura se hace una sola vez por petición', async () => {
    await conVisibilidadProveedores(true, async () => {
      expect(await idsProveedoresOcultos()).toEqual(['oculto-1', 'oculto-2']);
      expect(await proveedorVisible('oculto-1')).toBe(false);
      expect(await proveedorVisible('otro')).toBe(true);
      expect(await proveedorVisible(null)).toBe(true);
    });
    expect(bd.lecturas).toBe(1);
  });

  it('cada petición vuelve a leer (un proveedor recién ocultado se aplica de inmediato)', async () => {
    await conVisibilidadProveedores(true, () => idsProveedoresOcultos());
    await conVisibilidadProveedores(true, () => idsProveedoresOcultos());
    expect(bd.lecturas).toBe(2);
  });

  it('el middleware abre el contexto según el rol del token', async () => {
    const rolOculta = async (rol: string) => {
      let ids: string[] = [];
      await new Promise<void>(fin => {
        contextoVisibilidadStaff({ user: { rol } } as unknown as Request, {} as Response, () => {
          void idsProveedoresOcultos().then(r => { ids = r; fin(); });
        });
      });
      return ids.length > 0;
    };
    expect(await rolOculta('superadmin')).toBe(false);
    expect(await rolOculta('administracion')).toBe(true);
    expect(await rolOculta('operador')).toBe(true);
  });

  it('si la columna aún no existe (migración sin aplicar) no oculta nada', async () => {
    bd.respuesta = { data: null, error: { code: '42703', message: 'column proveedores.oculto does not exist' } };
    expect(await conVisibilidadProveedores(true, () => idsProveedoresOcultos())).toEqual([]);
  });

  it('ante un error distinto no abre la puerta: falla', async () => {
    bd.respuesta = { data: null, error: { code: '08006', message: 'conexión caída' } };
    await expect(conVisibilidadProveedores(true, () => idsProveedoresOcultos())).rejects.toThrow();
  });
});

describe('proveedores ocultos: filtros', () => {
  it('filtrarOcultos quita las filas de proveedores ocultos y conserva las sin proveedor', async () => {
    const filas = [{ p: 'a' }, { p: 'oculto-1' }, { p: null }, { p: 'oculto-2' }];
    const r = await conVisibilidadProveedores(true, () => filtrarOcultos(filas, f => f.p));
    expect(r).toEqual([{ p: 'a' }, { p: null }]);
    expect(await conVisibilidadProveedores(false, () => filtrarOcultos(filas, f => f.p))).toHaveLength(4);
  });

  it('sinOcultosDeTabla solo filtra la tabla de proveedores', async () => {
    const filas = [{ id: 'oculto-1' }, { id: 'x' }];
    expect(await conVisibilidadProveedores(true, () => sinOcultosDeTabla('proveedores', filas))).toEqual([{ id: 'x' }]);
    expect(await conVisibilidadProveedores(true, () => sinOcultosDeTabla('clientes', filas))).toHaveLength(2);
  });

  it('el filtro PostgREST conserva las filas sin proveedor (NULL NOT IN descartaría todo)', () => {
    expect(filtroSinOcultos('proveedor_id', ['a', 'b'])).toBe('proveedor_id.is.null,proveedor_id.not.in.(a,b)');
    expect(filtroSinOcultos('entidad_id', ['a'], 'tipo.neq.compra')).toBe('tipo.neq.compra,entidad_id.is.null,entidad_id.not.in.(a)');
  });

  it('sinProveedoresOcultos solo agrega el filtro cuando hay ocultos', () => {
    const consulta = { or: vi.fn(function (this: unknown) { return this; }) };
    expect(sinProveedoresOcultos(consulta, [], 'proveedor_id')).toBe(consulta);
    expect(consulta.or).not.toHaveBeenCalled();
    sinProveedoresOcultos(consulta, ['a'], 'proveedor_id');
    expect(consulta.or).toHaveBeenCalledWith('proveedor_id.is.null,proveedor_id.not.in.(a)');
  });
});

describe('proveedores ocultos: acceso directo por id', () => {
  const llamar = async (ocultar: boolean, id: string) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await conVisibilidadProveedores(ocultar, () => exigirProveedorVisible({} as Request, res as unknown as Response, next, id));
    return { res, next };
  };

  it('responde 404 a quien no es superadmin', async () => {
    const { res, next } = await llamar(true, 'oculto-1');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('deja pasar al superadmin y los proveedores visibles', async () => {
    expect((await llamar(false, 'oculto-1')).next).toHaveBeenCalled();
    expect((await llamar(true, 'visible')).next).toHaveBeenCalled();
  });

  it('si no puede verificar responde 503 y no deja pasar', async () => {
    bd.respuesta = { data: null, error: { code: '08006', message: 'caída' } };
    const { res, next } = await llamar(true, 'x');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('proveedores ocultos: saldos', () => {
  const saldo = (id: string, s: number): SaldoEntidad => ({
    entidadId: id, nombre: id, activo: true, facturado: s, pagado: 0, saldo: s, adelantado: 0, adelantoDisponible: 0,
    notasCreditoDisponibles: 0, ultimaOperacion: null, cantidadFacturasPendientes: 1, antiguedadMasVieja: 0,
  });
  const respuesta = { tipo: 'proveedor', saldos: [saldo('a', 100), saldo('oculto-1', 500)], totales: {}, calculadoEn: 'x' } as unknown as RespuestaSaldos;

  it('quita al oculto y recalcula los totales (por pagar no incluye su deuda)', () => {
    const r = excluirEntidadesDeSaldos(respuesta, ['oculto-1']);
    expect(r.saldos.map(s => s.entidadId)).toEqual(['a']);
    expect(r.totales.saldo).toBe(100);
    expect(r.totales.porPagar).toBe(100);
  });

  it('sin ocultos devuelve la respuesta tal cual', () => {
    expect(excluirEntidadesDeSaldos(respuesta, [])).toBe(respuesta);
  });
});
