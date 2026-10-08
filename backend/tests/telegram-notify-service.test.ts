import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { estado, reiniciarSupabaseFalso } from './helpers/supabase-falso';
import { CHAT_P1, P1, P_SIN_VINCULAR, sembrarEntidades } from './helpers/fixtures-telegram';
import {
  entidadVinculada,
  notificarDocumento,
  notificarMensaje,
  repartirFotos,
  type FotoEnvio,
} from '../src/services/telegram-notify-service.js';

const fetchMock = vi.fn();
const foto = (n: number): FotoEnvio => ({ url: `https://cdn.test/f${n}.jpg`, caption: `Foto ${n}` });
const fotos = (n: number) => Array.from({ length: n }, (_, i) => foto(i + 1));
const cuerpos = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body));
const pdf = (extra: Record<string, unknown> = {}) => ({ buffer: Buffer.from('%PDF-1.4'), nombreArchivo: 'doc.pdf', ...extra });

beforeEach(() => {
  reiniciarSupabaseFalso();
  sembrarEntidades();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('repartirFotos', () => {
  it('0 fotos: nada', () => expect(repartirFotos([])).toEqual([]));
  it('1 foto: un grupo de 1 (se manda como foto suelta)', () => expect(repartirFotos(fotos(1)).map(g => g.length)).toEqual([1]));
  it('10 fotos: un solo álbum', () => expect(repartirFotos(fotos(10)).map(g => g.length)).toEqual([10]));
  it('11 fotos: 6 + 5, nunca 10 + 1', () => expect(repartirFotos(fotos(11)).map(g => g.length)).toEqual([6, 5]));
  it('21 fotos: 7 + 7 + 7', () => expect(repartirFotos(fotos(21)).map(g => g.length)).toEqual([7, 7, 7]));
  it('todos los álbumes tienen entre 2 y 10 fotos cuando hay 2 o más', () => {
    for (let n = 2; n <= 60; n++) {
      for (const g of repartirFotos(fotos(n))) {
        expect(g.length).toBeGreaterThanOrEqual(2);
        expect(g.length).toBeLessThanOrEqual(10);
      }
    }
  });
  it('descarta urls que no son https y duplicadas', () => {
    const lista = [foto(1), foto(1), { url: 'http://inseguro.test/x.jpg' }, { url: 'file:///etc/passwd' }, foto(2)];
    expect(repartirFotos(lista).flat().map(f => f.url)).toEqual(['https://cdn.test/f1.jpg', 'https://cdn.test/f2.jpg']);
  });
});

describe('notificarDocumento: clave de Storage', () => {
  it('el nombre de archivo se sanea: sin tildes, sin caracteres de ruta, largo acotado', async () => {
    await notificarDocumento({
      entidadTipo: 'proveedor',
      entidadId: P1,
      tipoDocumento: 'estado_cuenta',
      preparar: () => pdf({ nombreArchivo: '../Napoleón Dávila/estado de cuenta ñ.pdf' }),
    });

    expect(estado.subidas).toHaveLength(1);
    const resto = estado.subidas[0].ruta.replace(`proveedor/${P1}/`, '');
    expect(resto).toMatch(/^\d+-[a-z0-9._-]+\.pdf$/);
    expect(resto).not.toContain('/');
    expect(resto.length).toBeLessThanOrEqual(80 + 14);
    // al webhook sigue yendo el nombre original, para que el proveedor vea un nombre legible
    expect(cuerpos()[0].nombreArchivo).toBe('../Napoleón Dávila/estado de cuenta ñ.pdf');
  });
});

describe('notificarDocumento', () => {
  it('manda el documento y después las fotos, en ese orden', async () => {
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'ticket', preparar: () => pdf({ mensaje: 'Hola', fotos: fotos(3) }) });

    const c = cuerpos();
    expect(c.map(x => x.accion)).toEqual(['documento', 'fotos']);
    expect(c[0]).toMatchObject({ chatId: CHAT_P1, mensaje: 'Hola', nombreArchivo: 'doc.pdf', entidadId: P1 });
    expect(c[1].fotos).toHaveLength(3);
  });

  it('una sola foto viaja como accion "foto"', async () => {
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'ticket', preparar: () => pdf({ fotos: fotos(1) }) });
    expect(cuerpos().map(x => x.accion)).toEqual(['documento', 'foto']);
  });

  it('si falla Storage no se manda ni el documento ni las fotos', async () => {
    estado.errorSubida = { message: 'x' };
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'ticket', preparar: () => pdf({ fotos: fotos(3) }) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('entidad sin vincular: ni siquiera se genera el documento', async () => {
    const preparar = vi.fn(() => pdf());
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P_SIN_VINCULAR, tipoDocumento: 'ticket', preparar });
    expect(preparar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si preparar lanza (p. ej. dato no encontrado) no rompe ni manda nada', async () => {
    await expect(
      notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'nota', preparar: () => { throw new Error('nota no existe'); } })
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un álbum que falla no impide mandar el siguiente', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue({ ok: true, status: 200 });
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'ticket', preparar: () => pdf({ fotos: fotos(11) }) });
    expect(fetchMock).toHaveBeenCalledTimes(3); // documento + 2 álbumes
  });

  it('recorta el pie a 1000 caracteres (límite de Telegram: 1024)', async () => {
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'ticket', preparar: () => pdf({ mensaje: 'x'.repeat(3000) }) });
    expect(cuerpos()[0].mensaje.length).toBeLessThanOrEqual(1000);
  });

  it('comprobante en imagen: respeta el contentType al subir', async () => {
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'comprobante', preparar: () => pdf({ contentType: 'image/png', nombreArchivo: 'c.png' }) });
    expect(estado.subidas[0].contentType).toBe('image/png');
  });
});

describe('notificarMensaje y entidadVinculada', () => {
  it('manda texto con accion "mensaje" al chat de la entidad', async () => {
    await notificarMensaje({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'aviso', mensaje: n => `Hola ${n}` });
    expect(cuerpos()).toEqual([expect.objectContaining({ accion: 'mensaje', chatId: CHAT_P1, mensaje: 'Hola Reciclados El Valle C.A.' })]);
  });

  it('entidad sin vincular: no manda nada', async () => {
    await notificarMensaje({ entidadTipo: 'proveedor', entidadId: P_SIN_VINCULAR, tipoDocumento: 'aviso', mensaje: 'x' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('entidadVinculada distingue vinculado, sin vincular e inexistente', async () => {
    expect(await entidadVinculada('proveedor', P1)).toBe(true);
    expect(await entidadVinculada('proveedor', P_SIN_VINCULAR)).toBe(false);
    expect(await entidadVinculada('proveedor', '99999999-9999-4999-8999-999999999999')).toBe(false);
  });
});

describe('contrato con n8n', () => {
  it('toda llamada va al webhook v2 configurado, por POST JSON', async () => {
    await notificarDocumento({ entidadTipo: 'proveedor', entidadId: P1, tipoDocumento: 'ticket', preparar: () => pdf() });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
  });
});
