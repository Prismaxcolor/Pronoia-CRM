import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;

const bd = vi.hoisted(() => ({
  bancas: {} as Record<string, Record<string, unknown>>,
  errorBancas: null as { code?: string; message: string } | null,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResp: { data: { movimientoId: 'm-1', comisionId: 'm-2', comision: 3, numeroSistema: 6 } as unknown, error: null as { code?: string; message: string } | null },
  legacy: [] as Array<Record<string, unknown>>,
  disponible: true,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      bd.rpc.push({ fn, args });
      return Promise.resolve(bd.rpcResp);
    },
    from: (tabla: string) => {
      let ids: string[] | null = null;
      let id: string | null = null;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (_k: string, v: string) => { id = v; return c; };
      c.limit = () => c;
      c.in = (_k: string, v: string[]) => { ids = v; return Promise.resolve({ data: v.map(x => ({ id: x, ...(bd.bancas[x] ?? {}) })), error: bd.errorBancas }); };
      c.maybeSingle = () => Promise.resolve({ data: id ? (bd.bancas[id] ?? null) : null, error: bd.errorBancas });
      c.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: tabla === 'movimientos' && !bd.disponible ? { code: '42703', message: 'column movimientos.comision_bancaria does not exist' } : null }).then(ok);
      void ids;
      return c;
    },
  },
}));
vi.mock('../src/services/auditoria-service.js', () => ({ registrarAuditoria: () => Promise.resolve(true) }));
vi.mock('../src/services/comision-categoria-service.js', () => ({ aplicarCategoriaAComisiones: () => Promise.resolve({}) }));
vi.mock('../src/services/banca-service.js', () => ({
  crearMovimiento: (input: Fila) => { bd.legacy.push(input); return Promise.resolve({ movimiento: { id: 'm-legacy' } }); },
  obtenerMovimiento: () => Promise.resolve({ id: 'm-1', tipo: 'egreso' }),
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => '' }));

import {
  calcularComisionAutomatica, reglaDeBanca, totalConComisionAutomatica,
} from '../src/utils/comision-automatica.js';
import { ComisionAutomaticaNoDisponibleError, reglaAutomaticaDe, reglasAutomaticasDe } from '../src/services/comision-automatica-service.js';
import { registrarMovimiento } from '../src/services/movimiento-comision-service.js';
import { conComisionAutomatica, lineaCargaComision, validarEleccionComisionPago } from '../src/services/pago-comision-service.js';
import type { CrearMovimientoInput } from '../src/schemas/cochinito.js';

const CITI = { tasa: 0.003, minimo: 0 };

describe('calcularComisionAutomatica (regla de la cuenta)', () => {
  it('porcentaje sobre el monto, a centavos', () => {
    expect(calcularComisionAutomatica(1000, CITI)).toBe(3);
    expect(calcularComisionAutomatica(1234.56, CITI)).toBe(3.7); // 3.70368
    expect(calcularComisionAutomatica(333.33, CITI)).toBe(1); // 0.99999
  });

  it('mitad hacia arriba, sin errores de coma flotante', () => {
    // 0.3 % de 0.50 = 0.0015 -> 0.00 -> mínimo de 1 centavo
    expect(calcularComisionAutomatica(0.5, CITI)).toBe(0.01);
    // 0.3 % de 1500 = 4.5 exacto
    expect(calcularComisionAutomatica(1500, CITI)).toBe(4.5);
    // 0.3 % de 2.5 = 0.0075 -> 0.01
    expect(calcularComisionAutomatica(2.5, CITI)).toBe(0.01);
    // 10 % de 0.35 = 0.035 -> 0.04 (mitad hacia arriba)
    expect(calcularComisionAutomatica(0.35, { tasa: 0.1, minimo: 0 })).toBe(0.04);
  });

  it('el mínimo manda cuando el porcentaje queda por debajo', () => {
    expect(calcularComisionAutomatica(100, { tasa: 0.003, minimo: 14 })).toBe(14);
    expect(calcularComisionAutomatica(10000, { tasa: 0.003, minimo: 14 })).toBe(30);
  });

  it('una comisión fija (tasa 0) es siempre el mínimo', () => {
    expect(calcularComisionAutomatica(5, { tasa: 0, minimo: 25 })).toBe(25);
    expect(calcularComisionAutomatica(50000, { tasa: 0, minimo: 25 })).toBe(25);
  });

  it('nunca menos de un centavo, ni con montos no válidos', () => {
    expect(calcularComisionAutomatica(0.01, CITI)).toBe(0.01);
    expect(calcularComisionAutomatica(0, CITI)).toBe(0);
    expect(calcularComisionAutomatica(-5, CITI)).toBe(0);
    expect(calcularComisionAutomatica(Number.NaN, CITI)).toBe(0);
  });

  it('el total debitado es monto más comisión, a centavos', () => {
    expect(totalConComisionAutomatica(1000, CITI)).toBe(1003);
    expect(totalConComisionAutomatica(0.1, CITI)).toBe(0.11);
    expect(totalConComisionAutomatica(100, { tasa: 0.003, minimo: 14 })).toBe(114);
  });
});

describe('reglaDeBanca', () => {
  it('sin columnas o ambas nulas no hay regla', () => {
    expect(reglaDeBanca(null)).toBeNull();
    expect(reglaDeBanca({})).toBeNull();
    expect(reglaDeBanca({ comision_auto_tasa: null, comision_auto_minimo: null })).toBeNull();
  });
  it('lee tasa y mínimo (numéricos o texto) y completa el que falta con 0', () => {
    expect(reglaDeBanca({ comision_auto_tasa: '0.003', comision_auto_minimo: null })).toEqual({ tasa: 0.003, minimo: 0 });
    expect(reglaDeBanca({ comision_auto_tasa: 0, comision_auto_minimo: 25 })).toEqual({ tasa: 0, minimo: 25 });
  });
  it('una regla en cero no cobra nada: no cuenta como regla', () => {
    expect(reglaDeBanca({ comision_auto_tasa: 0, comision_auto_minimo: 0 })).toBeNull();
  });
  it('valores negativos o inválidos no producen comisión negativa', () => {
    expect(reglaDeBanca({ comision_auto_tasa: -1, comision_auto_minimo: 10 })).toEqual({ tasa: 0, minimo: 10 });
    expect(reglaDeBanca({ comision_auto_tasa: 'x', comision_auto_minimo: null })).toBeNull();
  });
});

beforeEach(() => {
  bd.bancas = {
    'b-citi': { moneda: 'USD', saldo: 5000, comision_auto_tasa: 0.003, comision_auto_minimo: 0 },
    'b-ves': { moneda: 'VES', saldo: 50000, comision_auto_tasa: null, comision_auto_minimo: null },
    'b-usd': { moneda: 'USD', saldo: 5000 },
  };
  bd.errorBancas = null; bd.rpc = []; bd.legacy = []; bd.disponible = true;
  bd.rpcResp = { data: { movimientoId: 'm-1', comisionId: 'm-2', comision: 3, numeroSistema: 6 }, error: null };
});

describe('lectura de reglas (servicio)', () => {
  it('devuelve solo las cuentas con regla', async () => {
    const r = await reglasAutomaticasDe(['b-citi', 'b-ves', 'b-usd']);
    expect([...r.keys()]).toEqual(['b-citi']);
    expect(r.get('b-citi')).toEqual(CITI);
  });
  it('una cuenta sin regla da null', async () => {
    expect(await reglaAutomaticaDe('b-usd')).toBeNull();
    expect(await reglaAutomaticaDe('b-citi')).toEqual(CITI);
  });
  it('sin la migración (columna inexistente) ninguna cuenta tiene regla', async () => {
    bd.errorBancas = { code: '42703', message: 'column bancas.comision_auto_tasa does not exist' };
    expect((await reglasAutomaticasDe(['b-citi'])).size).toBe(0);
    expect(await reglaAutomaticaDe('b-citi')).toBeNull();
  });
  it('otro error de lectura (no es migración pendiente) falla cerrado: lanza en vez de asumir "sin regla"', async () => {
    bd.errorBancas = { code: '57014', message: 'canceling statement due to statement timeout' };
    await expect(reglaAutomaticaDe('b-citi')).rejects.toBeInstanceOf(ComisionAutomaticaNoDisponibleError);
    await expect(reglasAutomaticasDe(['b-citi'])).rejects.toBeInstanceOf(ComisionAutomaticaNoDisponibleError);
    await expect(conComisionAutomatica([{ bancaId: 'b-citi', moneda: 'USD' }])).rejects.toBeInstanceOf(ComisionAutomaticaNoDisponibleError);
  });
  it('sin ids no consulta', async () => {
    expect((await reglasAutomaticasDe([])).size).toBe(0);
  });
});

const input = (extra: Partial<CrearMovimientoInput> = {}): CrearMovimientoInput => ({
  tipo: 'egreso', bancaId: 'b-citi', bancaDestinoId: null, monto: 1000, montoDestino: null, moneda: 'USD',
  descripcion: 'Pago', referencia: null, fecha: '2026-10-24', proveedorId: null, clienteId: null, comprobantes: [], ...extra,
});

describe('Wallet: falla cerrado si no se puede verificar la comisión automática', () => {
  it('un error de lectura de la regla responde 503 y no registra el movimiento sin comisión', async () => {
    bd.errorBancas = { code: '57014', message: 'timeout' };
    const r = await registrarMovimiento(input(), 'u1');
    expect(r).toMatchObject({ codigo: 503 });
    expect(bd.legacy).toHaveLength(0);
    expect(bd.rpc).toHaveLength(0);
  });
  it('cuenta con regla pero sin la migración del Wallet (comision_bancaria) responde 503, no registra sin comisión', async () => {
    bd.disponible = false;
    const r = await registrarMovimiento(input(), 'u1');
    expect(r).toMatchObject({ codigo: 503 });
    expect(bd.legacy).toHaveLength(0);
  });
});

describe('Wallet: egreso desde una cuenta con comisión automática', () => {
  it('crea el movimiento con su comisión sin preguntar Sí/No (aunque no se envíe llevaComision)', async () => {
    const r = await registrarMovimiento(input(), 'u1');
    expect(r).toMatchObject({ comision: { monto: 3, movimientoId: 'm-2' } });
    expect(bd.rpc).toHaveLength(1);
    expect(bd.rpc[0].fn).toBe('crear_movimiento_con_comision_bancaria');
    expect(bd.rpc[0].args).toMatchObject({ p_tipo: 'egreso', p_banca_origen_id: 'b-citi', p_monto: 1000 });
    expect(bd.legacy).toHaveLength(0);
  });

  it('no se puede omitir: llevaComision false igual carga la comisión', async () => {
    await registrarMovimiento(input({ llevaComision: false }), 'u1');
    expect(bd.rpc).toHaveLength(1);
    expect(bd.legacy).toHaveLength(0);
  });

  it('una transferencia desde la cuenta también lleva comisión', async () => {
    await registrarMovimiento(input({ tipo: 'transferencia', bancaDestinoId: 'b-usd' }), 'u1');
    expect(bd.rpc[0].args).toMatchObject({ p_tipo: 'transferencia', p_banca_destino_id: 'b-usd' });
  });

  it('rechaza si el saldo no alcanza para el monto más la comisión (409), sin tocar la base', async () => {
    bd.bancas['b-citi'].saldo = 1002; // alcanza para 1000 pero no para 1003
    const r = await registrarMovimiento(input(), 'u1');
    expect(r).toMatchObject({ codigo: 409, error: expect.stringMatching(/comisión bancaria automática de USD 3\.00 suman USD 1003\.00 y el disponible es USD 1002\.00/) });
    expect(bd.rpc).toHaveLength(0);
  });

  it('con el saldo justo (monto + comisión) sí se registra', async () => {
    bd.bancas['b-citi'].saldo = 1003;
    const r = await registrarMovimiento(input(), 'u1');
    expect('movimiento' in r).toBe(true);
  });

  it('un ingreso a la cuenta no lleva comisión', async () => {
    const r = await registrarMovimiento(input({ tipo: 'ingreso' }), 'u1');
    expect(bd.rpc).toHaveLength(0);
    expect(bd.legacy).toHaveLength(1);
    expect(r).toMatchObject({ comision: null });
  });

  it('una cuenta sin regla se comporta como siempre (USD: sin comisión)', async () => {
    await registrarMovimiento(input({ bancaId: 'b-usd' }), 'u1');
    expect(bd.rpc).toHaveLength(0);
    expect(bd.legacy).toHaveLength(1);
  });

  it('una cuenta en Bs sin regla sigue pidiendo elegir Sí/No', async () => {
    const r = await registrarMovimiento(input({ bancaId: 'b-ves', moneda: 'VES' }), 'u1');
    expect(r).toMatchObject({ codigo: 400, error: expect.stringMatching(/Indica si el movimiento lleva comisión/) });
  });

  it('un egreso con proveedor desde la cuenta usa la misma RPC (el adelanto lo crea la base)', async () => {
    await registrarMovimiento(input({ proveedorId: '22222222-2222-4222-8222-222222222222' }), 'u1');
    expect(bd.rpc[0].args).toMatchObject({ p_proveedor_id: '22222222-2222-4222-8222-222222222222' });
  });
});

describe('Pagos a proveedor desde una cuenta con comisión automática', () => {
  it('marca la línea como automática y con comisión, en cualquier moneda', async () => {
    const lineas = await conComisionAutomatica([
      { bancaId: 'b-citi', moneda: 'USD' },
      { bancaId: 'b-usd', moneda: 'USD' },
      { bancaId: 'b-ves', moneda: 'VES', llevaComision: false },
    ]);
    expect(lineas).toEqual([
      { bancaId: 'b-citi', moneda: 'USD', llevaComision: true, automatica: true },
      { bancaId: 'b-usd', moneda: 'USD' },
      { bancaId: 'b-ves', moneda: 'VES', llevaComision: false },
    ]);
  });

  it('no muta las líneas recibidas', async () => {
    const original = [{ bancaId: 'b-citi', moneda: 'USD' as const }];
    await conComisionAutomatica(original);
    expect(original).toEqual([{ bancaId: 'b-citi', moneda: 'USD' }]);
  });

  it('la cuenta automática carga comisión; una en USD común con Sí no; una en Bs con Sí sí', () => {
    expect(lineaCargaComision({ bancaId: 'x', moneda: 'USD', llevaComision: true, automatica: true })).toBe(true);
    expect(lineaCargaComision({ bancaId: 'x', moneda: 'USD', llevaComision: true })).toBe(false);
    expect(lineaCargaComision({ bancaId: 'x', moneda: 'VES', llevaComision: true })).toBe(true);
    expect(lineaCargaComision({ bancaId: 'x', moneda: 'VES', llevaComision: false })).toBe(false);
    expect(lineaCargaComision({ bancaId: 'x', moneda: 'VES' })).toBe(false);
  });

  it('el pago desde la cuenta automática en USD se acepta (no es "Sí en una cuenta que no es de Bs")', async () => {
    const lineas = await conComisionAutomatica([{ bancaId: 'b-citi', moneda: 'USD' }]);
    expect(await validarEleccionComisionPago(lineas)).toBeNull();
  });

  it('pedir Sí a mano en una cuenta en USD sin regla se sigue rechazando', async () => {
    const r = await validarEleccionComisionPago([{ bancaId: 'b-usd', moneda: 'USD', llevaComision: true }]);
    expect(r).toMatch(/solo aplica cuando la cuenta de origen está en bolívares/);
  });
});
