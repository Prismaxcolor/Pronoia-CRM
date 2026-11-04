import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const WEBHOOK = 'https://n8n.test/webhook/enviar-contenido';

vi.mock('../src/config/supabase.js', async () => ({
  supabaseAdmin: (await import('./helpers/supabase-falso')).supabaseAdminFalso,
}));
vi.mock('../src/config/env.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/config/env.js')>();
  return { ENV: { ...original.ENV, N8N_WEBHOOK_ENVIAR_CONTENIDO: 'https://n8n.test/webhook/enviar-contenido' } };
});
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const obtenerEstadoCuenta = vi.fn();
vi.mock('../src/services/estado-cuenta-service.js', () => ({ obtenerEstadoCuenta: (...a: unknown[]) => obtenerEstadoCuenta(...a) }));

import { reiniciarSupabaseFalso } from './helpers/supabase-falso';
import { CHAT_CL1, CHAT_P1, CL1, P1, P_SIN_VINCULAR, sembrarEntidades } from './helpers/fixtures-telegram';
import { enviarEstadoCuentaTelegram } from '../src/services/telegram-estado-cuenta-service.js';

const fetchMock = vi.fn();
const cuerpos = () => fetchMock.mock.calls.filter(([u]) => u === WEBHOOK).map(([, i]) => JSON.parse((i as { body: string }).body));
const asentar = () => new Promise(r => setTimeout(r, 80));

const estadoCuenta = (tipo: 'proveedor' | 'cliente', id: string) => ({
  entidad: { id, tipo, nombre: 'Entidad' },
  entradas: [
    { fecha: '2026-10-01', tipo: 'factura', descripcion: 'Factura', referencia: 'C-0001', cargo: 500, abono: 0, facturaId: 'F1' },
    { fecha: '2026-10-02', tipo: 'pago', descripcion: 'Pago', referencia: 'PG-0001', cargo: 0, abono: 200, pagoId: 'G1' },
    { fecha: '2026-10-02', tipo: 'nota_credito', descripcion: 'secreto interno', referencia: 'NC-0001', cargo: 0, abono: 0, anulada: true, notaId: 'N1' },
  ],
  totales: { facturado: 500, pagado: 200, saldo: 300 },
});

beforeEach(() => {
  reiniciarSupabaseFalso();
  sembrarEntidades();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  obtenerEstadoCuenta.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('estado de cuenta a pedido', () => {
  it('proveedor vinculado: manda el PDF al chat del proveedor y responde ok', async () => {
    obtenerEstadoCuenta.mockResolvedValue(estadoCuenta('proveedor', P1));
    expect(await enviarEstadoCuentaTelegram('proveedor', P1)).toEqual({ ok: true });
    await asentar();
    expect(cuerpos()).toEqual([expect.objectContaining({ accion: 'documento', tipoDocumento: 'estado_cuenta', chatId: CHAT_P1, entidadTipo: 'proveedor' })]);
    expect(cuerpos()[0].mensaje).toContain('Saldo');
  });

  it('cliente vinculado: al chat del cliente', async () => {
    obtenerEstadoCuenta.mockResolvedValue(estadoCuenta('cliente', CL1));
    await enviarEstadoCuentaTelegram('cliente', CL1);
    await asentar();
    expect(cuerpos()[0]).toMatchObject({ chatId: CHAT_CL1, entidadTipo: 'cliente' });
  });

  it('entidad sin Telegram: 409 y no se envía nada', async () => {
    obtenerEstadoCuenta.mockResolvedValue(estadoCuenta('proveedor', P_SIN_VINCULAR));
    expect(await enviarEstadoCuentaTelegram('proveedor', P_SIN_VINCULAR)).toMatchObject({ codigo: 409 });
    await asentar();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('entidad inexistente: 404', async () => {
    obtenerEstadoCuenta.mockResolvedValue(null);
    expect(await enviarEstadoCuentaTelegram('proveedor', P1)).toMatchObject({ codigo: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
