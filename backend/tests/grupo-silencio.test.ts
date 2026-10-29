import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Interruptor "avisos de movimientos a Telegram" (telegram_reportes_activos): el superadmin silencia por
 * cuenta, proveedor o cliente. Cubre el silencio en el grupo de cajas (por cuenta y por tercero), lo que NO
 * se silencia, el fail-open ante errores de BD, el chat propio del tercero y el degradado de escritura.
 */

const WEBHOOK_CONTENIDO = 'https://n8n.test/webhook/enviar-contenido-pronoia';
const env = vi.hoisted(() => ({
  ENV: {
    GRUPO_NOTIFICACIONES_ACTIVAS: true,
    N8N_WEBHOOK_GRUPO: 'https://n8n.test/webhook/notificar-grupo-pronoia',
    N8N_WEBHOOK_ENVIAR_CONTENIDO: 'https://n8n.test/webhook/enviar-contenido-pronoia',
    SUPABASE_URL: 'https://proyecto.supabase.test',
    GRUPO_EVENTOS_SILENCIADOS: [] as string[],
    GRUPO_INCLUIR_RUIDOSOS: false,
    GRUPO_ZONA_HORARIA: 'America/Caracas',
  },
}));
vi.mock('../src/config/env.js', () => env);
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

interface TablaFalsa { filas?: unknown[]; error?: { code?: string; message: string } | null; lanza?: boolean }
const tablas: Record<string, TablaFalsa> = {};
const consultas: Array<{ tabla: string; filtros: Array<[string, unknown]> }> = [];
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const cfg = tablas[tabla] ?? { filas: [] };
      const consulta = { tabla, filtros: [] as Array<[string, unknown]> };
      consultas.push(consulta);
      const respuesta = () => {
        if (cfg.lanza) throw new Error('BD caída');
        // Como la BD real: .in('id', [...]) devuelve solo las filas pedidas.
        const pedidos = consulta.filtros.find(([c, v]) => c === 'id' && Array.isArray(v))?.[1] as string[] | undefined;
        const filas = (cfg.filas ?? []).filter(f => !pedidos || pedidos.includes((f as { id?: string }).id ?? ''));
        return { data: cfg.error ? null : filas, error: cfg.error ?? null };
      };
      const b: Record<string, unknown> = {
        select: () => b, order: () => b, limit: () => b,
        eq: (c: string, v: unknown) => { consulta.filtros.push([c, v]); return b; },
        in: (c: string, v: unknown) => { consulta.filtros.push([c, v]); return b; },
        maybeSingle: async () => ({ data: (cfg.filas ?? [])[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(respuesta).then(ok, ko),
      };
      return b;
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: 'https://s.test/f.pdf' }, error: null }) }) },
  },
}));
vi.mock('../src/services/ticket-pesaje-service.js', () => ({ obtenerTicket: async () => null }));
vi.mock('../src/services/document-generator.js', () => ({
  generarTicketPdf: () => Buffer.from('%PDF'), nombreArchivoTicket: () => 'ticket.pdf',
  generarFacturaPdf: () => Buffer.from('%PDF'), nombreArchivoFactura: () => 'factura.pdf',
}));
vi.mock('../src/services/n8n-cliente.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/n8n-cliente.js')>();
  return { ...real, enviarN8n: (u: string, c: Record<string, unknown>, o = {}) => real.enviarN8n(u, c, { ...o, esperar: async () => undefined }) };
});

import { notificarGrupoMiddleware } from '../src/middlewares/notificar-grupo.js';
import { limpiarCacheActores } from '../src/services/grupo-notificar-service.js';
import { configurarSecretosParaPruebas } from '../src/config/secretos.js';
import {
  cambioReportesNoPermitido, escribirConReportes, reportesTelegramActivos, MENSAJE_REPORTES_TELEGRAM_PENDIENTE,
} from '../src/services/grupo-silencio-service.js';
import { notificarDocumento } from '../src/services/telegram-notify-service.js';

const CHAT_CAJAS = '-1001234567890';
const ana = { sub: 'u1', email: 'ana@pronoia.test', rol: 'administracion' };
let fetchMock: ReturnType<typeof vi.fn>;

function ejecutar(req: { method: string; originalUrl: string; body?: unknown; user?: unknown }, status: number, cuerpo: unknown) {
  const res = Object.assign(new EventEmitter(), { statusCode: 200, json(_c: unknown) { return this; } });
  notificarGrupoMiddleware(req as never, res as never, vi.fn());
  res.statusCode = status;
  res.json(cuerpo);
  res.emit('finish');
}
const pausa = () => new Promise(r => setTimeout(r, 60));
const esperarEnvios = (n: number) => vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(n));
/** Da tiempo a que un aviso (que NO debe salir) se hubiera enviado y comprueba que no hubo ninguna llamada. */
const sinEnvios = async () => { await pausa(); expect(fetchMock).not.toHaveBeenCalled(); };

const PAGO = {
  proveedorId: 'p1', montoUsd: 300, descripcion: 'Pago', referencia: 'TRF-1', fecha: '2026-10-07',
  items: [{ tipo: 'factura', id: 'f1', montoUsd: 300 }],
  bancas: [{ bancaId: 'b1', monto: 12000, moneda: 'VES', montoUsd: 300 }],
};
const banca = (id: string, extra: Record<string, unknown> = {}) => ({ id, nombre: `Cuenta ${id}`, moneda: 'VES', telegram_chat_id: null, ...extra });

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  consultas.length = 0;
  limpiarCacheActores();
  env.ENV.GRUPO_NOTIFICACIONES_ACTIVAS = true;
  process.env.TELEGRAM_CAJAS_CHAT_ID = CHAT_CAJAS;
  configurarSecretosParaPruebas({ lector: async () => null });
  tablas.users = { filas: [{ nombre: 'Ana Pérez', rol: 'administracion' }] };
  tablas.proveedores = { filas: [{ id: 'p1', nombre: 'Chatarra SA' }] };
  tablas.clientes = { filas: [{ id: 'c1', nombre: 'Cliente SA' }] };
  tablas.bancas = { filas: [banca('b1'), banca('b2')] };
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.TELEGRAM_CAJAS_CHAT_ID;
  configurarSecretosParaPruebas();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('silencio por cuenta (grupo de cajas)', () => {
  it('un pago que usa una cuenta con los avisos apagados no se avisa', async () => {
    tablas.bancas = { filas: [banca('b1', { telegram_reportes_activos: false })] };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await sinEnvios();
  });

  it('con una de varias cuentas apagada tampoco se avisa; con todas activas sí', async () => {
    const dos = { ...PAGO, bancas: [{ bancaId: 'b1', monto: 1, moneda: 'VES' }, { bancaId: 'b2', monto: 2, moneda: 'VES' }] };
    tablas.bancas = { filas: [banca('b1', { telegram_reportes_activos: true }), banca('b2', { telegram_reportes_activos: false })] };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: dos }, 201, { numeroPago: 1 });
    await sinEnvios();

    tablas.bancas = { filas: [banca('b1', { telegram_reportes_activos: true }), banca('b2')] };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: dos }, 201, { numeroPago: 2 });
    await esperarEnvios(1);
    expect(fetchMock.mock.calls[0][0]).toBe(WEBHOOK_CONTENIDO);
  });

  it('un movimiento de banca en una cuenta apagada no se avisa', async () => {
    tablas.bancas = { filas: [banca('b1', { telegram_reportes_activos: false })] };
    ejecutar({ method: 'POST', originalUrl: '/api/cochinito/movimientos', user: ana, body: { tipo: 'ingreso', bancaId: 'b1', monto: 5, moneda: 'VES' } }, 201, {});
    await sinEnvios();
  });

  it('completar una transferencia con mesa resuelve las cuentas del movimiento (el body no las trae)', async () => {
    tablas.movimientos = { filas: [{ banca_origen_id: 'b1', banca_destino_id: 'b2', proveedor_id: null, cliente_id: null }] };
    tablas.bancas = { filas: [banca('b1'), banca('b2', { telegram_reportes_activos: false })] };
    ejecutar({ method: 'POST', originalUrl: '/api/cochinito/movimientos/m1/completar', user: ana, body: {} }, 200, {});
    await sinEnvios();
    expect(consultas.some(c => c.tabla === 'movimientos' && c.filtros.some(([col, v]) => col === 'id' && v === 'm1'))).toBe(true);
  });

  it('anular un movimiento de banca respeta la cuenta apagada', async () => {
    tablas.movimientos = { filas: [{ banca_origen_id: 'b1', banca_destino_id: null, proveedor_id: null, cliente_id: null }] };
    tablas.bancas = { filas: [banca('b1', { telegram_reportes_activos: false })] };
    ejecutar({ method: 'POST', originalUrl: '/api/cochinito/movimientos/m1/anular', user: ana, body: { motivo: 'error' } }, 200, {});
    await sinEnvios();
  });
});

describe('silencio por proveedor / cliente (grupo de cajas)', () => {
  it('pago a un proveedor apagado: no se avisa', async () => {
    tablas.proveedores = { filas: [{ id: 'p1', nombre: 'Chatarra SA', telegram_reportes_activos: false }] };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 1 });
    await sinEnvios();
  });

  it('cobro a un cliente apagado: no se avisa', async () => {
    tablas.clientes = { filas: [{ id: 'c1', nombre: 'Cliente SA', telegram_reportes_activos: false }] };
    ejecutar({ method: 'POST', originalUrl: '/api/cobros/multiple', user: ana, body: { ...PAGO, proveedorId: undefined, clienteId: 'c1' } }, 201, { numeroCobro: 1 });
    await sinEnvios();
  });

  it('nota de crédito y su anulación (proveedor y cliente) apagados: no se avisan', async () => {
    tablas.proveedores = { filas: [{ id: 'p1', nombre: 'X', telegram_reportes_activos: false }] };
    tablas.clientes = { filas: [{ id: 'c1', nombre: 'Y', telegram_reportes_activos: false }] };
    ejecutar({ method: 'POST', originalUrl: '/api/proveedores/p1/notas-ajuste', user: ana, body: { tipo: 'credito', monto: 20 } }, 201, { codigo: 'NC-1' });
    ejecutar({ method: 'POST', originalUrl: '/api/proveedores/p1/notas-ajuste/n1/anular', user: ana, body: { motivo: 'x' } }, 200, {});
    ejecutar({ method: 'POST', originalUrl: '/api/clientes/c1/notas-ajuste', user: ana, body: { tipo: 'debito', monto: 20 } }, 201, { codigo: 'ND-1' });
    ejecutar({ method: 'POST', originalUrl: '/api/clientes/c1/notas-ajuste/n1/anular', user: ana, body: { motivo: 'x' } }, 200, {});
    await sinEnvios();
  });

  it('un movimiento de banca con tercero apagado no se avisa', async () => {
    tablas.proveedores = { filas: [{ id: 'p1', nombre: 'X', telegram_reportes_activos: false }] };
    ejecutar({ method: 'POST', originalUrl: '/api/cochinito/movimientos', user: ana, body: { tipo: 'egreso', bancaId: 'b1', monto: 5, moneda: 'VES', proveedorId: 'p1' } }, 201, {});
    await sinEnvios();
  });

  it('anular un pago resuelve el proveedor desde los movimientos del grupo', async () => {
    tablas.movimientos = { filas: [{ banca_origen_id: 'b1', banca_destino_id: null, proveedor_id: 'p1', cliente_id: null }] };
    tablas.proveedores = { filas: [{ id: 'p1', nombre: 'X', telegram_reportes_activos: false }] };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/g1/anular', user: ana, body: { motivo: 'error' } }, 200, {});
    await sinEnvios();
    expect(consultas.some(c => c.tabla === 'movimientos' && c.filtros.some(([col, v]) => col === 'grupo_id' && v === 'g1'))).toBe(true);
  });

  it('el proveedor apagado no silencia a otro proveedor', async () => {
    tablas.proveedores = { filas: [{ id: 'otro', nombre: 'Otro', telegram_reportes_activos: false }, { id: 'p1', nombre: 'Chatarra SA' }] };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 1 });
    await esperarEnvios(1);
  });
});

describe('lo que NO se silencia', () => {
  it('"enviar estado de cuenta por Telegram" sigue avisando aunque el cliente tenga los avisos apagados', async () => {
    tablas.clientes = { filas: [{ id: 'c1', nombre: 'Cliente SA', telegram_reportes_activos: false }] };
    ejecutar({ method: 'POST', originalUrl: '/api/clientes/c1/estado-cuenta/enviar-telegram', user: ana, body: {} }, 200, {});
    await esperarEnvios(1);
    expect(String(JSON.parse(String(fetchMock.mock.calls[0][1].body)).mensaje)).toContain('estado de cuenta');
  });

  it('una factura emitida sigue avisando aunque el proveedor tenga los avisos apagados', async () => {
    tablas.proveedores = { filas: [{ id: 'p1', nombre: 'Chatarra SA', telegram_reportes_activos: false }] };
    ejecutar({ method: 'POST', originalUrl: '/api/facturas-compra', user: ana, body: { proveedorId: 'p1' } }, 201, { factura: { id: 'f1', codigo: 'FC-1', estado: 'borrador', proveedorId: 'p1' } });
    await esperarEnvios(1);
  });
});

describe('fail-open', () => {
  it('error de BD al leer las cuentas: el aviso sale como siempre', async () => {
    tablas.bancas = { error: { code: 'XX000', message: 'boom' }, filas: [banca('b1')] };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 1 });
    await esperarEnvios(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('reportes_telegram_lectura_fallida'));
  });

  it('columna inexistente (migración sin aplicar): avisa y solo registra una advertencia', async () => {
    tablas.proveedores = { error: { code: '42703', message: 'column proveedores.telegram_reportes_activos does not exist' } };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 1 });
    await esperarEnvios(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('reportes_telegram_lectura_fallida'));
  });

  it('la consulta lanza una excepción: avisa igual', async () => {
    tablas.bancas = { lanza: true }; // la lectura del interruptor falla; la de proveedores ocultos (otra tabla) funciona
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 1 });
    await esperarEnvios(1);
  });

  it('falla la lectura de los movimientos del documento: avisa igual', async () => {
    tablas.movimientos = { error: { code: '42P01', message: 'relation does not exist' } };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/g1/anular', user: ana, body: { motivo: 'x' } }, 200, {});
    await esperarEnvios(1);
  });
});

describe('reportesTelegramActivos / cambioReportesNoPermitido', () => {
  it('false solo si la fila tiene la bandera en false; sin fila, sin campo o con error => true', async () => {
    tablas.clientes = { filas: [{ id: 'c1', telegram_reportes_activos: false }] };
    expect(await reportesTelegramActivos('clientes', 'c1')).toBe(false);
    expect(await reportesTelegramActivos('clientes', 'otro')).toBe(true);
    tablas.clientes = { filas: [{ id: 'c1' }] };
    expect(await reportesTelegramActivos('clientes', 'c1')).toBe(true);
    tablas.clientes = { error: { code: '42703', message: 'column does not exist' } };
    expect(await reportesTelegramActivos('clientes', 'c1')).toBe(true);
  });

  it('no superadmin: cambiar el valor se rechaza; reenviar el actual o no enviarlo, no', async () => {
    tablas.clientes = { filas: [{ id: 'c1', telegram_reportes_activos: true }] };
    expect(await cambioReportesNoPermitido('clientes', 'c1', 'administracion', false)).toBe(true);
    expect(await cambioReportesNoPermitido('clientes', 'c1', 'administracion', true)).toBe(false);
    expect(await cambioReportesNoPermitido('clientes', 'c1', 'administracion', undefined)).toBe(false);
  });

  it('superadmin puede cambiarlo siempre (ni consulta la BD)', async () => {
    expect(await cambioReportesNoPermitido('clientes', 'c1', 'superadmin', false)).toBe(false);
    expect(consultas).toHaveLength(0);
  });
});

describe('escribirConReportes (migración pendiente)', () => {
  const faltaColumna = { code: '42703', message: 'column "telegram_reportes_activos" does not exist' };

  it('apagar sin la columna => pendiente (no se descarta en silencio)', async () => {
    const ejecutar = vi.fn(async () => ({ data: null, error: faltaColumna }));
    const r = await escribirConReportes({ nombre: 'X', telegram_reportes_activos: false }, ejecutar);
    expect(r).toEqual({ pendiente: true, mensaje: MENSAJE_REPORTES_TELEGRAM_PENDIENTE });
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('encender (valor por defecto) sin la columna => reintenta sin ella', async () => {
    const ejecutar = vi.fn()
      .mockResolvedValueOnce({ data: null, error: faltaColumna })
      .mockResolvedValueOnce({ data: { id: 'p1' }, error: null });
    const r = await escribirConReportes({ nombre: 'X', telegram_reportes_activos: true }, ejecutar);
    expect(r).toEqual({ data: { id: 'p1' }, error: null });
    expect(ejecutar).toHaveBeenLastCalledWith({ nombre: 'X' });
  });

  it('otro error, o un update sin la bandera, se devuelve tal cual', async () => {
    const otro = { data: null, error: { code: '23505', message: 'duplicado' } };
    expect(await escribirConReportes({ telegram_reportes_activos: false }, async () => otro)).toBe(otro);
    const sinBandera = { data: null, error: faltaColumna };
    expect(await escribirConReportes({ nombre: 'X' }, async () => sinBandera)).toBe(sinBandera);
  });
});

describe('chat propio del proveedor/cliente (pagos, cruces y notas)', () => {
  const documento = (tipoDocumento: 'pago' | 'nota' | 'ticket') => ({
    entidadTipo: 'proveedor' as const, entidadId: 'p1', tipoDocumento,
    preparar: vi.fn(() => ({ buffer: Buffer.from('%PDF'), nombreArchivo: 'doc.pdf', mensaje: 'hola' })),
  });

  beforeEach(() => {
    tablas.proveedores = { filas: [{ id: 'p1', nombre: 'Chatarra SA', telegram_chat_id: '555111', telegram_reportes_activos: false }] };
  });

  it('con los avisos apagados no se manda el pago ni la nota al chat del proveedor', async () => {
    for (const tipo of ['pago', 'nota'] as const) {
      const d = documento(tipo);
      await notificarDocumento(d);
      expect(d.preparar).not.toHaveBeenCalled();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un ticket (no es un movimiento de dinero) sí se manda aunque estén apagados', async () => {
    const d = documento('ticket');
    await notificarDocumento(d);
    expect(d.preparar).toHaveBeenCalledTimes(1);
  });

  it('con los avisos activos el pago se manda como siempre', async () => {
    tablas.proveedores = { filas: [{ id: 'p1', nombre: 'Chatarra SA', telegram_chat_id: '555111', telegram_reportes_activos: true }] };
    const d = documento('pago');
    await notificarDocumento(d);
    expect(d.preparar).toHaveBeenCalledTimes(1);
  });
});
