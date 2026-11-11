import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const bd = vi.hoisted(() => ({
  tablasLeidas: [] as string[],
  respuesta: { data: [{ id: 'prod-oculto-1', oculto: true }, { id: 'prod-oculto-2', oculto: true }] as unknown, error: null as { code?: string; message: string } | null },
  actual: { data: { oculto: false } as { oculto: boolean | null } | null, error: null as { message: string } | null },
  actualizar: vi.fn(),
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => ({
      select: () => ({
        eq: (_columna: string, valor: unknown) => {
          if (valor === true) {
            bd.tablasLeidas.push(tabla);
            return Promise.resolve(bd.respuesta);
          }
          return { maybeSingle: () => Promise.resolve(bd.actual) };
        },
      }),
      update: (cambios: unknown) => ({
        eq: (_c: string, id: string) => {
          bd.actualizar(tabla, cambios, id);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

import { conVisibilidadProveedores, idsProveedoresOcultos } from '../src/services/proveedor-oculto.js';
import {
  claveVisibilidadProductos, establecerProductoOculto, exigirProductoVisible, filtrarProductosOcultos,
  idsProductosOcultos, productoVisible, sinProductosOcultos,
} from '../src/services/producto-oculto.js';

beforeEach(() => {
  bd.tablasLeidas = [];
  bd.respuesta = { data: [{ id: 'prod-oculto-1', oculto: true }, { id: 'prod-oculto-2', oculto: true }], error: null };
  bd.actual = { data: { oculto: false }, error: null };
  bd.actualizar.mockReset();
});

describe('productos ocultos: contexto de la petición', () => {
  it('sin contexto (procesos internos) no oculta nada ni consulta la base', async () => {
    expect(await idsProductosOcultos()).toEqual([]);
    expect(bd.tablasLeidas).toEqual([]);
  });

  it('el superadmin ve todo y no consulta la base', async () => {
    await conVisibilidadProveedores(false, async () => {
      expect(await idsProductosOcultos()).toEqual([]);
      expect(await productoVisible('prod-oculto-1')).toBe(true);
    });
    expect(bd.tablasLeidas).toEqual([]);
  });

  it('quien no es superadmin no ve los ocultos y la lectura se hace una sola vez por petición', async () => {
    await conVisibilidadProveedores(true, async () => {
      expect(await idsProductosOcultos()).toEqual(['prod-oculto-1', 'prod-oculto-2']);
      expect(await productoVisible('prod-oculto-1')).toBe(false);
      expect(await productoVisible('otro')).toBe(true);
      expect(await productoVisible(null)).toBe(true);
    });
    expect(bd.tablasLeidas).toEqual(['productos']);
  });

  it('comparte el contexto con proveedores pero lee cada tabla por separado', async () => {
    await conVisibilidadProveedores(true, async () => {
      await idsProveedoresOcultos();
      await idsProductosOcultos();
      await idsProveedoresOcultos();
      await idsProductosOcultos();
    });
    expect(bd.tablasLeidas).toEqual(['proveedores', 'productos']);
  });

  it('si la columna aún no existe (migración sin aplicar) no oculta nada', async () => {
    bd.respuesta = { data: null, error: { code: '42703', message: 'column productos.oculto does not exist' } };
    expect(await conVisibilidadProveedores(true, () => idsProductosOcultos())).toEqual([]);
  });

  it('ante un error distinto no abre la puerta: falla', async () => {
    bd.respuesta = { data: null, error: { code: '08006', message: 'conexión caída' } };
    await expect(conVisibilidadProveedores(true, () => idsProductosOcultos())).rejects.toThrow();
  });

  it('la clave de caché separa lo que ve el superadmin de lo que ven los demás', () => {
    const clave = (ocultar: boolean) => conVisibilidadProveedores(ocultar, () => claveVisibilidadProductos());
    expect(clave(true)).not.toBe(clave(false));
    expect(claveVisibilidadProductos()).toBe(clave(false));
  });
});

describe('productos ocultos: filtros', () => {
  it('filtrarProductosOcultos quita las filas de productos ocultos y conserva las sin producto', async () => {
    const filas = [{ p: 'a' }, { p: 'prod-oculto-1' }, { p: null }, { p: 'prod-oculto-2' }];
    expect(await conVisibilidadProveedores(true, () => filtrarProductosOcultos(filas, f => f.p))).toEqual([{ p: 'a' }, { p: null }]);
    expect(await conVisibilidadProveedores(false, () => filtrarProductosOcultos(filas, f => f.p))).toHaveLength(4);
  });

  it('sinProductosOcultos solo agrega el filtro cuando hay ocultos y conserva las filas sin producto', () => {
    const consulta = { or: vi.fn(function (this: unknown) { return this; }) };
    expect(sinProductosOcultos(consulta, [])).toBe(consulta);
    expect(consulta.or).not.toHaveBeenCalled();
    sinProductosOcultos(consulta, ['a', 'b']);
    expect(consulta.or).toHaveBeenCalledWith('producto_id.is.null,producto_id.not.in.(a,b)');
    sinProductosOcultos(consulta, ['a'], 'id');
    expect(consulta.or).toHaveBeenLastCalledWith('id.is.null,id.not.in.(a)');
  });
});

describe('productos ocultos: acceso directo por id', () => {
  const llamar = async (ocultar: boolean, id: string, req: Partial<Request> = {}) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await conVisibilidadProveedores(ocultar, () => exigirProductoVisible(req as Request, res as unknown as Response, next, id));
    return { res, next };
  };

  it('responde 404 a quien no es superadmin', async () => {
    const { res, next } = await llamar(true, 'prod-oculto-1');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('deja pasar al superadmin y los productos visibles', async () => {
    expect((await llamar(false, 'prod-oculto-1')).next).toHaveBeenCalled();
    expect((await llamar(true, 'visible')).next).toHaveBeenCalled();
  });

  it('deja que requireSuperadmin decida sobre /:id/ocultar (403 y no 404 para quien no puede)', async () => {
    const { next } = await llamar(true, 'prod-oculto-1', { method: 'POST', path: '/prod-oculto-1/ocultar' });
    expect(next).toHaveBeenCalled();
  });

  it('si no puede verificar responde 503 y no deja pasar', async () => {
    bd.respuesta = { data: null, error: { code: '08006', message: 'caída' } };
    const { res, next } = await llamar(true, 'x');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('productos ocultos: establecer', () => {
  it('actualiza y devuelve el valor anterior', async () => {
    const r = await establecerProductoOculto('p1', true);
    expect(r).toEqual({ anterior: false, oculto: true });
    expect(bd.actualizar).toHaveBeenCalledWith('productos', { oculto: true }, 'p1');
  });

  it('devuelve 404 si el producto no existe y no escribe', async () => {
    bd.actual = { data: null, error: null };
    expect(await establecerProductoOculto('nada', true)).toEqual({ error: 'Producto no encontrado.', codigo: 404 });
    expect(bd.actualizar).not.toHaveBeenCalled();
  });

  it('devuelve 500 si falla la lectura', async () => {
    bd.actual = { data: null, error: { message: 'boom' } };
    expect(await establecerProductoOculto('p1', false)).toEqual({ error: 'boom', codigo: 500 });
  });
});
