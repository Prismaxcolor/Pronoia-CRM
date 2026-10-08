import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Certificación de envíos por Telegram: cada evento del sistema correlacionado con un
 * proveedor/cliente se ejecuta por su función real de negocio (con supabaseAdmin y fetch
 * simulados) y se verifica que el webhook de n8n recibe el chat_id correcto, el tipo de
 * envío esperado, y que NO se llama si la entidad no está vinculada o si falla Storage.
 */
const WEBHOOK = 'https://n8n.test/webhook/enviar-contenido';

vi.mock('../src/config/supabase.js', async () => ({
  supabaseAdmin: (await import('./helpers/supabase-falso')).supabaseAdminFalso,
}));
vi.mock('../src/config/env.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/config/env.js')>();
  return { ENV: { ...original.ENV, N8N_WEBHOOK_ENVIAR_CONTENIDO: 'https://n8n.test/webhook/enviar-contenido' } };
});
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));
vi.mock('../src/services/edicion-autorizada-service.js', () => ({
  autorizarEdicion: async () => ({ ok: true, autorizadoPor: null, liberar: async () => {} }),
  esSuperadminEnBd: async () => true,
}));
vi.mock('../src/services/ticket-auditoria.js', () => ({ auditarEdicionTicket: async () => true }));

import { ENV } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { estado, reiniciarSupabaseFalso } from './helpers/supabase-falso';
import {
  CHAT_CL1, CHAT_P1, CHAT_P2, CL1, GRUPO1, GRUPO9, P1, P_SIN_VINCULAR,
  filaFactura, filaNota, sembrarEntidades, sembrarPago, sembrarTicket,
} from './helpers/fixtures-telegram';
import { crearTicket, completarTicket, editarTicket } from '../src/services/ticket-pesaje-service.js';
import { crearFactura } from '../src/services/factura-service.js';
import { crearNotaAjuste, anularNotaAjuste } from '../src/services/nota-ajuste-service.js';
import { crearNotaAjusteCliente, anularNotaAjusteCliente } from '../src/services/nota-ajuste-cliente-service.js';
import { registrarPago, registrarPagoMultiple } from '../src/services/pago-service.js';
import { registrarCobroMultiple } from '../src/services/cobro-service.js';
import { actualizarEstadoCita } from '../src/services/cita-despacho-service.js';

const fetchMock = vi.fn();

/** Input mínimo válido de crearTicket (la RPC está simulada, solo importa que la forma no rompa el servicio). */
function inputTicket(tipo: 'compra' | 'venta', entidadId: string, est: 'bruto' | 'completo' = 'completo') {
  return { tipo, entidadId, estado: est, materiales: [], fotos: [], pesajesGlobales: [], fotosDevolucion: [], devolucion: 0, pesajeExterior: false, pesoGlobal: null } as never;
}

interface CuerpoWebhook {
  accion: 'documento' | 'foto' | 'fotos' | 'mensaje';
  tipoDocumento: string;
  entidadTipo: string;
  entidadId: string;
  chatId: string;
  nombreEntidad: string;
  url?: string;
  nombreArchivo?: string;
  mensaje?: string;
  fotos?: Array<{ url: string; caption?: string }>;
}

function llamadas(): CuerpoWebhook[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === WEBHOOK)
    .map(([, init]) => JSON.parse((init as { body: string }).body) as CuerpoWebhook);
}

/** Espera a que el envío fire-and-forget termine (n envíos al webhook). */
async function esperarEnvios(n: number): Promise<CuerpoWebhook[]> {
  await vi.waitFor(() => expect(llamadas().length).toBeGreaterThanOrEqual(n), { timeout: 5000 });
  await asentar();
  return llamadas();
}

/** Para afirmar que NO pasó nada: deja correr la cadena async completa. */
async function asentar(): Promise<void> {
  await new Promise(r => setTimeout(r, 60));
}

beforeEach(() => {
  reiniciarSupabaseFalso();
  sembrarEntidades();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(logger.error).mockClear();
  ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO = WEBHOOK;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ticket de pesaje', () => {
  it('compra completa: PDF al proveedor correcto + álbum con fotos de materiales, pesaje del camión, devolución y vehículo', async () => {
    sembrarTicket();
    estado.rpc.crear_ticket_pesaje = 'T1';

    const r = await crearTicket(inputTicket('compra', P1, 'completo'), 'U1');
    expect('ticket' in r).toBe(true);

    const envios = await esperarEnvios(2);
    expect(envios).toHaveLength(2);
    const [doc, album] = envios;
    expect(doc).toMatchObject({ accion: 'documento', tipoDocumento: 'ticket', entidadTipo: 'proveedor', entidadId: P1, chatId: CHAT_P1 });
    expect(doc.nombreArchivo).toBe('Ticket-Compra-0057-Reciclados-El-Valle-C.A.pdf');
    expect(doc.url).toContain('https://storage.test/firmada/proveedor/');
    expect(doc.mensaje).toContain('Compra-0057');
    expect(album.accion).toBe('fotos');
    expect(album.chatId).toBe(CHAT_P1);
    expect(album.fotos).toHaveLength(5); // 2 material + 1 pesaje global + 1 devolución + 1 vehículo
    expect(album.fotos?.map(f => f.caption).join('|')).toMatch(/Cobre.*Pesaje del camión 1.*Devolución.*Vehículo ZNA GRIS/);
    expect(estado.subidas).toHaveLength(1);
    expect(estado.subidas[0]).toMatchObject({ bucket: 'documentos-telegram', contentType: 'application/pdf' });
    expect(envios.every(e => e.chatId !== CHAT_P2)).toBe(true);
  });

  it('venta completa: se manda al CLIENTE (no a un proveedor)', async () => {
    sembrarTicket({ tipo: 'venta', entidad_id: CL1, numero: 4 });
    estado.rpc.crear_ticket_pesaje = 'T1';

    await crearTicket(inputTicket('venta', CL1, 'completo'), 'U1');

    const [doc] = await esperarEnvios(2);
    expect(doc).toMatchObject({ entidadTipo: 'cliente', entidadId: CL1, chatId: CHAT_CL1, nombreArchivo: 'Ticket-Venta-0004-Fundicion-Norte.pdf' });
  });

  it('ticket en bruto (borrador): no se envía nada', async () => {
    sembrarTicket({ estado: 'bruto' });
    estado.rpc.crear_ticket_pesaje = 'T1';

    await crearTicket(inputTicket('compra', P1, 'bruto'), 'U1');
    await asentar();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(estado.subidas).toHaveLength(0);
  });

  it('completar un ticket en bruto: se envía al quedar completo', async () => {
    sembrarTicket();
    estado.rpc.completar_ticket_pesaje = null;

    const r = await completarTicket('T1', { materiales: [], devolucion: 0, fotosDevolucion: [] } as never, 'U1');
    expect('ticket' in r).toBe(true);

    const [doc] = await esperarEnvios(2);
    expect(doc).toMatchObject({ accion: 'documento', tipoDocumento: 'ticket', chatId: CHAT_P1 });
  });

  it('ticket sin fotos: solo el documento, sin álbum', async () => {
    sembrarTicket({ fotos_devolucion: [], detalle_tickets_pesaje: [{ id: 'D1', producto_id: 'PR1', peso_bruto: 10, tara: 1, devolucion: 0, peso_neto: 9, destino_tipo: 'mpp', fotos: [], productos: { nombre: 'Cobre' } }], pesajes_globales: [], vehiculo: null });
    estado.rpc.crear_ticket_pesaje = 'T1';

    await crearTicket(inputTicket('compra', P1, 'completo'), 'U1');

    const envios = await esperarEnvios(1);
    expect(envios).toHaveLength(1);
    expect(envios[0].accion).toBe('documento');
  });

  it('ticket con más de 10 fotos: varios álbumes de a lo sumo 10 y ninguno de 1 foto', async () => {
    const fotos = Array.from({ length: 11 }, (_, i) => `https://proyecto.supabase.co/storage/v1/object/public/tickets/m${i}.jpg`);
    sembrarTicket({ fotos_devolucion: [], pesajes_globales: [], vehiculo: null, detalle_tickets_pesaje: [{ id: 'D1', producto_id: 'PR1', peso_bruto: 10, tara: 1, devolucion: 0, peso_neto: 9, destino_tipo: 'mpp', fotos, productos: { nombre: 'Cobre' } }] });
    estado.rpc.crear_ticket_pesaje = 'T1';

    await crearTicket(inputTicket('compra', P1, 'completo'), 'U1');

    const envios = await esperarEnvios(3);
    const albumes = envios.filter(e => e.accion === 'fotos');
    expect(albumes.map(a => a.fotos?.length)).toEqual([6, 5]);
  });
});

describe('edición de ticket con llave', () => {
  const actor = { userId: 'U1', email: 'a@pronoia.test', rol: 'admin' as const, llave: undefined };
  const edicion = { materiales: [], devolucion: 0, fotosDevolucion: [], vehiculo: null, observaciones: null } as never;

  it('cambia un peso: reenvía el ticket con aviso "DOCUMENTO CORREGIDO" (sin repetir fotos)', async () => {
    const fila = sembrarTicket();
    estado.rpc.editar_ticket_pesaje = () => {
      (fila.detalle_tickets_pesaje as Array<Record<string, unknown>>)[0].peso_bruto = 700;
      (fila.detalle_tickets_pesaje as Array<Record<string, unknown>>)[0].peso_neto = 650;
      return null;
    };

    const r = await editarTicket('T1', edicion, actor);
    expect('ticket' in r).toBe(true);

    const envios = await esperarEnvios(1);
    expect(envios).toHaveLength(1);
    expect(envios[0]).toMatchObject({ accion: 'documento', tipoDocumento: 'ticket', chatId: CHAT_P1 });
    expect(envios[0].mensaje).toContain('DOCUMENTO CORREGIDO');
    expect(envios[0].nombreArchivo).toBe('Ticket-Compra-0057-Reciclados-El-Valle-C.A-corregido.pdf');
  });

  it('edición sin cambios visibles: no se manda nada', async () => {
    sembrarTicket();
    estado.rpc.editar_ticket_pesaje = null;

    await editarTicket('T1', edicion, actor);
    await asentar();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('edita un ticket facturado y la factura se anula: ticket corregido + factura ANULADA al proveedor', async () => {
    const fila = sembrarTicket({ facturado: true });
    estado.tablas.facturas_compra = [filaFactura('compra', { estado: 'anulada' })];
    estado.rpc.editar_ticket_con_factura = () => {
      (fila.detalle_tickets_pesaje as Array<Record<string, unknown>>)[0].peso_bruto = 700;
      (fila.detalle_tickets_pesaje as Array<Record<string, unknown>>)[0].peso_neto = 650;
      return {
        facturas: [{ tipo: 'compra', facturaId: 'F1', numero: 3, entidadId: P1, total: 500, montoPagado: 0, estadoAnterior: 'emitida', accion: 'anulada', ticketsLiberados: 1 }],
      };
    };

    await editarTicket('T1', edicion, actor);

    const envios = await esperarEnvios(2);
    const corregido = envios.find(e => e.tipoDocumento === 'ticket');
    const anulada = envios.find(e => e.tipoDocumento === 'factura');
    expect(corregido?.mensaje).toContain('DOCUMENTO CORREGIDO');
    expect(anulada).toMatchObject({ accion: 'documento', entidadTipo: 'proveedor', chatId: CHAT_P1 });
    expect(anulada?.mensaje).toContain('FACTURA ANULADA');
    expect(anulada?.mensaje).not.toContain('corrección del ticket'); // el motivo de anulación es interno
    expect(anulada?.mensaje).not.toContain('(');
    expect(anulada?.nombreArchivo).toBe('Factura-C-0003-Reciclados-El-Valle-C.A-anulada.pdf');
  });

  it('factura con pagos (no se anula): solo el ticket corregido, la factura no se toca', async () => {
    const fila = sembrarTicket({ facturado: true });
    estado.rpc.editar_ticket_con_factura = () => {
      (fila.detalle_tickets_pesaje as Array<Record<string, unknown>>)[0].peso_bruto = 700;
      (fila.detalle_tickets_pesaje as Array<Record<string, unknown>>)[0].peso_neto = 650;
      return { facturas: [{ tipo: 'compra', facturaId: 'F1', numero: 3, entidadId: P1, total: 500, montoPagado: 100, estadoAnterior: 'emitida', accion: 'pagada', ticketsLiberados: 0 }] };
    };

    await editarTicket('T1', edicion, actor);

    const envios = await esperarEnvios(1);
    expect(envios.map(e => e.tipoDocumento)).toEqual(['ticket']);
  });
});

describe('facturas', () => {
  it('factura de compra emitida: PDF al proveedor', async () => {
    estado.tablas.facturas_compra = [filaFactura('compra')];
    estado.rpc.crear_factura_compra = 'F1';

    await crearFactura('compra', { entidadId: P1, estado: 'emitida', items: [], ticketIds: [] } as never);

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ accion: 'documento', tipoDocumento: 'factura', entidadTipo: 'proveedor', chatId: CHAT_P1 });
    expect(doc.nombreArchivo).toBe('Factura-C-0003-Reciclados-El-Valle-C.A.pdf');
    expect(doc.mensaje).toContain('C-0003');
  });

  it('factura de venta emitida: PDF al cliente', async () => {
    estado.tablas.facturas_venta = [filaFactura('venta')];
    estado.rpc.crear_factura_venta = 'F1';

    await crearFactura('venta', { entidadId: CL1, estado: 'emitida', items: [], ticketIds: [] } as never);

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ tipoDocumento: 'factura', entidadTipo: 'cliente', chatId: CHAT_CL1, nombreArchivo: 'Factura-V-0003-Fundicion-Norte.pdf' });
  });

  it('factura en borrador: no se envía', async () => {
    estado.tablas.facturas_compra = [filaFactura('compra', { estado: 'borrador' })];
    estado.rpc.crear_factura_compra = 'F1';

    await crearFactura('compra', { entidadId: P1, estado: 'borrador', items: [], ticketIds: [] } as never);
    await asentar();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('notas de crédito / débito', () => {
  it('nota de proveedor creada: PDF de la nota al proveedor', async () => {
    estado.tablas.notas_ajuste_proveedor = [filaNota('proveedor')];

    const r = await crearNotaAjuste(P1, { tipo: 'credito', monto: 50, motivo: 'Ajuste' } as never, 'U1');
    expect('id' in r).toBe(true);

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ accion: 'documento', tipoDocumento: 'nota', entidadTipo: 'proveedor', chatId: CHAT_P1, nombreArchivo: 'Nota-credito-NC-0004-Reciclados-El-Valle-C.A.pdf' });
    expect(doc.mensaje).toContain('NC-0004');
    expect(doc.mensaje).not.toContain('Operador Interno');
    expect(doc.mensaje).not.toContain('Ajuste por diferencia de peso'); // el motivo interno no sale a terceros
  });

  it('nota de proveedor anulada: PDF marcado anulada, sin el motivo interno', async () => {
    estado.tablas.notas_ajuste_proveedor = [filaNota('proveedor', { anulada: true, anulada_at: '2026-10-04T10:00:00Z', anulada_motivo: 'Error de carga' })];
    estado.rpc.anular_nota_ajuste_proveedor = 'N1';

    await anularNotaAjuste(P1, 'N1', 'Error de carga', 'U1');

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ tipoDocumento: 'nota', chatId: CHAT_P1 });
    expect(doc.mensaje).toContain('NOTA ANULADA');
    expect(doc.mensaje).not.toContain('Error de carga'); // el motivo de anulación es interno
  });

  it('nota de débito de cliente creada: al cliente', async () => {
    estado.tablas.notas_ajuste_cliente = [filaNota('cliente', { tipo: 'debito', numero: 2 })];

    await crearNotaAjusteCliente(CL1, { tipo: 'debito', monto: 50, motivo: 'Ajuste' } as never, 'U1');

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ tipoDocumento: 'nota', entidadTipo: 'cliente', chatId: CHAT_CL1, nombreArchivo: 'Nota-debito-NDV-0002-Fundicion-Norte.pdf' });
  });

  it('nota de cliente anulada: al cliente', async () => {
    estado.tablas.notas_ajuste_cliente = [filaNota('cliente', { anulada: true, anulada_motivo: 'Duplicada' })];
    estado.rpc.anular_nota_ajuste_cliente = 'N1';

    await anularNotaAjusteCliente(CL1, 'N1', 'Duplicada', 'U1');

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ tipoDocumento: 'nota', chatId: CHAT_CL1 });
    expect(doc.mensaje).toContain('NOTA ANULADA');
  });
});

describe('pagos, cobros y cruces', () => {
  const FOTO_COMPROBANTE = 'https://proyecto.supabase.co/storage/v1/object/public/comprobantes/c1.jpg';

  it('pago a proveedor (multi-banca) con comprobante: PDF del pago + foto del comprobante bancario', async () => {
    sembrarPago('proveedor');
    estado.rpc.registrar_pago_proveedor_multi_banca = { movimientoPrincipalId: 'M1', movimientoIds: ['M1'], grupoId: GRUPO1, numeroPago: 7, numeroAdelanto: null, numeroCruce: null };

    const r = await registrarPagoMultiple({ proveedorId: P1, bancas: [], montoUsd: 100, items: [], comprobantes: [FOTO_COMPROBANTE] } as never, 'U1');
    expect('grupoId' in r).toBe(true);

    const envios = await esperarEnvios(2);
    const [doc, foto] = envios;
    expect(doc).toMatchObject({ accion: 'documento', tipoDocumento: 'pago', entidadTipo: 'proveedor', chatId: CHAT_P1, nombreArchivo: 'Pago-PG-0007-Reciclados-El-Valle-C.A.pdf' });
    expect(doc.mensaje).toContain('PG-0007');
    expect(foto).toMatchObject({ accion: 'foto', chatId: CHAT_P1 });
    expect(foto.fotos).toEqual([{ url: FOTO_COMPROBANTE, caption: 'Comprobante PG-0007 (1/1)' }]);
  });

  it('pago sin comprobante: igualmente se manda el PDF del pago (sin fotos)', async () => {
    sembrarPago('proveedor');
    estado.rpc.registrar_pago_proveedor_multi_banca = { movimientoPrincipalId: 'M1', movimientoIds: ['M1'], grupoId: GRUPO1, numeroPago: 7, numeroAdelanto: null, numeroCruce: null };

    await registrarPagoMultiple({ proveedorId: P1, bancas: [], montoUsd: 100, items: [], comprobantes: [] } as never, 'U1');

    const envios = await esperarEnvios(1);
    expect(envios).toHaveLength(1);
    expect(envios[0]).toMatchObject({ tipoDocumento: 'pago', chatId: CHAT_P1 });
  });

  it('pago simple (endpoint legacy /pagos): PDF del pago resolviendo su grupo', async () => {
    sembrarPago('proveedor');
    estado.rpc.registrar_pago_proveedor = 'M1';

    const r = await registrarPago({ proveedorId: P1, bancaId: 'B1', monto: 100, moneda: 'USD', montoUsd: 100, comprobantes: [] } as never, 'U1');
    expect(r).toEqual({ movimientoId: 'M1' });

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ tipoDocumento: 'pago', chatId: CHAT_P1 });
  });

  it('cruce puro (sin dinero): comprobante de cruce CR- al proveedor', async () => {
    estado.tablas.cruces = [{ grupo_id: GRUPO9, numero: 1, fecha: '2026-10-03T00:00:00Z', descripcion: null, registrado_por: 'U1', proveedor_id: P1 }];
    estado.tablas.pago_aplicaciones = [{ grupo_id: GRUPO9, tipo: 'adelanto', item_id: 'AD1', monto_usd: 40 }];
    estado.rpc.registrar_pago_proveedor_multi_banca = { movimientoPrincipalId: null, movimientoIds: [], grupoId: GRUPO9, numeroPago: null, numeroAdelanto: null, numeroCruce: 1 };

    await registrarPagoMultiple({ proveedorId: P1, bancas: [], montoUsd: 0, items: [], comprobantes: [] } as never, 'U1');

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ tipoDocumento: 'cruce', chatId: CHAT_P1, nombreArchivo: 'Cruce-CR-0001-Reciclados-El-Valle-C.A.pdf' });
  });

  it('cobro a cliente con comprobante: PDF del cobro + foto, al cliente', async () => {
    sembrarPago('cliente');
    estado.rpc.registrar_cobro_cliente_multi_banca = { movimientoPrincipalId: 'M1', movimientoIds: ['M1'], grupoId: GRUPO1, numeroCobro: 7, numeroAnticipo: null, numeroCruce: null };

    await registrarCobroMultiple({ clienteId: CL1, bancas: [], montoUsd: 100, items: [], comprobantes: [FOTO_COMPROBANTE] } as never, 'U1');

    const [doc, foto] = await esperarEnvios(2);
    expect(doc).toMatchObject({ tipoDocumento: 'pago', entidadTipo: 'cliente', chatId: CHAT_CL1, nombreArchivo: 'Cobro-CB-0007-Fundicion-Norte.pdf' });
    expect(foto).toMatchObject({ accion: 'foto', chatId: CHAT_CL1 });
  });

  it('cruce puro de cliente (CRV-): al cliente', async () => {
    estado.tablas.cruces = [{ grupo_id: GRUPO9, numero: 2, fecha: '2026-10-03T00:00:00Z', descripcion: null, registrado_por: 'U1', cliente_id: CL1 }];
    estado.rpc.registrar_cobro_cliente_multi_banca = { movimientoPrincipalId: null, movimientoIds: [], grupoId: GRUPO9, numeroCobro: null, numeroAnticipo: null, numeroCruce: 2 };

    await registrarCobroMultiple({ clienteId: CL1, bancas: [], montoUsd: 0, items: [], comprobantes: [] } as never, 'U1');

    const [doc] = await esperarEnvios(1);
    expect(doc).toMatchObject({ tipoDocumento: 'cruce', entidadTipo: 'cliente', chatId: CHAT_CL1, nombreArchivo: 'Cruce-CRV-0002-Fundicion-Norte.pdf' });
  });
});

describe('citas de despacho', () => {
  const cita = (e: string) => ({ id: 'C1', entidad_tipo: 'cliente', entidad_id: CL1, fecha: '2026-10-05', hora: '09:00:00', estado: e, notas: null, created_at: '2026-10-03T10:00:00Z' });

  it('cita confirmada por el equipo: mensaje de texto al cliente', async () => {
    estado.tablas.citas_despacho = [cita('pendiente')];

    await actualizarEstadoCita('C1', 'confirmada');

    const [aviso] = await esperarEnvios(1);
    expect(aviso).toMatchObject({ accion: 'mensaje', tipoDocumento: 'cita', entidadTipo: 'cliente', chatId: CHAT_CL1 });
    expect(aviso.mensaje).toContain('2026-10-05');
    expect(aviso.mensaje).toContain('09:00');
    expect(aviso.mensaje).toContain('CONFIRMADA');
  });

  it('el estado no cambió (ya estaba confirmada): no se avisa de nuevo', async () => {
    estado.tablas.citas_despacho = [cita('confirmada')];

    const r = await actualizarEstadoCita('C1', 'confirmada');
    await asentar();

    expect(r).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cita completada: no hay nada que avisar', async () => {
    estado.tablas.citas_despacho = [cita('confirmada')];

    await actualizarEstadoCita('C1', 'completada');
    await asentar();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('garantías comunes a todos los envíos', () => {
  async function dispararFactura(entidadId = P1): Promise<void> {
    estado.tablas.facturas_compra = [filaFactura('compra', { proveedor_id: entidadId })];
    estado.rpc.crear_factura_compra = 'F1';
    await crearFactura('compra', { entidadId, estado: 'emitida', items: [], ticketIds: [] } as never);
    await asentar();
  }

  it('entidad sin Telegram vinculado: no se llama a n8n ni se sube nada a Storage', async () => {
    await dispararFactura(P_SIN_VINCULAR);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(estado.subidas).toHaveLength(0);
  });

  it('falla Storage al subir: no se llama a n8n y el error queda logueado', async () => {
    estado.errorSubida = { message: 'bucket caído' };
    await dispararFactura();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ evento: 'telegram_notify_error_storage' }));
  });

  it('falla la URL firmada: no se llama a n8n', async () => {
    estado.errorFirma = { message: 'sin permiso' };
    await dispararFactura();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ evento: 'telegram_notify_error_signed_url' }));
  });

  it('sin webhook configurado: no se llama a n8n', async () => {
    ENV.N8N_WEBHOOK_ENVIAR_CONTENIDO = '';
    await dispararFactura();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('n8n caído (fetch rechaza): la operación de negocio igual termina bien', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    estado.tablas.facturas_compra = [filaFactura('compra')];
    estado.rpc.crear_factura_compra = 'F1';

    const r = await crearFactura('compra', { entidadId: P1, estado: 'emitida', items: [], ticketIds: [] } as never);
    await asentar();

    expect('factura' in r).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ evento: 'telegram_notify_error_webhook' }));
  });

  it('n8n responde 500: la operación termina bien y se loguea el status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    estado.tablas.facturas_compra = [filaFactura('compra')];
    estado.rpc.crear_factura_compra = 'F1';

    const r = await crearFactura('compra', { entidadId: P1, estado: 'emitida', items: [], ticketIds: [] } as never);
    await asentar();

    expect('factura' in r).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ evento: 'telegram_notify_error_webhook_status', status: 500 }));
  });

  it('la BD no puede leer el contacto: la operación termina bien y no se envía', async () => {
    estado.tablas.facturas_compra = [filaFactura('compra')];
    estado.rpc.crear_factura_compra = 'F1';
    const original = estado.tablas.proveedores;
    estado.tablaQueLanza = 'proveedores'; // obtenerFactura no usa esta tabla; el contacto sí

    const r = await crearFactura('compra', { entidadId: P1, estado: 'emitida', items: [], ticketIds: [] } as never);
    await asentar();

    expect(original).toBeDefined();
    expect('factura' in r).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ evento: 'telegram_notify_error_inesperado' }));
  });
});
