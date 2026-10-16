import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
type Err = { code?: string; message: string } | null;

const bd = vi.hoisted(() => ({
  origen: null as Record<string, unknown> | null,
  columnaError: null as { code?: string; message: string } | null,
  rpcResp: { data: null as unknown, error: null as { code?: string; message: string } | null },
  llamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  updates: [] as Array<Record<string, unknown>>,
  updateError: null as { code?: string; message: string } | null,
  legacy: [] as Array<Record<string, unknown>>,
  legacyResp: null as unknown,
  leido: null as unknown,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      bd.llamadas.push({ fn, args });
      return Promise.resolve(bd.rpcResp);
    },
    from: (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) c[m] = () => c;
      c.update = (v: Fila) => { bd.updates.push(v); return c; };
      c.maybeSingle = () => Promise.resolve({ data: bd.origen, error: null });
      c.then = (ok: (r: unknown) => unknown) => {
        const esUpdate = bd.updates.length > 0 && tabla === 'movimientos';
        return Promise.resolve({ data: [], error: esUpdate ? bd.updateError : bd.columnaError }).then(ok);
      };
      return c;
    },
  },
}));

const auditoria = vi.hoisted(() => ({ entradas: [] as Array<Record<string, unknown>>, resultado: true }));
vi.mock('../src/services/auditoria-service.js', () => ({
  registrarAuditoria: (e: Record<string, unknown>) => {
    auditoria.entradas.push(e);
    return Promise.resolve(auditoria.resultado);
  },
}));

const categoriaComision = vi.hoisted(() => ({ aplicadas: [] as string[][] }));
vi.mock('../src/services/comision-categoria-service.js', () => ({
  aplicarCategoriaAComisiones: (ids: string[]) => { categoriaComision.aplicadas.push(ids); return Promise.resolve({}); },
}));

vi.mock('../src/services/banca-service.js', () => ({
  crearMovimiento: (input: Fila) => {
    bd.legacy.push(input);
    return Promise.resolve(bd.legacyResp);
  },
  obtenerMovimiento: () => Promise.resolve(bd.leido),
}));

import { comisionBancariaDisponible, registrarMovimiento } from '../src/services/movimiento-comision-service.js';
import type { CrearMovimientoInput } from '../src/schemas/cochinito.js';

const U = '11111111-1111-4111-8111-111111111111';
const input = (extra: Partial<CrearMovimientoInput> = {}): CrearMovimientoInput => ({
  tipo: 'egreso', bancaId: 'b-o', bancaDestinoId: null, monto: 10000, montoDestino: null, moneda: 'VES',
  descripcion: 'Pago', referencia: null, fecha: '2026-10-11', proveedorId: null, clienteId: null, comprobantes: [], ...extra,
});
const movimiento = { id: 'm-1', tipo: 'egreso', monto: 10000 };
const columnaFalta: Err = { code: '42703', message: 'column movimientos.comision_bancaria does not exist' };

beforeEach(() => {
  bd.origen = { id: 'b-o', moneda: 'VES', saldo: 50000 };
  bd.columnaError = null;
  bd.rpcResp = { data: { movimientoId: 'm-1', comisionId: 'm-2', comision: 30, numeroSistema: 6 }, error: null };
  bd.llamadas = []; bd.updates = []; bd.updateError = null; bd.legacy = [];
  bd.legacyResp = { movimiento };
  bd.leido = movimiento;
  auditoria.entradas = []; auditoria.resultado = true;
  categoriaComision.aplicadas = [];
});

describe('registrarMovimiento: categoría COMISIONES BANCARIAS', () => {
  it('con comisión, el cargo creado recibe la categoría de comisiones bancarias', async () => {
    await registrarMovimiento(input({ llevaComision: true }), U);
    expect(categoriaComision.aplicadas).toEqual([['m-2']]);
  });

  it('sin comisión no se aplica ninguna categoría de comisión', async () => {
    await registrarMovimiento(input({ llevaComision: false }), U);
    expect(categoriaComision.aplicadas).toEqual([]);
  });
});

describe('registrarMovimiento: cuando NO aplica la comisión', () => {
  it('un ingreso se registra como siempre', async () => {
    const r = await registrarMovimiento(input({ tipo: 'ingreso' }), U);
    expect(r).toEqual({ movimiento, comision: null });
    expect(bd.legacy).toHaveLength(1);
    expect(bd.llamadas).toHaveLength(0);
  });

  it('un ingreso con llevaComision=true se rechaza (solo aplica a salidas)', async () => {
    const r = await registrarMovimiento(input({ tipo: 'ingreso', llevaComision: true }), U);
    expect(r).toMatchObject({ codigo: 400 });
    expect(bd.legacy).toHaveLength(0);
  });

  it('un egreso desde una cuenta en USD se registra como siempre', async () => {
    bd.origen = { id: 'b-o', moneda: 'USD', saldo: 500 };
    const r = await registrarMovimiento(input({ moneda: 'USD' }), U);
    expect(r).toEqual({ movimiento, comision: null });
    expect(bd.llamadas).toHaveLength(0);
  });

  it('llevaComision=true con una cuenta en USD se rechaza con 400', async () => {
    bd.origen = { id: 'b-o', moneda: 'USD', saldo: 500 };
    const r = await registrarMovimiento(input({ llevaComision: true }), U);
    expect(r).toMatchObject({ codigo: 400, error: expect.stringContaining('bolívares') });
  });

  it('desde una cuenta en Bs, llevaComision=false se registra sin comisión', async () => {
    const r = await registrarMovimiento(input({ llevaComision: false }), U);
    expect(r).toEqual({ movimiento, comision: null });
    expect(bd.llamadas).toHaveLength(0);
  });
});

describe('registrarMovimiento: omitir la comisión queda auditado', () => {
  it('llevaComision=false desde una cuenta en Bs registra quien y que movimiento, sin importes ni cuentas', async () => {
    await registrarMovimiento(input({ llevaComision: false, referencia: 'REF-SECRETA', descripcion: 'Texto libre' }), U);
    expect(auditoria.entradas).toHaveLength(1);
    expect(auditoria.entradas[0]).toMatchObject({ entidadTipo: 'movimiento_banca', entidadId: 'm-1', accion: 'sin_comision_bancaria', usuarioId: U });
    const texto = JSON.stringify(auditoria.entradas[0]);
    expect(texto).not.toContain('REF-SECRETA');
    expect(texto).not.toContain('Texto libre');
  });

  it('si no se puede auditar, el movimiento igual se registra y se avisa con una advertencia', async () => {
    auditoria.resultado = false;
    const r = await registrarMovimiento(input({ llevaComision: false }), U);
    expect(r).toMatchObject({ movimiento, comision: null, advertencia: expect.stringContaining('auditor') });
  });

  it('no audita cuando el registro falla, ni cuando lleva comision, ni en cuentas que no son Bs', async () => {
    bd.legacyResp = { error: 'Saldo insuficiente' };
    await registrarMovimiento(input({ llevaComision: false }), U);
    bd.legacyResp = { movimiento };
    await registrarMovimiento(input({ llevaComision: true }), U);
    bd.origen = { id: 'b-o', moneda: 'USD', saldo: 500 };
    await registrarMovimiento(input({ moneda: 'USD' }), U);
    expect(auditoria.entradas).toHaveLength(0);
  });
});

describe('registrarMovimiento: elección obligatoria en Bs', () => {
  it('sin elegir Sí o No (migración aplicada) responde 400', async () => {
    const r = await registrarMovimiento(input(), U);
    expect(r).toMatchObject({ codigo: 400, error: expect.stringContaining('comisión bancaria') });
    expect(bd.legacy).toHaveLength(0);
  });

  it('sin elegir y con la migración pendiente se registra como siempre (compatibilidad)', async () => {
    bd.columnaError = columnaFalta;
    const r = await registrarMovimiento(input(), U);
    expect(r).toEqual({ movimiento, comision: null });
  });
});

describe('registrarMovimiento: con comisión', () => {
  it('llama a la RPC atómica con los datos del movimiento', async () => {
    const r = await registrarMovimiento(input({ llevaComision: true, referencia: 'REF-1', proveedorId: 'p-1' }), U);
    expect(bd.llamadas).toHaveLength(1);
    expect(bd.llamadas[0].fn).toBe('crear_movimiento_con_comision_bancaria');
    expect(bd.llamadas[0].args).toMatchObject({
      p_tipo: 'egreso', p_banca_origen_id: 'b-o', p_monto: 10000, p_fecha: '2026-10-11', p_referencia: 'REF-1', p_proveedor_id: 'p-1', p_usuario: U,
    });
    expect(bd.legacy).toHaveLength(0);
    expect(r).toEqual({ movimiento, comision: { monto: 30, movimientoId: 'm-2' } });
  });

  it('una transferencia también la lleva y pasa la banca destino', async () => {
    await registrarMovimiento(input({ tipo: 'transferencia', bancaDestinoId: 'b-d', llevaComision: true }), U);
    expect(bd.llamadas[0].args).toMatchObject({ p_tipo: 'transferencia', p_banca_destino_id: 'b-d' });
  });

  it('rechaza antes de llamar a la RPC si el saldo no alcanza para monto + comisión', async () => {
    bd.origen = { id: 'b-o', moneda: 'VES', saldo: 10010 };
    const r = await registrarMovimiento(input({ llevaComision: true }), U);
    expect(r).toMatchObject({ codigo: 409, error: expect.stringContaining('Saldo insuficiente') });
    expect(bd.llamadas).toHaveLength(0);
  });

  it('adjunta los comprobantes con un update aparte', async () => {
    await registrarMovimiento(input({ llevaComision: true, comprobantes: ['https://x/a.jpg'] }), U);
    expect(bd.updates).toEqual([{ comprobantes: ['https://x/a.jpg'] }]);
  });

  it('si el comprobante no se adjunta, el movimiento queda y se avisa', async () => {
    bd.updateError = { message: 'boom' };
    const r = await registrarMovimiento(input({ llevaComision: true, comprobantes: ['https://x/a.jpg'] }), U);
    expect(r).toMatchObject({ movimiento, advertencia: expect.stringContaining('comprobante') });
  });

  it('función inexistente => 503 (migración pendiente), nada se registra', async () => {
    bd.rpcResp = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.crear_movimiento_con_comision_bancaria' } };
    const r = await registrarMovimiento(input({ llevaComision: true }), U);
    expect(r).toMatchObject({ codigo: 503, error: expect.stringContaining('migration_wallet_comision_bancaria.sql') });
  });

  it('un raise exception de negocio se muestra con 409', async () => {
    bd.rpcResp = { data: null, error: { code: 'P0001', message: 'La cuenta BNC está archivada.' } };
    const r = await registrarMovimiento(input({ llevaComision: true }), U);
    expect(r).toEqual({ error: 'La cuenta BNC está archivada.', codigo: 409 });
  });

  it('un error de BD desconocido responde 500 genérico sin detalles internos', async () => {
    bd.rpcResp = { data: null, error: { code: 'XX000', message: 'relation secret_table broke' } };
    const r = await registrarMovimiento(input({ llevaComision: true }), U);
    expect(r).toMatchObject({ codigo: 500 });
    expect(JSON.stringify(r)).not.toContain('secret_table');
  });
});

describe('comisionBancariaDisponible', () => {
  it('true si la columna existe', async () => {
    expect(await comisionBancariaDisponible()).toBe(true);
  });

  it('false si la columna no existe (migración pendiente)', async () => {
    bd.columnaError = columnaFalta;
    expect(await comisionBancariaDisponible()).toBe(false);
  });

  it('un error distinto no se toma por pendiente: se asume disponible', async () => {
    bd.columnaError = { code: '57014', message: 'timeout' };
    expect(await comisionBancariaDisponible()).toBe(true);
  });
});
