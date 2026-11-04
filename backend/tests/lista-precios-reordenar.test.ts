import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: { rpc } }));

import { reordenarPrecios, MENSAJE_ORDEN_NO_HABILITADO } from '../src/services/lista-precios-service.js';

const LISTA = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

beforeEach(() => rpc.mockReset());

describe('reordenarPrecios', () => {
  it('hace UNA sola llamada atómica a la RPC con el orden completo', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await reordenarPrecios(LISTA, [B, A])).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('reordenar_precios_lista', { p_lista_id: LISTA, p_producto_ids: [B, A] });
  });

  it('devuelve el mensaje de negocio cuando la RPC rechaza el orden (faltantes/ajenos/duplicados)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'El orden no incluye todos los materiales de la lista; recarga e intenta de nuevo.' },
    });
    expect(await reordenarPrecios(LISTA, [A])).toEqual({
      error: 'El orden no incluye todos los materiales de la lista; recarga e intenta de nuevo.',
    });
  });

  it('migración sin aplicar: mensaje claro', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await reordenarPrecios(LISTA, [A])).toEqual({ error: MENSAJE_ORDEN_NO_HABILITADO });
  });

  it('error técnico no filtra detalles internos', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "x"' } });
    const r = await reordenarPrecios('x', [A]);
    expect('error' in r && r.error).not.toMatch(/uuid|syntax/);
  });
});
