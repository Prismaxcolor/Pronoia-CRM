import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Ruteo de avisos entre el grupo de operaciones y "P.S Cajas Pagos": el dinero va SOLO a cajas
 * (con su comprobante si lo hay), la factura emitida va a cajas con su PDF (accion documento), y sin
 * TELEGRAM_CAJAS_CHAT_ID no se envía nada de dinero ni se rompe nada.
 */

const WEBHOOK_GRUPO = 'https://n8n.test/webhook/notificar-grupo-pronoia';
const WEBHOOK_CONTENIDO = 'https://n8n.test/webhook/enviar-contenido-pronoia';
const SUPABASE = 'https://proyecto.supabase.test';
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

const tablas: Record<string, { data: unknown }> = {};
const subidas: string[] = [];
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => tablas[tabla] ?? { data: null },
        then: (ok: (r: unknown) => unknown) => Promise.resolve(tablas[tabla] ?? { data: null }).then(ok),
      };
      return b;
    },
    storage: {
      from: () => ({
        upload: async (ruta: string) => { subidas.push(ruta); return { error: null }; },
        createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.test/firmada.pdf' }, error: null }),
      }),
    },
  },
}));
vi.mock('../src/services/ticket-pesaje-service.js', () => ({ obtenerTicket: async () => null }));
vi.mock('../src/services/document-generator.js', () => ({
  generarTicketPdf: () => Buffer.from('%PDF'),
  nombreArchivoTicket: () => 'ticket.pdf',
  generarFacturaPdf: () => Buffer.from('%PDF-factura'),
  nombreArchivoFactura: () => 'factura-venta-v-0006.pdf',
}));

import { notificarGrupoMiddleware } from '../src/middlewares/notificar-grupo.js';
import { limpiarCacheActores } from '../src/services/grupo-notificar-service.js';
import { configurarSecretosParaPruebas } from '../src/config/secretos.js';

const CHAT_CAJAS = '-1001234567890';

interface FakeReq { method: string; originalUrl: string; body?: unknown; user?: unknown }

function ejecutar(req: FakeReq, status: number, cuerpo: unknown) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    json(_c: unknown) { return this; },
  });
  const next = vi.fn();
  notificarGrupoMiddleware(req as never, res as never, next);
  res.statusCode = status;
  res.json(cuerpo);
  res.emit('finish');
  return { next };
}

const ana = { sub: 'u1', email: 'ana@pronoia.test', rol: 'administracion' };
let fetchMock: ReturnType<typeof vi.fn>;
const llamadas = () => fetchMock.mock.calls.map(([url, init]) => ({
  url: String(url),
  cuerpo: JSON.parse(String(init.body)) as Record<string, unknown>,
}));
const esperarEnvios = async (n: number) => vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(n));
const sinChatIdCajas = () => { delete process.env.TELEGRAM_CAJAS_CHAT_ID; };
const pausa = () => new Promise(r => setTimeout(r, 40));

const PAGO = {
  proveedorId: 'p1', montoUsd: 300, descripcion: 'Pago de chatarra', referencia: 'TRF-77', fecha: '2026-10-07',
  items: [{ tipo: 'factura', id: 'f1', montoUsd: 300 }],
  bancas: [{ bancaId: 'b1', monto: 12000, moneda: 'VES', montoUsd: 300 }],
};

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  subidas.length = 0;
  limpiarCacheActores();
  env.ENV.GRUPO_NOTIFICACIONES_ACTIVAS = true;
  process.env.TELEGRAM_CAJAS_CHAT_ID = CHAT_CAJAS;
  configurarSecretosParaPruebas({ lector: async () => null });
  env.ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO = WEBHOOK_CONTENIDO;
  env.ENV.GRUPO_EVENTOS_SILENCIADOS = [];
  tablas.users = { data: { nombre: 'Ana Pérez', rol: 'administracion' } };
  tablas.proveedores = { data: { nombre: 'Chatarra SA' } };
  tablas.bancas = { data: [{ id: 'b1', nombre: 'Banesco', moneda: 'VES' }, { id: 'b2', nombre: 'Caja USD', moneda: 'USD' }] };
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.TELEGRAM_CAJAS_CHAT_ID;
  configurarSecretosParaPruebas();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dinero -> grupo de cajas', () => {
  it('un pago va SOLO a cajas, con tipo, monto, cuenta, contraparte, concepto, usuario y fecha', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    const [envio] = llamadas();
    expect(envio.url).toBe(WEBHOOK_CONTENIDO);
    expect(envio.cuerpo).toMatchObject({ chatId: '-1001234567890', accion: 'mensaje', tipoDocumento: 'aviso' });
    const mensaje = String(envio.cuerpo.mensaje);
    expect(mensaje).toContain('Se registró un pago / cruce a proveedor');
    expect(mensaje).toContain('Pago PG-0012');
    expect(mensaje).toContain('Proveedor Chatarra SA');
    expect(mensaje).toContain('Monto: $300');
    expect(mensaje).toContain('Cuenta: Banesco');
    expect(mensaje).toContain('VES');
    expect(mensaje).toContain('Concepto: Pago de chatarra');
    expect(mensaje).toContain('Referencia: TRF-77');
    expect(mensaje).toContain('Ana Pérez (Administración)');
    expect(mensaje).not.toMatch(/<\/?b>/); // texto plano, sin HTML
    expect(llamadas().some(l => l.url === WEBHOOK_GRUPO)).toBe(false);
  });

  it('cobros, bancas y notas también van a cajas, nunca al webhook de operaciones', async () => {
    tablas.clientes = { data: { nombre: 'Cliente SA' } };
    ejecutar({ method: 'POST', originalUrl: '/api/cobros/multiple', user: ana, body: { ...PAGO, proveedorId: undefined, clienteId: 'c1' } }, 201, { numeroCobro: 3 });
    ejecutar({ method: 'POST', originalUrl: '/api/cochinito/bancas', user: ana, body: {} }, 201, { banca: { nombre: 'Zelle' } });
    ejecutar({ method: 'POST', originalUrl: '/api/proveedores/p1/notas-ajuste', user: ana, body: { tipo: 'credito', monto: 20, motivo: 'x' } }, 201, { codigo: 'NC-0001' });
    await esperarEnvios(3);
    expect(llamadas().every(l => l.url === WEBHOOK_CONTENIDO)).toBe(true);
  });

  it('un movimiento de banca (transferencia) muestra origen y destino', async () => {
    ejecutar({
      method: 'POST', originalUrl: '/api/cochinito/movimientos', user: ana,
      body: { tipo: 'transferencia', bancaId: 'b1', bancaDestinoId: 'b2', monto: 4000, moneda: 'VES', montoDestino: 100, descripcion: 'Traspaso', fecha: '2026-10-07' },
    }, 201, {});
    await esperarEnvios(1);
    const mensaje = String(llamadas()[0].cuerpo.mensaje);
    expect(mensaje).toContain('Tipo: transferencia');
    expect(mensaje).toContain('Monto: 4000 VES');
    expect(mensaje).toContain('Cuenta origen: Banesco');
    expect(mensaje).toContain('Cuenta destino: Caja USD');
    expect(mensaje).toContain('Concepto: Traspaso');
  });

  it('con comprobante: manda la foto con el mensaje como pie', async () => {
    const url = `${SUPABASE}/storage/v1/object/public/comprobantes/abc.jpg`;
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: { ...PAGO, comprobantes: [url] } }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    const { cuerpo } = llamadas()[0];
    expect(cuerpo.accion).toBe('foto');
    const fotos = cuerpo.fotos as Array<{ url: string; caption?: string }>;
    expect(fotos).toHaveLength(1);
    expect(fotos[0].url).toBe(url);
    expect(fotos[0].caption).toContain('Pago PG-0012');
  });

  it('varios comprobantes: álbum con el pie solo en la primera foto', async () => {
    const urls = [1, 2].map(i => `${SUPABASE}/storage/v1/object/public/comprobantes/${i}.png`);
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: { ...PAGO, comprobantes: urls } }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    const { cuerpo } = llamadas()[0];
    expect(cuerpo.accion).toBe('fotos');
    const fotos = cuerpo.fotos as Array<{ caption?: string }>;
    expect(fotos[0].caption).toBeTruthy();
    expect(fotos[1].caption).toBeUndefined();
  });

  it('un comprobante que no es de nuestro Storage no se reenvía (solo el mensaje)', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: { ...PAGO, comprobantes: ['https://evil.test/x.jpg'] } }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo.accion).toBe('mensaje');
  });

  it('si la foto con pie falla, reintenta el aviso como texto simple sin lanzar', async () => {
    const url = `${SUPABASE}/storage/v1/object/public/comprobantes/abc.jpg`;
    fetchMock.mockImplementation(async (_u: unknown, init?: { body?: string }) => {
      const accion = JSON.parse(init?.body ?? '{}').accion;
      return accion === 'foto' ? { ok: false, status: 400 } : { ok: true, status: 200 };
    });
    const { next } = ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: { ...PAGO, comprobantes: [url] } }, 201, { numeroPago: 12 });
    await esperarEnvios(2);
    expect(next).toHaveBeenCalled();
    const acciones = llamadas().map(l => l.cuerpo.accion);
    expect(acciones).toEqual(['foto', 'mensaje']);
    expect(String(llamadas()[1].cuerpo.mensaje)).toContain('Pago PG-0012');
  });

  it('sin TELEGRAM_CAJAS_CHAT_ID no se envía nada de dinero (ni a operaciones) y la operación sigue', async () => {
    sinChatIdCajas();
    const { next } = ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    ejecutar({ method: 'POST', originalUrl: '/api/cochinito/movimientos', user: ana, body: { tipo: 'ingreso', monto: 10, bancaId: 'b1' } }, 201, {});
    await pausa();
    expect(next).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con la variable de entorno usa ese chat id, sin consultar la tabla', async () => {
    const lector = vi.fn(async () => '-100999');
    configurarSecretosParaPruebas({ lector });
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo.chatId).toBe(CHAT_CAJAS);
    expect(lector).not.toHaveBeenCalledWith('TELEGRAM_CAJAS_CHAT_ID');
  });

  it('sin variable de entorno lee el chat id de configuracion_secreta', async () => {
    sinChatIdCajas();
    configurarSecretosParaPruebas({ lector: async clave => (clave === 'TELEGRAM_CAJAS_CHAT_ID' ? ' -100777 ' : null) });
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo).toMatchObject({ chatId: '-100777', accion: 'mensaje' });
  });

  it('si la lectura de la tabla falla no envía ni lanza y la operación sigue', async () => {
    sinChatIdCajas();
    configurarSecretosParaPruebas({ lector: async () => { throw new Error('db caída'); } });
    const { next } = ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await pausa();
    expect(next).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin webhook de contenido tampoco se envía nada', async () => {
    env.ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO = '';
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await pausa();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si Telegram/n8n falla, no lanza: queda registrado y la operación sigue', async () => {
    fetchMock.mockRejectedValue(new Error('n8n caído'));
    const { next } = ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    await pausa();
    expect(next).toHaveBeenCalled();
  });

  it('se respeta el silenciado por categoría también para cajas', async () => {
    env.ENV.GRUPO_EVENTOS_SILENCIADOS = ['tesoreria'];
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await pausa();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('una operación con error 4xx no avisa nada', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 400, { error: 'x' });
    await pausa();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('grupo de Telegram por banca', () => {
  const bancasConChat = (chatB1: string | null, chatB2: string | null = null) => {
    tablas.bancas = { data: [
      { id: 'b1', nombre: 'Banesco', moneda: 'VES', telegram_chat_id: chatB1 },
      { id: 'b2', nombre: 'Caja USD', moneda: 'USD', telegram_chat_id: chatB2 },
    ] };
  };

  it('el aviso va al grupo de la banca cuando la banca tiene uno', async () => {
    bancasConChat('-1005550001');
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo.chatId).toBe('-1005550001');
  });

  it('si la banca no tiene grupo cae al grupo general de cajas', async () => {
    bancasConChat(null);
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo.chatId).toBe(CHAT_CAJAS);
  });

  it('con varias bancas se usa la primera que tenga grupo propio', async () => {
    bancasConChat(null, '-1005550002');
    const body = { ...PAGO, bancas: [...PAGO.bancas, { bancaId: 'b2', monto: 10, moneda: 'USD', montoUsd: 10 }], montoUsd: 310 };
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo.chatId).toBe('-1005550002');
  });

  it('sin grupo general, una banca con grupo propio igual envía', async () => {
    sinChatIdCajas();
    bancasConChat('-1005550001');
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo.chatId).toBe('-1005550001');
  });

  it('si falla la lectura de bancas cae al grupo general y registra el error', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    tablas.bancas = { data: null, error: { code: '08006', message: 'conexion caida' } } as never;
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await esperarEnvios(1);
    expect(llamadas()[0].cuerpo.chatId).toBe(CHAT_CAJAS);
    expect(consola.mock.calls.some(c => String(c[0]).includes('cajas_chat_banca_lectura_fallida'))).toBe(true);
    consola.mockRestore();
  });

  it('sin grupo general ni de banca no se envía nada', async () => {
    sinChatIdCajas();
    bancasConChat(null);
    ejecutar({ method: 'POST', originalUrl: '/api/pagos/multiple', user: ana, body: PAGO }, 201, { numeroPago: 12 });
    await pausa();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('factura emitida -> grupo de cajas', () => {
  const factura = { id: 'f1', codigo: 'V-0006', tipo: 'venta', estado: 'emitida', total: 1234.5, nombreEntidad: 'Cliente SA', ticketIds: [] };

  it('se envía a cajas como documento con el PDF y el mensaje de pie, nunca al webhook de operaciones', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/facturas-venta', user: ana, body: {} }, 201, { factura });
    await esperarEnvios(1);
    const [envio] = llamadas();
    expect(envio.url).toBe(WEBHOOK_CONTENIDO);
    expect(envio.cuerpo).toMatchObject({
      accion: 'documento', chatId: CHAT_CAJAS,
      url: 'https://storage.test/firmada.pdf', nombreArchivo: 'factura-venta-v-0006.pdf',
    });
    expect(String(envio.cuerpo.mensaje)).toContain('Factura V-0006');
    expect(String(envio.cuerpo.mensaje)).not.toMatch(/<\/?b>/);
    expect(subidas[0]).toContain('grupo/factura/f1/');
    expect(llamadas().some(l => l.url === WEBHOOK_GRUPO)).toBe(false);
  });

  it('sin TELEGRAM_CAJAS_CHAT_ID no se envía nada (ni a operaciones) y no falla', async () => {
    sinChatIdCajas();
    const { next } = ejecutar({ method: 'POST', originalUrl: '/api/facturas-venta', user: ana, body: {} }, 201, { factura });
    await pausa();
    expect(next).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(subidas).toHaveLength(0);
  });

  it('una factura en borrador avisa solo el texto, sin PDF', async () => {
    ejecutar({ method: 'POST', originalUrl: '/api/facturas-compra', user: ana, body: {} }, 201, { factura: { ...factura, tipo: 'compra', estado: 'borrador' } });
    await esperarEnvios(1);
    expect(llamadas()[0].url).toBe(WEBHOOK_CONTENIDO);
    expect(llamadas()[0].cuerpo.accion).toBe('mensaje');
    expect(subidas).toHaveLength(0);
  });
});
