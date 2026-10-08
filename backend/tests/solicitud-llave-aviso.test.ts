import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Avisos de Telegram de solicitudes de llave por mensaje privado (un envío por superadmin vinculado,
 * botones de callback, aviso al solicitante, tolerancia a columnas ausentes, nunca lanzan), validación de
 * botones y plantillas de los eventos de modificación de dinero.
 */

const WEBHOOK_CONTENIDO = 'https://n8n.test/webhook/enviar-contenido-pronoia';
const CHAT_CAJAS = '-1001234567890';
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
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, in: () => b, not: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => {
          const r = (tablas[tabla] ?? { data: null }) as { data: unknown };
          return Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r;
        },
        then: (ok: (r: unknown) => unknown) => Promise.resolve(tablas[tabla] ?? { data: null }).then(ok),
      };
      return b;
    },
  },
}));

import { avisarSolicitudLlave, avisarResolucionLlave } from '../src/services/solicitud-llave-aviso.js';
import { validarBotones } from '../src/utils/botones-aviso.js';
import { configurarSecretosParaPruebas } from '../src/config/secretos.js';
import { notificarGrupoMiddleware } from '../src/middlewares/notificar-grupo.js';
import { limpiarCacheActores } from '../src/services/grupo-notificar-service.js';
import { buscarEvento } from '../src/services/grupo-eventos.js';
import type { SolicitudLlaveAviso } from '../src/utils/solicitud-llave-tipos.js';

const base: SolicitudLlaveAviso = {
  id: 'sol-1',
  solicitanteNombre: 'Maria Perez',
  entidadTipo: 'pago',
  entidadId: 'e1',
  descripcion: 'Pago PAG-0042 a Metales SA, 1.520 USD',
  motivo: 'monto mal digitado, era 1.250',
  estado: 'pendiente',
};

let fetchMock: ReturnType<typeof vi.fn>;
const llamadas = () => fetchMock.mock.calls.map(([url, init]) => ({
  url: String(url),
  cuerpo: JSON.parse(String(init.body)) as Record<string, unknown>,
}));

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  limpiarCacheActores();
  env.ENV.GRUPO_NOTIFICACIONES_ACTIVAS = true;
  process.env.TELEGRAM_CAJAS_CHAT_ID = CHAT_CAJAS;
  process.env.APP_URL = 'https://pronoia.test/';
  configurarSecretosParaPruebas({ lector: async () => null });
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.TELEGRAM_CAJAS_CHAT_ID;
  delete process.env.APP_URL;
  configurarSecretosParaPruebas();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const superadmins = (...filas: Array<{ id: string; nombre: string; telegram_chat_id: string }>) => {
  tablas.users = { data: filas };
};

describe('avisos privados de solicitud de llave', () => {
  const abraham = { id: 'u-abraham', nombre: 'Abraham', telegram_chat_id: '111' };
  const rosa = { id: 'u-rosa', nombre: 'Rosa', telegram_chat_id: '222' };
  const pendiente: SolicitudLlaveAviso = { ...base, solicitanteId: 'u-maria', venceEn: '2026-10-07T19:40:00.000Z' };

  it('envía un mensaje privado por superadmin con texto exacto y botones de callback', async () => {
    superadmins(abraham, rosa);
    await avisarSolicitudLlave(pendiente);
    const envios = llamadas();
    expect(envios).toHaveLength(2);
    expect(envios.map(e => e.url)).toEqual([WEBHOOK_CONTENIDO, WEBHOOK_CONTENIDO]);
    expect(envios[0].cuerpo).toMatchObject({
      tipoDocumento: 'aviso',
      entidadTipo: 'usuario',
      entidadId: 'u-abraham',
      chatId: '111',
      nombreEntidad: 'Abraham',
      accion: 'mensaje',
    });
    expect(envios[1].cuerpo).toMatchObject({ entidadId: 'u-rosa', chatId: '222' });
    expect(envios[0].cuerpo.mensaje).toBe(
      '🔑 Solicitud de llave\nDe: Maria Perez\nPara editar: Pago PAG-0042 a Metales SA, 1.520 USD\nMotivo: monto mal digitado, era 1.250\nVence: 15:40'
    );
    expect(envios[0].cuerpo.botones).toEqual([
      { texto: '✅ Aprobar', callback: 'llave:a:sol-1' },
      { texto: '❌ Rechazar', callback: 'llave:r:sol-1' },
    ]);
  });

  it('no escribe a los grupos de cajas ni de operaciones', async () => {
    superadmins(abraham);
    await avisarSolicitudLlave(pendiente);
    await avisarSolicitudLlave({ ...pendiente, entidadTipo: 'ticket_pesaje' });
    for (const e of llamadas()) {
      expect(e.url).toBe(WEBHOOK_CONTENIDO);
      expect(e.cuerpo.chatId).toBe('111');
      expect(e.cuerpo.chatId).not.toBe(CHAT_CAJAS);
    }
  });

  it('sin vencimiento omite la línea "Vence"', async () => {
    superadmins(abraham);
    await avisarSolicitudLlave(base);
    expect(String(llamadas()[0].cuerpo.mensaje)).not.toContain('Vence');
  });

  it('el payload nunca contiene un código de llave', async () => {
    superadmins(abraham);
    await avisarSolicitudLlave(pendiente);
    expect(JSON.stringify(llamadas()[0].cuerpo)).not.toMatch(/codigo|ABCDE/i);
  });

  it('sin superadmin vinculado no envía nada ni lanza', async () => {
    tablas.users = { data: [] };
    await expect(avisarSolicitudLlave(pendiente)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tolera columnas ausentes (error de la BD): no envía y no lanza', async () => {
    tablas.users = { data: null, error: { message: 'column users.telegram_chat_id does not exist' } };
    await expect(avisarSolicitudLlave(pendiente)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un fallo individual no impide avisar a los demás', async () => {
    superadmins(abraham, rosa);
    fetchMock.mockRejectedValueOnce(new Error('red caída'));
    await expect(avisarSolicitudLlave(pendiente)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('webhook con 500 no lanza', async () => {
    superadmins(abraham);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(avisarSolicitudLlave(pendiente)).resolves.toBeUndefined();
  });

  it('aprobada: aviso privado al solicitante con la hora de Caracas y sin código', async () => {
    tablas.users = { data: [{ id: 'u-maria', nombre: 'Maria Perez', telegram_chat_id: '333' }] };
    await avisarResolucionLlave({ ...pendiente, estado: 'aprobada', aprobadorNombre: 'Abraham', llaveExpiraEn: '2026-10-07T19:40:00.000Z' });
    const [envio] = llamadas();
    expect(envio.cuerpo).toMatchObject({ chatId: '333', entidadTipo: 'usuario', accion: 'mensaje' });
    expect(envio.cuerpo.mensaje).toBe('✅ Tu solicitud de llave fue aprobada por Abraham. Vuelve a la pantalla de edición: la llave vence 15:40.');
    expect(envio.cuerpo).not.toHaveProperty('botones');
  });

  it('rechazada: texto exacto, con y sin motivo', async () => {
    tablas.users = { data: [{ id: 'u-maria', nombre: 'Maria Perez', telegram_chat_id: '333' }] };
    await avisarResolucionLlave({ ...pendiente, estado: 'rechazada', aprobadorNombre: 'Abraham' });
    await avisarResolucionLlave({ ...pendiente, estado: 'rechazada', aprobadorNombre: 'Abraham', motivoRechazo: 'falta soporte' });
    const [sin, con] = llamadas();
    expect(sin.cuerpo.mensaje).toBe('❌ Tu solicitud de llave fue rechazada por Abraham.');
    expect(con.cuerpo.mensaje).toBe('❌ Tu solicitud de llave fue rechazada por Abraham. Motivo: falta soporte');
  });

  it('solicitante sin Telegram vinculado, sin id u otros estados: no avisa', async () => {
    tablas.users = { data: [{ id: 'u-maria', nombre: 'Maria Perez', telegram_chat_id: null }] };
    await avisarResolucionLlave({ ...pendiente, estado: 'aprobada', aprobadorNombre: 'Abraham' });
    await avisarResolucionLlave({ ...base, estado: 'rechazada' });
    tablas.users = { data: [{ id: 'u-maria', nombre: 'M', telegram_chat_id: '333' }] };
    await avisarResolucionLlave({ ...pendiente, estado: 'usada' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nunca lanza si el webhook falla en la resolución', async () => {
    tablas.users = { data: [{ id: 'u-maria', nombre: 'M', telegram_chat_id: '333' }] };
    fetchMock.mockRejectedValueOnce(new Error('red caída'));
    await expect(avisarResolucionLlave({ ...pendiente, estado: 'aprobada', llaveExpiraEn: null })).resolves.toBeUndefined();
  });
});

describe('validarBotones', () => {
  it('acepta https y descarta http, javascript:, URLs inválidas y textos vacíos', () => {
    const r = validarBotones([
      { texto: 'Ok', url: 'https://a.test/x' },
      { texto: 'Mal', url: 'http://a.test' },
      { texto: 'Mal', url: 'javascript:alert(1)' },
      { texto: 'Mal', url: 'no es url' },
      { texto: '  ', url: 'https://a.test' },
      null,
    ]);
    expect(r).toEqual([{ texto: 'Ok', url: 'https://a.test/x' }]);
    expect(validarBotones(undefined)).toEqual([]);
  });

  it('acepta callbacks con el patrón permitido y descarta el resto', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const r = validarBotones([
      { texto: '✅ Aprobar', callback: `llave:a:${uuid}` },
      { texto: 'Mal', callback: 'llave:a:' },
      { texto: 'Mal', callback: `LLAVE:a:${uuid}` },
      { texto: 'Mal', callback: `llave:ab:${uuid}` },
      { texto: 'Mal', callback: `llave:a:${uuid}${uuid}` },
      { texto: 'Mal', callback: 'llave:a:zzzz' },
      { texto: 'Mal', callback: `llave:a:${uuid}`, url: 'https://a.test' },
      { texto: 'Mal', callback: 5 },
    ]);
    expect(r).toEqual([{ texto: '✅ Aprobar', callback: `llave:a:${uuid}` }]);
  });
});

describe('eventos de modificación de dinero', () => {
  const ana = { sub: 'u1', email: 'ana@pronoia.test', rol: 'administracion' };

  function ejecutar(method: string, originalUrl: string, body: unknown, resBody: unknown) {
    const res = Object.assign(new EventEmitter(), { statusCode: 200, json(_c: unknown) { return this; } });
    notificarGrupoMiddleware({ method, originalUrl, body, user: ana } as never, res as never, vi.fn());
    res.statusCode = 200;
    res.json(resBody);
    res.emit('finish');
  }

  beforeEach(() => {
    tablas.users = { data: { nombre: 'Ana Pérez', rol: 'administracion' } };
  });

  it('las rutas están catalogadas con la clave exacta', () => {
    const esperadas: Array<[string, string, string]> = [
      ['PATCH', '/api/pagos/g1', 'pago.editado'],
      ['POST', '/api/pagos/g1/anular', 'pago.anulado'],
      ['PATCH', '/api/cobros/g1', 'cobro.editado'],
      ['POST', '/api/cobros/g1/anular', 'cobro.anulado'],
      ['PATCH', '/api/cochinito/movimientos/m1', 'movimiento.editado'],
      ['POST', '/api/cochinito/movimientos/m1/anular', 'movimiento.anulado'],
      ['POST', '/api/proveedores/p1/notas-ajuste/n1/anular', 'nota.anulada_proveedor'],
      ['POST', '/api/clientes/c1/notas-ajuste/n1/anular', 'nota.anulada_cliente'],
      ['POST', '/api/llaves-solicitudes', 'llave_solicitud.creada'],
    ];
    for (const [m, ruta, clave] of esperadas) {
      expect(buscarEvento(m, ruta)?.evento.clave, `${m} ${ruta}`).toBe(clave);
    }
  });

  it('pago editado: va a cajas con cambios antes→después', async () => {
    ejecutar('PATCH', '/api/pagos/g1', { montoUsd: 1250, descripcion: 'Pago corregido' }, {
      codigo: 'PAG-0042',
      autorizadoPor: 'Abraham',
      cambios: { monto: { antes: 1520, despues: 1250 }, concepto: { antes: 'Pago', despues: 'Pago corregido' } },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [envio] = llamadas();
    expect(envio.url).toBe(WEBHOOK_CONTENIDO);
    const m = String(envio.cuerpo.mensaje);
    expect(m).toContain('Pago MODIFICADO');
    expect(m).toContain('Pago PAG-0042');
    expect(m).toContain('Autorizó: Abraham');
    expect(m).toContain('• monto: 1520 → 1250');
    expect(m).toContain('• concepto: Pago → Pago corregido');
    expect(m).toContain('Ana Pérez');
  });

  it('pago anulado: muestra el motivo y quién autorizó', async () => {
    ejecutar('POST', '/api/pagos/g1/anular', { motivo: 'duplicado' }, { codigo: 'PAG-0042', autorizadoPor: 'Abraham' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const m = String(llamadas()[0].cuerpo.mensaje);
    expect(m).toContain('Pago ANULADO');
    expect(m).toContain('Pago PAG-0042');
    expect(m).toContain('Motivo: duplicado');
    expect(m).toContain('Autorizó: Abraham');
  });

  it('movimiento editado sin auditoría: cae a los valores nuevos del body', async () => {
    ejecutar('PATCH', '/api/cochinito/movimientos/m1', { monto: 500, moneda: 'VES', descripcion: 'Ajuste' }, {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const m = String(llamadas()[0].cuerpo.mensaje);
    expect(m).toContain('Movimiento de banca MODIFICADO');
    expect(m).toContain('Nuevo monto: 500 VES');
    expect(m).toContain('Concepto: Ajuste');
  });

  it('nota anulada de proveedor va a cajas con el motivo', async () => {
    tablas.proveedores = { data: { nombre: 'Metales SA' } };
    tablas.notas_ajuste_proveedor = { data: { numero: 7, tipo: 'credito' } };
    ejecutar('POST', '/api/proveedores/p1/notas-ajuste/n1/anular', { motivo: 'error' }, {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [envio] = llamadas();
    expect(envio.url).toBe(WEBHOOK_CONTENIDO);
    expect(String(envio.cuerpo.mensaje)).toContain('Se ANULÓ una nota de ajuste');
    expect(String(envio.cuerpo.mensaje)).toContain('Motivo: error');
  });

  it('las solicitudes de llave no generan aviso genérico (silenciosas)', async () => {
    ejecutar('POST', '/api/llaves-solicitudes', { entidadTipo: 'pago' }, { id: 'sol-1' });
    await new Promise(r => setTimeout(r, 40));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
