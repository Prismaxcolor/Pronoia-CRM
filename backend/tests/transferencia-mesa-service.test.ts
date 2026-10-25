import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
interface Resp { data: unknown; error: { code?: string; message: string } | null }

const bd = vi.hoisted(() => ({
  bancas: [] as Fila[],
  bancasError: null as { code?: string; message: string } | null,
  movimiento: null as Fila | null,
  rpcResp: { data: null, error: null } as { data: unknown; error: { code?: string; message: string } | null },
  llamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  updates: [] as Array<{ tabla: string; valores: Fila }>,
  updateError: null as { message: string } | null,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      bd.llamadas.push({ fn, args });
      return Promise.resolve(bd.rpcResp);
    },
    from: (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'eq']) c[m] = () => c;
      c.update = (valores: Fila) => {
        bd.updates.push({ tabla, valores });
        return c;
      };
      c.maybeSingle = () => Promise.resolve({ data: bd.movimiento, error: null } satisfies Resp);
      c.then = (ok: (r: Resp) => unknown) => {
        const esUpdate = bd.updates.some(u => u.tabla === tabla);
        const resp: Resp = esUpdate && tabla === 'movimientos'
          ? { data: null, error: bd.updateError }
          : { data: bd.bancasError ? null : bd.bancas, error: bd.bancasError };
        return Promise.resolve(resp).then(ok);
      };
      return c;
    },
  },
}));

import { completarTransferenciaMesa, crearTransferenciaMesa } from '../src/services/transferencia-mesa-service.js';
import type { CrearTransferenciaMesaInput } from '../src/schemas/transferencia-mesa.js';

const U = '11111111-1111-4111-8111-111111111111';
const origen = { id: 'b-o', moneda: 'USD', saldo: 5000, archivada: false };
const destino = { id: 'b-d', moneda: 'USD', saldo: 0, archivada: false };

const input = (extra: Partial<CrearTransferenciaMesaInput> = {}): CrearTransferenciaMesaInput => ({
  cambistaId: 'c-1', bancaId: 'b-o', bancaDestinoId: 'b-d', monto: 1000, montoDestino: null, montoUsd: null,
  comision: { modo: 'porcentaje', valor: 2 }, descripcion: 'Cambio', referencia: null, fecha: '2026-10-11', comprobantes: [], ...extra,
});

const filaMovimiento = (extra: Fila = {}): Fila => ({
  id: 'm-1', tipo: 'transferencia', monto: 1000, moneda: 'USD', descripcion: 'Cambio', banca_origen_id: 'b-o', banca_destino_id: 'b-d',
  fecha: '2026-10-11', referencia: '', registrado_por: U, creado_en: '2026-10-11T10:00:00Z', anulado: false,
  mesa_cambista_id: 'c-1', mesa_estado: 'en_proceso', mesa_monto_bruto: 1000, mesa_comision: 20, ...extra,
});

beforeEach(() => {
  bd.bancas = [origen, destino];
  bd.bancasError = null;
  bd.movimiento = filaMovimiento();
  bd.rpcResp = { data: { movimientoId: 'm-1', numeroSistema: 7, asientoId: 'a-1', asientoNumero: 3, montoUsd: 1000, montoBruto: 1000, comision: 20, montoNeto: 980 }, error: null };
  bd.llamadas = [];
  bd.updates = [];
  bd.updateError = null;
});

describe('crearTransferenciaMesa', () => {
  it('llama a la RPC con los valores del formulario y devuelve la transferencia en proceso', async () => {
    const r = await crearTransferenciaMesa(input(), U);
    expect(bd.llamadas).toHaveLength(1);
    expect(bd.llamadas[0].fn).toBe('crear_transferencia_mesa_cambio');
    expect(bd.llamadas[0].args).toMatchObject({
      p_cambista_id: 'c-1', p_banca_origen_id: 'b-o', p_banca_destino_id: 'b-d', p_monto: 1000, p_monto_destino: null,
      p_comision_modo: 'porcentaje', p_comision_valor: 2, p_usuario: U, p_fecha: '2026-10-11',
    });
    expect(r).toMatchObject({ transferencia: { movimiento: { id: 'm-1', mesaEstado: 'en_proceso' }, asientoNumero: 3, comision: 20, montoNeto: 980 } });
  });

  it('sin comision manda modo y valor nulos', async () => {
    await crearTransferenciaMesa(input({ comision: null }), U);
    expect(bd.llamadas[0].args).toMatchObject({ p_comision_modo: null, p_comision_valor: null });
  });

  it('saldo insuficiente se rechaza con 400 sin llamar a la RPC', async () => {
    bd.bancas = [{ ...origen, saldo: 10 }, destino];
    const r = await crearTransferenciaMesa(input(), U);
    expect(r).toMatchObject({ codigo: 400 });
    expect(bd.llamadas).toHaveLength(0);
  });

  it('monedas distintas sin monto destino se rechaza', async () => {
    bd.bancas = [origen, { ...destino, moneda: 'VES' }];
    expect(await crearTransferenciaMesa(input(), U)).toMatchObject({ codigo: 400 });
    expect(bd.llamadas).toHaveLength(0);
  });

  it('VES a VES exige el equivalente en USD', async () => {
    bd.bancas = [{ ...origen, moneda: 'VES' }, { ...destino, moneda: 'VES' }];
    expect(await crearTransferenciaMesa(input(), U)).toMatchObject({ codigo: 400 });
    await crearTransferenciaMesa(input({ montoUsd: 25 }), U);
    expect(bd.llamadas[0].args).toMatchObject({ p_monto_usd: 25 });
  });

  it('una cuenta inexistente o archivada se rechaza (falla cerrado)', async () => {
    bd.bancas = [origen];
    expect(await crearTransferenciaMesa(input(), U)).toMatchObject({ codigo: 404 });
    bd.bancas = [origen, { ...destino, archivada: true }];
    expect(await crearTransferenciaMesa(input(), U)).toMatchObject({ codigo: 409 });
    expect(bd.llamadas).toHaveLength(0);
  });

  it('si no se puede leer las cuentas no se crea nada', async () => {
    bd.bancasError = { code: '08006', message: 'caida' };
    expect(await crearTransferenciaMesa(input(), U)).toMatchObject({ codigo: 500 });
    expect(bd.llamadas).toHaveLength(0);
  });

  it('migracion sin aplicar (funcion inexistente) => 503 con mensaje claro', async () => {
    bd.rpcResp = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const r = await crearTransferenciaMesa(input(), U);
    expect(r).toMatchObject({ codigo: 503 });
    expect('error' in r && r.error).toContain('migration_mesa_cambio_transferencias.sql');
  });

  it('un raise de negocio de la RPC se muestra tal cual con 409', async () => {
    bd.rpcResp = { data: null, error: { code: 'P0001', message: 'El cambista está inactivo: actívalo para usarlo en una transferencia.' } };
    expect(await crearTransferenciaMesa(input(), U)).toEqual({ error: 'El cambista está inactivo: actívalo para usarlo en una transferencia.', codigo: 409 });
  });

  it('un guardian con errcode 42501 se traduce a 409 con su mensaje de negocio, no a 500', async () => {
    const mensaje = 'Este asiento nace de una transferencia con mesa de cambio: anula o completa la transferencia desde Wallet.';
    bd.rpcResp = { data: null, error: { code: '42501', message: mensaje } };
    expect(await crearTransferenciaMesa(input(), U)).toEqual({ error: mensaje, codigo: 409 });
    expect(await completarTransferenciaMesa('m-1', U)).toEqual({ error: mensaje, codigo: 409 });
  });

  it('un error nativo de privilegios (42501 en ingles) sigue siendo 500 generico', async () => {
    bd.rpcResp = { data: null, error: { code: '42501', message: 'permission denied for table cambista_asientos' } };
    const r = await crearTransferenciaMesa(input(), U);
    expect(r).toMatchObject({ codigo: 500 });
    expect('error' in r && r.error).not.toContain('cambista_asientos');
  });

  it('con una cuenta en USD rechaza un equivalente en USD manual (400, sin llamar a la RPC)', async () => {
    const r = await crearTransferenciaMesa(input({ montoUsd: 25 }), U);
    expect(r).toMatchObject({ codigo: 400, error: expect.stringContaining('USD') });
    expect(bd.llamadas).toHaveLength(0);
  });

  it('un error tecnico no filtra el mensaje crudo de la BD', async () => {
    bd.rpcResp = { data: null, error: { code: 'XX000', message: 'relation "movimientos" secreta' } };
    const r = await crearTransferenciaMesa(input(), U);
    expect(r).toMatchObject({ codigo: 500 });
    expect('error' in r && r.error).not.toContain('secreta');
  });

  it('adjunta los comprobantes con un update y avisa si falla (la transferencia ya existe)', async () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/comprobantes/a.png';
    await crearTransferenciaMesa(input({ comprobantes: [url] }), U);
    expect(bd.updates).toEqual([{ tabla: 'movimientos', valores: { comprobantes: [url] } }]);

    bd.updates = [];
    bd.updateError = { message: 'fallo' };
    const r = await crearTransferenciaMesa(input({ comprobantes: [url] }), U);
    expect(r).toMatchObject({ transferencia: { advertencia: expect.stringContaining('comprobante') } });
  });

  it('sin comprobantes no toca la columna', async () => {
    await crearTransferenciaMesa(input(), U);
    expect(bd.updates).toHaveLength(0);
  });
});

describe('completarTransferenciaMesa', () => {
  it('completa y devuelve el movimiento actualizado', async () => {
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: false, completada: true, montoAcreditado: 980, montoCobrado: 980, montoPendiente: 0, comision: 20 }, error: null };
    bd.movimiento = filaMovimiento({ mesa_estado: 'completada', monto_destino: 980, mesa_monto_cobrado: 980 });
    const r = await completarTransferenciaMesa('m-1', U);
    expect(bd.llamadas[0]).toEqual({
      fn: 'cobrar_transferencia_mesa_cambio',
      args: { p_movimiento_id: 'm-1', p_monto: null, p_pendiente_esperado: null, p_usuario: U },
    });
    expect(r).toMatchObject({ movimiento: { mesaEstado: 'completada', mesaMontoCobrado: 980 }, yaCompletada: false, completada: true, montoAcreditado: 980, montoPendiente: 0 });
    expect(bd.updates).toHaveLength(0);
  });

  it('cobro parcial: manda el monto y el pendiente esperado y deja la transferencia en parcial', async () => {
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: false, completada: false, montoAcreditado: 400, montoCobrado: 400, montoPendiente: 580 }, error: null };
    bd.movimiento = filaMovimiento({ mesa_estado: 'parcial', mesa_monto_cobrado: 400 });
    const r = await completarTransferenciaMesa('m-1', U, { montoCobrado: 400, pendienteEsperado: 980, comprobantes: [] });
    expect(bd.llamadas[0].args).toMatchObject({ p_monto: 400, p_pendiente_esperado: 980 });
    expect(r).toMatchObject({ movimiento: { mesaEstado: 'parcial', mesaMontoCobrado: 400 }, completada: false, montoAcreditado: 400, montoCobrado: 400, montoPendiente: 580 });
  });

  it('la foto se agrega a los comprobantes existentes sin duplicar', async () => {
    const vieja = 'https://x.supabase.co/storage/v1/object/public/comprobantes/vieja.png';
    const nueva = 'https://x.supabase.co/storage/v1/object/public/comprobantes/nueva.png';
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: false, completada: true, montoAcreditado: 980, montoCobrado: 980, montoPendiente: 0 }, error: null };
    bd.movimiento = filaMovimiento({ comprobantes: [vieja] });
    await completarTransferenciaMesa('m-1', U, { montoCobrado: null, pendienteEsperado: null, comprobantes: [nueva, vieja] });
    expect(bd.updates).toEqual([{ tabla: 'movimientos', valores: { comprobantes: [vieja, nueva] } }]);
  });

  it('si la foto no se puede adjuntar el cobro ya quedó hecho y se avisa', async () => {
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: false, completada: true, montoAcreditado: 980, montoCobrado: 980, montoPendiente: 0 }, error: null };
    bd.updateError = { message: 'fallo' };
    const r = await completarTransferenciaMesa('m-1', U, { montoCobrado: null, pendienteEsperado: null, comprobantes: ['https://x.supabase.co/storage/v1/object/public/comprobantes/n.png'] });
    expect(r).toMatchObject({ completada: true, advertencia: expect.stringContaining('foto') });
  });

  it('la observacion se agrega a las anteriores, una linea por cobro', async () => {
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: false, completada: true, montoAcreditado: 980, montoCobrado: 980, montoPendiente: 0 }, error: null };
    bd.movimiento = filaMovimiento({ mesa_observacion: 'Primer abono en efectivo' });
    await completarTransferenciaMesa('m-1', U, { montoCobrado: null, pendienteEsperado: null, comprobantes: [], observacion: 'Resto por Zelle' });
    expect(bd.updates).toEqual([{ tabla: 'movimientos', valores: { mesa_observacion: 'Primer abono en efectivo\nResto por Zelle' } }]);
  });

  it('la primera observacion se guarda sola y sin ella no se toca la columna', async () => {
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: false, completada: true, montoAcreditado: 980, montoCobrado: 980, montoPendiente: 0 }, error: null };
    await completarTransferenciaMesa('m-1', U, { montoCobrado: null, pendienteEsperado: null, comprobantes: [], observacion: 'Entregó el cambista' });
    expect(bd.updates).toEqual([{ tabla: 'movimientos', valores: { mesa_observacion: 'Entregó el cambista' } }]);
    bd.updates = [];
    await completarTransferenciaMesa('m-1', U, { montoCobrado: null, pendienteEsperado: null, comprobantes: [], observacion: null });
    expect(bd.updates).toHaveLength(0);
  });

  it('si la observacion no se puede guardar el cobro ya quedó hecho y se avisa', async () => {
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: false, completada: true, montoAcreditado: 980, montoCobrado: 980, montoPendiente: 0 }, error: null };
    bd.updateError = { message: 'column "mesa_observacion" does not exist' };
    const r = await completarTransferenciaMesa('m-1', U, { montoCobrado: null, pendienteEsperado: null, comprobantes: [], observacion: 'Nota' });
    expect(r).toMatchObject({ completada: true, advertencia: expect.stringContaining('observación') });
  });

  it('si el pendiente cambio (doble clic u otro cobro) la RPC lo rechaza con 409 y no se adjunta nada', async () => {
    bd.rpcResp = { data: null, error: { code: 'P0001', message: 'El pendiente cambió: ahora faltan 580.00. Revisa y vuelve a intentar.' } };
    const r = await completarTransferenciaMesa('m-1', U, { montoCobrado: 400, pendienteEsperado: 980, comprobantes: ['https://x.supabase.co/storage/v1/object/public/comprobantes/n.png'] });
    expect(r).toMatchObject({ codigo: 409 });
    expect(bd.updates).toHaveLength(0);
  });

  it('sin la migracion de cobro parcial, un cobro total cae a la RPC anterior; uno parcial da 503', async () => {
    bd.rpcResp = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const total = await completarTransferenciaMesa('m-1', U);
    expect(bd.llamadas.map(l => l.fn)).toEqual(['cobrar_transferencia_mesa_cambio', 'completar_transferencia_mesa_cambio']);
    expect(total).toMatchObject({ codigo: 503 });
    bd.llamadas = [];
    const parcial = await completarTransferenciaMesa('m-1', U, { montoCobrado: 100, pendienteEsperado: null, comprobantes: [] });
    expect(bd.llamadas.map(l => l.fn)).toEqual(['cobrar_transferencia_mesa_cambio']);
    expect(parcial).toMatchObject({ codigo: 503, error: expect.stringContaining('migration_mesa_cambio_cobro_parcial.sql') });
  });

  it('completar otra vez es idempotente: informa yaCompletada sin error', async () => {
    bd.rpcResp = { data: { movimientoId: 'm-1', yaCompletada: true, completada: true, montoAcreditado: 0 }, error: null };
    bd.movimiento = filaMovimiento({ mesa_estado: 'completada' });
    expect(await completarTransferenciaMesa('m-1', U)).toMatchObject({ yaCompletada: true });
  });

  it('transferencia anulada u otro raise de negocio => 409 con el mensaje', async () => {
    bd.rpcResp = { data: null, error: { code: 'P0001', message: 'Esta transferencia fue anulada y no se puede completar.' } };
    expect(await completarTransferenciaMesa('m-1', U)).toMatchObject({ codigo: 409, error: expect.stringContaining('anulada') });
  });

  it('migracion sin aplicar => 503', async () => {
    bd.rpcResp = { data: null, error: { code: '42883', message: 'function does not exist' } };
    expect(await completarTransferenciaMesa('m-1', U)).toMatchObject({ codigo: 503 });
  });
});
