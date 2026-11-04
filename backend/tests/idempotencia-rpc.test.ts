import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const update = vi.fn();
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ update: (c: unknown) => ({ eq: async (...a: unknown[]) => { update(c, ...a); return { error: null }; } }) }),
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { llamarRpcCrear } = await import('../src/services/idempotencia-service.js');

const ID = '11111111-1111-4111-8111-111111111111';
const PARAMS = { p_tipo: 'compra', p_vehiculo: null };

beforeEach(() => { rpc.mockReset(); update.mockReset(); });

describe('llamarRpcCrear', () => {
  it('sin clientRequestId usa el RPC original tal cual', async () => {
    rpc.mockResolvedValue({ data: 'id1', error: null });
    await llamarRpcCrear('crear_ticket_pesaje', 'tickets_pesaje', PARAMS, {});
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('crear_ticket_pesaje', PARAMS);
  });

  it('con clientRequestId llama al envoltorio _idem con id y capturadoEn, sin marcar aparte', async () => {
    rpc.mockResolvedValue({ data: 'id1', error: null });
    const r = await llamarRpcCrear('crear_traslado', 'tickets_traslado', PARAMS, { clientRequestId: ID, capturadoEn: '2026-10-07T10:00:00Z' });
    expect(r.data).toBe('id1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('crear_traslado_idem', { p_client_request_id: ID, p_capturado_en: '2026-10-07T10:00:00Z', ...PARAMS });
    expect(update).not.toHaveBeenCalled();
  });

  it('si el envoltorio no existe FALLA CERRADO (503 reintentable) y no crea con el original', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(llamarRpcCrear('crear_ticket_pesaje', 'tickets_pesaje', PARAMS, { clientRequestId: ID }))
      .rejects.toMatchObject({ status: 503, reintentar: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith('crear_ticket_pesaje', PARAMS);
    expect(update).not.toHaveBeenCalled();
  });

  it('un error real del envoltorio se devuelve y NO se reintenta con el original', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Stock insuficiente' } });
    const r = await llamarRpcCrear('crear_ticket_pesaje', 'tickets_pesaje', PARAMS, { clientRequestId: ID });
    expect(r.error?.message).toBe('Stock insuficiente');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
