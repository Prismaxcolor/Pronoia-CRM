import { describe, it, expect, vi, beforeEach } from 'vitest';

/** BD falsa mínima: emula la función SQL reclamar_operacion_cliente sobre un Map. */
interface Fila { estado: 'procesando' | 'ok' | 'error'; usuario: string; tipo: string; resultado?: unknown; entidad?: string | null; error?: string | null; vencida?: boolean }
const filas = new Map<string, Fila>();
const estado = { funcionInexistente: false, falloReclamo: false, falloUpdates: 0 };

const rpc = vi.fn(async (_nombre: string, p: Record<string, string>) => {
  if (estado.funcionInexistente) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  if (estado.falloReclamo) return { data: null, error: { code: 'XX000', message: 'boom' } };
  const id = p.p_client_request_id;
  const f = filas.get(id);
  if (!f) {
    filas.set(id, { estado: 'procesando', usuario: p.p_usuario_id, tipo: p.p_tipo });
    return { data: { accion: 'ejecutar' }, error: null };
  }
  if (f.usuario !== p.p_usuario_id || f.tipo !== p.p_tipo) return { data: { accion: 'conflicto' }, error: null };
  if (f.estado === 'ok') return { data: { accion: 'repetida', resultado: f.resultado, entidad_id: f.entidad }, error: null };
  if (f.estado === 'error' || f.vencida) {
    f.estado = 'procesando'; f.vencida = false;
    return { data: { accion: 'ejecutar', retomada: true }, error: null };
  }
  return { data: { accion: 'en_proceso' }, error: null };
});

const from = vi.fn(() => ({
  update: (cambios: Record<string, unknown>) => ({
    eq: async (_c: string, id: string) => {
      if (estado.falloUpdates > 0) { estado.falloUpdates -= 1; return { error: { message: 'fallo update' } }; }
      const f = filas.get(id);
      if (f) Object.assign(f, { estado: cambios.estado, resultado: cambios.resultado ?? f.resultado, entidad: cambios.entidad_id ?? f.entidad, error: cambios.error });
      return { error: null };
    },
  }),
}));

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: { rpc, from } }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { ejecutarIdempotente, ErrorIdempotencia, responderErrorIdempotencia } = await import('../src/services/idempotencia-service.js');

const ID = '11111111-1111-4111-8111-111111111111';
const USUARIO = 'u1';

beforeEach(() => {
  filas.clear();
  estado.funcionInexistente = false;
  estado.falloReclamo = false;
  estado.falloUpdates = 0;
  rpc.mockClear();
});

describe('ejecutarIdempotente', () => {
  it('ejecuta fn la primera vez y guarda el resultado', async () => {
    const fn = vi.fn(async () => ({ ticket: { id: 't1' } }));
    const r = await ejecutarIdempotente(ID, 'ticket_pesaje', USUARIO, fn, { entidadId: x => x.ticket.id });
    expect(r).toEqual({ resultado: { ticket: { id: 't1' } }, repetida: false });
    expect(filas.get(ID)).toMatchObject({ estado: 'ok', entidad: 't1' });
  });

  it('un reintento con el mismo id devuelve el resultado guardado sin ejecutar fn', async () => {
    const fn = vi.fn(async () => ({ ticket: { id: 't1' } }));
    await ejecutarIdempotente(ID, 'ticket_pesaje', USUARIO, fn);
    const otra = vi.fn(async () => ({ ticket: { id: 'DUPLICADO' } }));
    const r = await ejecutarIdempotente(ID, 'ticket_pesaje', USUARIO, otra);
    expect(otra).not.toHaveBeenCalled();
    expect(r).toEqual({ resultado: { ticket: { id: 't1' } }, repetida: true });
  });

  it('dos envíos simultáneos: uno ejecuta y el otro recibe 409 reintentable', async () => {
    let liberar!: () => void;
    const espera = new Promise<void>(res => { liberar = res; });
    const lento = vi.fn(async () => { await espera; return { ticket: { id: 't1' } }; });
    const primero = ejecutarIdempotente(ID, 'ticket_pesaje', USUARIO, lento);
    await Promise.resolve();
    const segundo = ejecutarIdempotente(ID, 'ticket_pesaje', USUARIO, vi.fn());
    await expect(segundo).rejects.toMatchObject({ status: 409, reintentar: true });
    liberar();
    await expect(primero).resolves.toMatchObject({ repetida: false });
    expect(lento).toHaveBeenCalledTimes(1);
  });

  it('si fn lanza, marca error y un reintento vuelve a ejecutar', async () => {
    await expect(ejecutarIdempotente(ID, 't', USUARIO, async () => { throw new Error('caída'); })).rejects.toThrow('caída');
    expect(filas.get(ID)?.estado).toBe('error');
    const r = await ejecutarIdempotente(ID, 't', USUARIO, async () => ({ ok: 1 }));
    expect(r.repetida).toBe(false);
    expect(filas.get(ID)?.estado).toBe('ok');
  });

  it('un resultado con error de negocio queda en error y permite reintentar', async () => {
    const r = await ejecutarIdempotente(ID, 't', USUARIO, async () => ({ error: 'Stock insuficiente' }));
    expect(r.resultado).toEqual({ error: 'Stock insuficiente' });
    expect(filas.get(ID)).toMatchObject({ estado: 'error', error: 'Stock insuficiente' });
  });

  it('procesando vencido: usa buscarExistente en vez de duplicar', async () => {
    filas.set(ID, { estado: 'procesando', usuario: USUARIO, tipo: 't', vencida: true });
    const fn = vi.fn(async () => ({ ticket: { id: 'NUEVO' } }));
    const r = await ejecutarIdempotente(ID, 't', USUARIO, fn, {
      buscarExistente: async () => ({ ticket: { id: 'previo' } }),
      entidadId: x => x.ticket.id,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(r).toEqual({ resultado: { ticket: { id: 'previo' } }, repetida: true });
    expect(filas.get(ID)).toMatchObject({ estado: 'ok', entidad: 'previo' });
  });

  it('procesando vencido sin registro previo: ejecuta de nuevo', async () => {
    filas.set(ID, { estado: 'procesando', usuario: USUARIO, tipo: 't', vencida: true });
    const fn = vi.fn(async () => ({ ok: 1 }));
    const r = await ejecutarIdempotente(ID, 't', USUARIO, fn, { buscarExistente: async () => null });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.repetida).toBe(false);
  });

  it('el mismo id de otro usuario es un conflicto no reintentable', async () => {
    await ejecutarIdempotente(ID, 't', USUARIO, async () => ({ ok: 1 }));
    await expect(ejecutarIdempotente(ID, 't', 'otro', vi.fn())).rejects.toMatchObject({ status: 409, reintentar: false });
  });

  it('rechaza ids que no son UUID antes de tocar la BD', async () => {
    await expect(ejecutarIdempotente('abc', 't', USUARIO, vi.fn())).rejects.toBeInstanceOf(ErrorIdempotencia);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sin la migración aplicada FALLA CERRADO: 503 reintentable y no ejecuta fn', async () => {
    estado.funcionInexistente = true;
    const fn = vi.fn(async () => ({ ok: 1 }));
    await expect(ejecutarIdempotente(ID, 't', USUARIO, fn)).rejects.toMatchObject({ status: 503, reintentar: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('si falta la tabla (42P01 dentro de la función) también falla cerrado', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'relation "operaciones_cliente" does not exist' } });
    const fn = vi.fn();
    await expect(ejecutarIdempotente(ID, 't', USUARIO, fn)).rejects.toMatchObject({ status: 503, reintentar: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('si el reclamo falla por otra causa NO ejecuta fn y pide reintentar (503)', async () => {
    estado.falloReclamo = true;
    const fn = vi.fn();
    await expect(ejecutarIdempotente(ID, 't', USUARIO, fn)).rejects.toMatchObject({ status: 503, reintentar: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('si no se puede persistir el resultado, igual devuelve el éxito (el registro queda procesando)', async () => {
    estado.falloUpdates = 5;
    const r = await ejecutarIdempotente(ID, 't', USUARIO, async () => ({ ok: 1 }));
    expect(r.resultado).toEqual({ ok: 1 });
    expect(filas.get(ID)?.estado).toBe('procesando');
  });
});

describe('responderErrorIdempotencia', () => {
  it('responde con el estado y la marca reintentar', () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    const atendido = responderErrorIdempotencia(res as never, new ErrorIdempotencia('espera', 409, true));
    expect(atendido).toBe(true);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: 'espera', reintentar: true });
  });

  it('ignora errores ajenos', () => {
    expect(responderErrorIdempotencia({} as never, new Error('x'))).toBe(false);
  });
});
