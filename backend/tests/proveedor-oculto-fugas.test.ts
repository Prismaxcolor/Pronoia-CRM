import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

/**
 * Proveedores ocultos: las vías por las que podía filtrarse un proveedor oculto a quien no es superadmin
 * (reportes de la wallet, avisos del grupo de Telegram, historial de auditoría, pagos/tickets/movimientos por id).
 */

interface TablaFalsa { filas?: unknown[]; error?: { code?: string; message: string } | null }
const tablas: Record<string, TablaFalsa> = {};
const llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];
const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('../src/utils/logger.js', () => ({ logger: log, clienteIp: () => '127.0.0.1' }));
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const cfg = (): TablaFalsa => tablas[tabla] ?? { filas: [] };
      const respuesta = () => ({ data: cfg().error ? null : cfg().filas ?? [], error: cfg().error ?? null });
      const b: Record<string, unknown> = {
        maybeSingle: async () => ({ data: cfg().filas?.[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(respuesta()).then(ok, ko),
      };
      for (const metodo of ['select', 'eq', 'or', 'not', 'in', 'gte', 'lte', 'lt', 'order', 'range', 'limit', 'neq']) {
        b[metodo] = (...args: unknown[]) => { llamadas.push({ tabla, metodo, args }); return b; };
      }
      return b;
    },
  },
}));
vi.mock('../src/services/categoria-service.js', () => ({
  listarCategorias: async () => ({ categorias: [] }),
  MENSAJE_CATEGORIAS_PENDIENTE: 'pendiente',
}));

import { conVisibilidadProveedores, exigirProveedorVisible, leerIdsOcultos } from '../src/services/proveedor-oculto.js';
import { documentoVisible, exigirDocumentoVisible, exigirProveedorDelBodyVisible } from '../src/services/proveedor-documento.js';
import { eventoTocaProveedorOculto } from '../src/services/grupo-silencio-service.js';
import { obtenerReporteCategorias, obtenerReporteCuenta } from '../src/services/reporte-wallet-service.js';
import type { ContextoEvento, EventoCatalogo } from '../src/services/grupo-eventos.js';

const OCULTO = '11111111-1111-4111-8111-111111111111';
const VISIBLE = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const FILTRO_OCULTO = `proveedor_id.not.in.(${OCULTO})`;

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  llamadas.length = 0;
  vi.clearAllMocks();
  tablas.proveedores = { filas: [{ id: OCULTO, oculto: true }] };
});

const orsDe = (tabla: string): string[] =>
  llamadas.filter(l => l.tabla === tabla && l.metodo === 'or').map(l => String(l.args[0]));

describe('C1: reportes de la wallet', () => {
  const filtroCuenta = { bancaId: DOC, desde: '2026-10-01', hasta: '2026-10-31' };

  it('el reporte por cuenta excluye los movimientos de proveedores ocultos (filas y saldo inicial) para un usuario normal', async () => {
    await conVisibilidadProveedores(true, () => obtenerReporteCuenta(filtroCuenta, null));
    expect(orsDe('movimientos').filter(f => f.includes(FILTRO_OCULTO))).toHaveLength(2);
  });

  it('el reporte por categorías excluye los movimientos de proveedores ocultos', async () => {
    await conVisibilidadProveedores(true, () => obtenerReporteCategorias({ desde: '2026-10-01', hasta: '2026-10-31', sinCategoria: true, categorias: [] } as never, null));
    expect(orsDe('movimientos').some(f => f.includes(FILTRO_OCULTO))).toBe(true);
  });

  it('el superadmin ve todo: ningún filtro de ocultos', async () => {
    await conVisibilidadProveedores(false, () => obtenerReporteCuenta(filtroCuenta, null));
    await conVisibilidadProveedores(false, () => obtenerReporteCategorias({ desde: '2026-10-01', hasta: '2026-10-31', sinCategoria: true, categorias: [] } as never, null));
    expect(orsDe('movimientos').some(f => f.includes('proveedor_id.not.in'))).toBe(false);
  });
});

describe('H1: avisos del grupo de Telegram', () => {
  const evento = { clave: 'pago.registrado', categoria: 'tesoreria', importancia: 'critica' } as unknown as EventoCatalogo;
  const ctx = (reqBody: unknown, resBody: unknown = {}, params: Record<string, string> = {}): ContextoEvento =>
    ({ metodo: 'POST', ruta: '/api/pagos', params, reqBody, resBody, extra: {} }) as unknown as ContextoEvento;

  it('no se avisa si el body nombra a un proveedor oculto', async () => {
    expect(await eventoTocaProveedorOculto(evento, ctx({ proveedorId: OCULTO, monto: 5 }))).toBe(true);
  });

  it('no se avisa si la respuesta o la ruta lo nombran', async () => {
    expect(await eventoTocaProveedorOculto(evento, ctx({}, { factura: { entidadId: OCULTO } }))).toBe(true);
    expect(await eventoTocaProveedorOculto(evento, ctx({}, {}, { id: OCULTO }))).toBe(true);
  });

  it('no se avisa si los movimientos del documento en BD son del proveedor oculto', async () => {
    const porGrupo = { ...evento, clave: 'pago.anulado' } as EventoCatalogo;
    tablas.movimientos = { filas: [{ banca_origen_id: 'b1', banca_destino_id: null, proveedor_id: OCULTO, cliente_id: null }] };
    expect(await eventoTocaProveedorOculto(porGrupo, ctx({ motivo: 'x' }, {}, { grupoId: DOC }))).toBe(true);
  });

  it('se avisa normal con un proveedor visible o sin proveedores ocultos', async () => {
    expect(await eventoTocaProveedorOculto(evento, ctx({ proveedorId: VISIBLE }))).toBe(false);
    tablas.proveedores = { filas: [] };
    expect(await eventoTocaProveedorOculto(evento, ctx({ proveedorId: OCULTO }))).toBe(false);
  });

  it('si no puede saber cuáles están ocultos, no avisa (falla cerrado)', async () => {
    tablas.proveedores = { error: { code: '08006', message: 'caída' } };
    expect(await eventoTocaProveedorOculto(evento, ctx({ proveedorId: VISIBLE }))).toBe(true);
  });
});

describe('H2 / H3: documentos por id de un proveedor oculto', () => {
  it('ticket de compra de un proveedor oculto: no visible; el de venta con el mismo id sí', async () => {
    tablas.tickets_pesaje = { filas: [{ tipo: 'compra', entidad_id: OCULTO }] };
    expect(await conVisibilidadProveedores(true, () => documentoVisible('ticket_pesaje', DOC))).toBe(false);
    tablas.tickets_pesaje = { filas: [{ tipo: 'venta', entidad_id: OCULTO }] };
    expect(await conVisibilidadProveedores(true, () => documentoVisible('ticket_pesaje', DOC))).toBe(true);
  });

  it('factura de compra, nota y movimiento de un proveedor oculto: no visibles', async () => {
    tablas.facturas_compra = { filas: [{ proveedor_id: OCULTO }] };
    tablas.notas_ajuste_proveedor = { filas: [{ proveedor_id: OCULTO }] };
    tablas.movimientos = { filas: [{ proveedor_id: OCULTO }] };
    for (const tipo of ['factura_compra', 'nota_ajuste_proveedor', 'movimiento_banca', 'pago']) {
      expect(await conVisibilidadProveedores(true, () => documentoVisible(tipo, DOC))).toBe(false);
    }
  });

  it('un pago que es un cruce (sin movimientos) se resuelve por la tabla cruces', async () => {
    tablas.cruces = { filas: [{ proveedor_id: OCULTO }] };
    expect(await conVisibilidadProveedores(true, () => documentoVisible('pago', DOC))).toBe(false);
  });

  it('el proveedor mismo oculto no es visible; uno visible sí; el superadmin ve todo sin consultar', async () => {
    expect(await conVisibilidadProveedores(true, () => documentoVisible('proveedor', OCULTO))).toBe(false);
    expect(await conVisibilidadProveedores(true, () => documentoVisible('proveedor', VISIBLE))).toBe(true);
    llamadas.length = 0;
    expect(await conVisibilidadProveedores(false, () => documentoVisible('proveedor', OCULTO))).toBe(true);
    expect(llamadas).toHaveLength(0);
  });

  it('tipos sin proveedor (cobro, lote...) y ids inválidos se dejan pasar al handler', async () => {
    expect(await conVisibilidadProveedores(true, () => documentoVisible('lote', DOC))).toBe(true);
    expect(await conVisibilidadProveedores(true, () => documentoVisible('pago', 'no-uuid'))).toBe(true);
  });

  const ejecutar = async (mw: ReturnType<typeof exigirDocumentoVisible>, req: Partial<Request>, ocultar: boolean) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await conVisibilidadProveedores(ocultar, async () => { await mw(req as Request, res as unknown as Response, next); });
    return { res, next };
  };

  it('middleware por id: 404 a un usuario normal, pasa al superadmin', async () => {
    tablas.tickets_pesaje = { filas: [{ tipo: 'compra', entidad_id: OCULTO }] };
    const mw = exigirDocumentoVisible('ticket_pesaje');
    const normal = await ejecutar(mw, { params: { id: DOC } }, true);
    expect(normal.res.status).toHaveBeenCalledWith(404);
    expect(normal.next).not.toHaveBeenCalled();
    expect((await ejecutar(mw, { params: { id: DOC } }, false)).next).toHaveBeenCalled();
  });

  it('middleware del body: 404 si el proveedor es oculto (pagos, facturas, movimientos); respeta la condición de tipo', async () => {
    const mw = exigirProveedorDelBodyVisible();
    const oculto = await ejecutar(mw, { body: { proveedorId: OCULTO } }, true);
    expect(oculto.res.status).toHaveBeenCalledWith(404);
    expect((await ejecutar(mw, { body: { proveedorId: VISIBLE } }, true)).next).toHaveBeenCalled();
    expect((await ejecutar(mw, { body: { proveedorId: OCULTO } }, false)).next).toHaveBeenCalled();
    const ticket = exigirProveedorDelBodyVisible('entidadId', b => b.tipo !== 'venta');
    expect((await ejecutar(ticket, { body: { tipo: 'compra', entidadId: OCULTO } }, true)).res.status).toHaveBeenCalledWith(404);
    expect((await ejecutar(ticket, { body: { tipo: 'venta', entidadId: OCULTO } }, true)).next).toHaveBeenCalled();
  });

  it('si no se puede verificar responde 503 y no deja pasar', async () => {
    tablas.proveedores = { error: { code: '08006', message: 'caída' } };
    const r = await ejecutar(exigirDocumentoVisible('ticket_pesaje'), { params: { id: DOC } }, true);
    expect(r.res.status).toHaveBeenCalledWith(503);
    expect(r.next).not.toHaveBeenCalled();
  });
});

describe('M1: ocultar siempre lo decide requireSuperadmin', () => {
  it('el param :id deja pasar POST /:id/ocultar (un no-superadmin recibe 403 de requireSuperadmin, no 404)', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await conVisibilidadProveedores(true, () =>
      exigirProveedorVisible({ method: 'POST', path: `/${OCULTO}/ocultar` } as Request, res as unknown as Response, next, OCULTO));
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('otras rutas del mismo proveedor oculto siguen dando 404', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await conVisibilidadProveedores(true, () =>
      exigirProveedorVisible({ method: 'GET', path: `/${OCULTO}/estado-cuenta` } as Request, res as unknown as Response, next, OCULTO));
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('L2: columna inexistente', () => {
  it('devuelve [] y deja un aviso en el log', async () => {
    tablas.proveedores = { error: { code: '42703', message: 'column proveedores.oculto does not exist' } };
    expect(await leerIdsOcultos()).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ evento: 'proveedores_oculto_columna_inexistente' }));
  });
});
