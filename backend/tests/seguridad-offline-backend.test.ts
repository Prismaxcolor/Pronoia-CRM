import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { z } from 'zod';

const storageUpload = vi.fn();
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
    storage: { from: () => ({ upload: storageUpload, getPublicUrl: (n: string) => ({ data: { publicUrl: `https://x/${n}` } }) }) },
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => 'ip' }));
vi.mock('../src/middlewares/require-auth.js', () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { sub: 'u1' }; next(); },
  requirePermiso: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const ejecutarIdempotente = vi.fn(async (_id: string, _tipo: string, _u: string, fn: () => Promise<unknown>) => ({ resultado: await fn(), repetida: false }));
vi.mock('../src/services/idempotencia-service.js', () => ({
  ejecutarIdempotente: (...a: Parameters<typeof ejecutarIdempotente>) => ejecutarIdempotente(...a),
  buscarIdPorClientRequestId: vi.fn(),
}));
vi.mock('../src/services/ticket-pesaje-service.js', () => ({ crearTicket: vi.fn(), completarTicket: vi.fn(async () => ({ error: 'x' })), obtenerTicket: vi.fn() }));
vi.mock('../src/services/traslado-service.js', () => ({ crearTraslado: vi.fn(), completarTraslado: vi.fn(async () => ({ error: 'x' })), obtenerTraslado: vi.fn() }));

const { acotarCapturadoEn, clienteOperacionCampos, MAX_DESFASE_CAPTURA_MS } = await import('../src/schemas/cliente-operacion.js');
const { tipoDeRecurso, TIPO_OPERACION } = await import('../src/services/operaciones-idempotentes-cola.js');
const { completarTicketIdempotente, completarTrasladoIdempotente } = await import('../src/services/operaciones-idempotentes.js');
const { detectarFormatoImagen, infoFormatoImagen } = await import('../src/utils/firma-imagen.js');
const { default: uploadsRouter } = await import('../src/routes/uploads.js');
const { default: express } = await import('express');

const ID = '11111111-1111-4111-8111-111111111111';

describe('capturadoEn acotado a ±24 h del servidor', () => {
  const AHORA = Date.parse('2026-10-07T12:00:00.000Z');

  it('una fecha dentro del rango se conserva', () => {
    expect(acotarCapturadoEn('2026-10-07T08:30:00Z', AHORA)).toBe('2026-10-07T08:30:00.000Z');
  });

  it('una fecha futura (reloj adelantado) se recorta a ahora + 24 h', () => {
    expect(acotarCapturadoEn('2030-01-01T00:00:00Z', AHORA)).toBe(new Date(AHORA + MAX_DESFASE_CAPTURA_MS).toISOString());
  });

  it('una fecha muy antigua se recorta a ahora - 24 h', () => {
    expect(acotarCapturadoEn('2001-01-01T00:00:00Z', AHORA)).toBe(new Date(AHORA - MAX_DESFASE_CAPTURA_MS).toISOString());
  });

  it('el esquema aplica el recorte y sigue aceptando que falte', () => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
    const esquema = z.object(clienteOperacionCampos);
    expect(esquema.parse({ capturadoEn: '2001-01-01T00:00:00Z' }).capturadoEn).toBe(new Date(AHORA - MAX_DESFASE_CAPTURA_MS).toISOString());
    expect(esquema.parse({}).capturadoEn).toBeUndefined();
    expect(esquema.safeParse({ capturadoEn: 'no-es-fecha' }).success).toBe(false);
    vi.useRealTimers();
  });
});

describe('la clave de idempotencia de completar queda ligada al recurso', () => {
  beforeEach(() => { ejecutarIdempotente.mockClear(); });

  it('ticket_completar incluye el id del ticket', async () => {
    await completarTicketIdempotente('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { clientRequestId: ID } as never, 'u1');
    expect(ejecutarIdempotente.mock.calls[0][1]).toBe('ticket_completar:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('el mismo UUID sobre otro ticket produce un tipo distinto (la BD responde conflicto 409)', async () => {
    await completarTicketIdempotente('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { clientRequestId: ID } as never, 'u1');
    await completarTicketIdempotente('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { clientRequestId: ID } as never, 'u1');
    expect(ejecutarIdempotente.mock.calls[0][1]).not.toBe(ejecutarIdempotente.mock.calls[1][1]);
  });

  it('traslado_completar incluye el id del traslado', async () => {
    await completarTrasladoIdempotente('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { clientRequestId: ID } as never, 'u1');
    expect(ejecutarIdempotente.mock.calls[0][1]).toBe('traslado_completar:cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('tipoDeRecurso para los tipos de F4', () => {
    expect(tipoDeRecurso(TIPO_OPERACION.transformacionPcbCompletar, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe('transformacion_pcb_completar:dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(tipoDeRecurso(TIPO_OPERACION.packingListEditar, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBe('packing_list_editar:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  });
});

describe('detectarFormatoImagen', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

  it('reconoce JPEG, PNG y WEBP', () => {
    expect(detectarFormatoImagen(jpeg)).toBe('jpeg');
    expect(detectarFormatoImagen(png)).toBe('png');
    expect(detectarFormatoImagen(webp)).toBe('webp');
    expect(infoFormatoImagen('jpeg')).toEqual({ mime: 'image/jpeg', extension: 'jpg' });
  });

  it('rechaza HTML, SVG, GIF, RIFF que no es WEBP y buffers vacíos o cortos', () => {
    const texto = (s: string) => new TextEncoder().encode(s);
    expect(detectarFormatoImagen(texto('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectarFormatoImagen(texto('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectarFormatoImagen(texto('GIF89a....'))).toBeNull();
    expect(detectarFormatoImagen(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    expect(detectarFormatoImagen(new Uint8Array())).toBeNull();
    expect(detectarFormatoImagen(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('POST /uploads/:tipo', () => {
  const app = express();
  app.use('/api/uploads', uploadsRouter);
  let base = '';
  let servidor: import('node:http').Server;

  beforeEach(async () => {
    storageUpload.mockReset();
    storageUpload.mockResolvedValue({ error: null });
    if (base) return;
    servidor = await new Promise<import('node:http').Server>(res => { const s = app.listen(0, () => res(s)); });
    base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}/api/uploads`;
  });
  afterAll(() => new Promise<void>(res => { if (servidor) servidor.close(() => res()); else res(); }));

  async function subir(bytes: Uint8Array, nombre: string, mime: string) {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: mime }), nombre);
    const r = await fetch(`${base}/productos`, { method: 'POST', body: fd });
    return { status: r.status, cuerpo: (await r.json()) as { url?: string; error?: string } };
  }

  it('una imagen real se sube con extensión y contentType tomados de su firma, no del nombre', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = await subir(png, 'foto.php', 'image/png');
    expect(r.status).toBe(201);
    expect(r.cuerpo.url).toMatch(/\.png$/);
    expect(storageUpload).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}\.png$/), expect.anything(), { contentType: 'image/png' });
  });

  it('contenido que no es imagen con MIME falso image/jpeg se rechaza (400) y no llega a Storage', async () => {
    const r = await subir(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'a.jpg', 'image/jpeg');
    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toMatch(/imagen válida/);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('un JPEG declarado como PNG se sube con el tipo real (image/jpeg, .jpg)', async () => {
    const r = await subir(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]), 'x.png', 'image/png');
    expect(r.status).toBe(201);
    expect(storageUpload).toHaveBeenCalledWith(expect.stringMatching(/\.jpg$/), expect.anything(), { contentType: 'image/jpeg' });
  });
});
