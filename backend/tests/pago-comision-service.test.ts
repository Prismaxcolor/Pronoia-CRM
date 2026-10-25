import { describe, it, expect, vi, beforeEach } from 'vitest';

type ErrorBd = { code?: string; message: string } | null;
type Fila = Record<string, unknown>;

const bd = vi.hoisted(() => ({
  comisionHabilitada: true,
  rpcDisponible: true,
  rpcErrorPorMovimiento: {} as Record<string, ErrorBd>,
  filas: [] as Array<Record<string, unknown>>,
  errorLectura: null as ErrorBd,
  errorGrupo: null as ErrorBd,
  errorCargos: null as ErrorBd,
  grupoConComision: false,
  llamadasRpc: [] as Array<{ nombre: string; args: Record<string, unknown> }>,
  auditorias: [] as Array<Record<string, unknown>>,
  categoriaAplicada: [] as string[][],
  avisoCategoria: undefined as string | undefined,
  monedaPorBanca: {} as Record<string, string>,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: (nombre: string, args: Record<string, unknown>) => {
      bd.llamadasRpc.push({ nombre, args });
      if (args.p_movimiento_id === null) {
        // Sonda de disponibilidad: sin migración responde "función inexistente"; con ella, rechazo de negocio.
        return Promise.resolve({
          data: null,
          error: bd.rpcDisponible ? { code: 'P0001', message: 'Falta el movimiento.' } : { code: 'PGRST202', message: 'Could not find the function' },
        });
      }
      const id = String(args.p_movimiento_id);
      const error = bd.rpcErrorPorMovimiento[id] ?? null;
      return Promise.resolve({ data: error ? null : { comisionId: `c-${id}`, comision: 14, base: 100 }, error });
    },
    from: (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'limit', 'or']) c[m] = () => c;
      if (tabla === 'bancas') {
        c.in = (_k: string, ids: string[]) =>
          Promise.resolve({ data: ids.map(id => ({ id, moneda: bd.monedaPorBanca[id] })), error: null });
        return c;
      }
      c.in = (k: string) =>
        k === 'comision_de_id'
          ? Promise.resolve({ data: bd.errorCargos ? null : bd.grupoConComision ? [{ id: 'cargo' }] : [], error: bd.errorCargos })
          : Promise.resolve({ data: bd.errorLectura ? null : bd.filas, error: bd.errorLectura });
      c.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve({ data: bd.errorGrupo ? null : [{ id: 'g-1' }], error: bd.errorGrupo }).then(ok);
      return c;
    },
  },
}));
vi.mock('../src/services/movimiento-comision-service.js', () => ({
  comisionBancariaDisponible: () => Promise.resolve(bd.comisionHabilitada),
  MENSAJE_COMISION_PENDIENTE: 'La comisión bancaria aún no está habilitada.',
}));
vi.mock('../src/services/auditoria-service.js', () => ({
  registrarAuditoria: (e: Fila) => { bd.auditorias.push(e); return Promise.resolve(true); },
}));
vi.mock('../src/services/comision-categoria-service.js', () => ({
  aplicarCategoriaAComisiones: (ids: string[]) => {
    bd.categoriaAplicada.push(ids);
    return Promise.resolve(bd.avisoCategoria ? { advertencia: bd.avisoCategoria } : {});
  },
}));

import {
  aplicarComisionesDePago, grupoLlevaComision, pagoComisionDisponible, validarEleccionComisionPago, reintentarComisionDeBanca,
  MENSAJE_PAGO_COMISION_PENDIENTE, MENSAJE_PAGO_COMISION_SOLO_BS, MENSAJE_PAGO_ELEGIR_COMISION,
  type LineaComisionPago,
} from '../src/services/pago-comision-service.js';

const bs = (bancaId: string, llevaComision?: boolean): LineaComisionPago => {
  bd.monedaPorBanca[bancaId] = 'VES';
  return { bancaId, moneda: 'VES', llevaComision };
};
const usd = (bancaId: string, llevaComision?: boolean): LineaComisionPago => {
  bd.monedaPorBanca[bancaId] = 'USD';
  return { bancaId, moneda: 'USD', llevaComision };
};
const USUARIO = 'u-1';

beforeEach(() => {
  bd.comisionHabilitada = true; bd.rpcDisponible = true; bd.rpcErrorPorMovimiento = {};
  bd.filas = []; bd.errorLectura = null; bd.errorGrupo = null; bd.errorCargos = null; bd.grupoConComision = false;
  bd.llamadasRpc = []; bd.auditorias = []; bd.categoriaAplicada = []; bd.avisoCategoria = undefined;
});

describe('pagoComisionDisponible', () => {
  it('es true cuando la columna del Wallet y la RPC de pagos existen', async () => {
    expect(await pagoComisionDisponible()).toBe(true);
  });
  it('es false si falta la migración del Wallet (sin probar la RPC)', async () => {
    bd.comisionHabilitada = false;
    expect(await pagoComisionDisponible()).toBe(false);
    expect(bd.llamadasRpc).toHaveLength(0);
  });
  it('es false si falta la RPC de pagos', async () => {
    bd.rpcDisponible = false;
    expect(await pagoComisionDisponible()).toBe(false);
  });
});

describe('validarEleccionComisionPago', () => {
  it('un pago solo en USD no pide nada ni consulta la BD', async () => {
    expect(await validarEleccionComisionPago([usd('b1'), usd('b2', false)])).toBeNull();
    expect(bd.llamadasRpc).toHaveLength(0);
  });
  it('exige elegir Sí o No en cada cuenta en Bs cuando la comisión está habilitada', async () => {
    expect(await validarEleccionComisionPago([bs('b1', true), bs('b2')])).toBe(MENSAJE_PAGO_ELEGIR_COMISION);
  });
  it('acepta Sí o No explícitos en todas las cuentas en Bs', async () => {
    expect(await validarEleccionComisionPago([bs('b1', true), bs('b2', false), usd('b3')])).toBeNull();
  });
  it('rechaza la comisión en una cuenta que no es de Bs', async () => {
    expect(await validarEleccionComisionPago([usd('b1', true)])).toBe(MENSAJE_PAGO_COMISION_SOLO_BS);
  });
  it('sin migración, una cuenta en Bs se paga como siempre aunque no se elija', async () => {
    bd.comisionHabilitada = false;
    expect(await validarEleccionComisionPago([bs('b1')])).toBeNull();
    expect(await validarEleccionComisionPago([bs('b1', false)])).toBeNull();
  });
  it('sin migración, pedir la comisión explícitamente se rechaza antes de mover dinero', async () => {
    bd.comisionHabilitada = false;
    expect(await validarEleccionComisionPago([bs('b1', true)])).toBe(MENSAJE_PAGO_COMISION_PENDIENTE);
  });
  it('con la RPC de pagos pendiente también se rechaza el Sí', async () => {
    bd.rpcDisponible = false;
    expect(await validarEleccionComisionPago([bs('b1', true)])).toBe(MENSAJE_PAGO_COMISION_PENDIENTE);
  });
});

describe('aplicarComisionesDePago', () => {
  const entrada = (lineas: LineaComisionPago[], movimientoIds = ['m-pago', 'm-adel']) =>
    ({ movimientoIds, grupoId: 'g-1', lineas, usuarioId: USUARIO });

  it('carga la comisión sobre el movimiento de pago de la cuenta y le pone la categoría', async () => {
    bd.filas = [
      { id: 'm-adel', banca_origen_id: 'b1', subtipo: 'adelanto' },
      { id: 'm-pago', banca_origen_id: 'b1', subtipo: 'pago' },
    ];
    const r = await aplicarComisionesDePago(entrada([bs('b1', true)]));
    expect(r.comisiones).toEqual([{ bancaId: 'b1', movimientoId: 'c-m-pago', monto: 14 }]);
    expect(r.advertencia).toBeUndefined();
    expect(bd.llamadasRpc).toEqual([{ nombre: 'agregar_comision_bancaria_a_pago', args: { p_movimiento_id: 'm-pago', p_usuario: USUARIO } }]);
    expect(bd.categoriaAplicada).toEqual([['c-m-pago']]);
  });

  it('si la cuenta solo tiene adelanto, cuelga el cargo del adelanto', async () => {
    bd.filas = [{ id: 'm-adel', banca_origen_id: 'b1', subtipo: 'adelanto' }];
    const r = await aplicarComisionesDePago(entrada([bs('b1', true)], ['m-adel']));
    expect(r.comisiones.map(c => c.movimientoId)).toEqual(['c-m-adel']);
  });

  it('una comisión por cada cuenta en Bs con Sí; ignora las cuentas con No o en USD', async () => {
    bd.filas = [
      { id: 'm1', banca_origen_id: 'b1', subtipo: 'pago' },
      { id: 'm2', banca_origen_id: 'b2', subtipo: 'pago' },
      { id: 'm3', banca_origen_id: 'b3', subtipo: 'pago' },
    ];
    const r = await aplicarComisionesDePago(entrada([bs('b1', true), bs('b2', true), bs('b3', false), usd('b4', false)], ['m1', 'm2', 'm3']));
    expect(r.comisiones.map(c => c.bancaId)).toEqual(['b1', 'b2']);
    expect(bd.llamadasRpc.map(l => l.args.p_movimiento_id)).toEqual(['m1', 'm2']);
    expect(bd.categoriaAplicada).toEqual([['c-m1', 'c-m2']]);
  });

  it('audita la omisión cuando la persona eligió No en una cuenta en Bs', async () => {
    const r = await aplicarComisionesDePago(entrada([bs('b1', false)]));
    expect(r.comisiones).toEqual([]);
    expect(bd.auditorias).toHaveLength(1);
    expect(bd.auditorias[0]).toMatchObject({ entidadTipo: 'pago', entidadId: 'g-1', accion: 'sin_comision_bancaria', usuarioId: USUARIO });
    expect(bd.llamadasRpc).toHaveLength(0);
  });

  it('un pago solo en USD no audita ni consulta nada', async () => {
    const r = await aplicarComisionesDePago(entrada([usd('b1', false)]));
    expect(r).toEqual({ comisiones: [] });
    expect(bd.auditorias).toHaveLength(0);
  });

  it('si la RPC falla en una cuenta, el pago sigue y se avisa; las demás comisiones se cargan', async () => {
    bd.filas = [
      { id: 'm1', banca_origen_id: 'b1', subtipo: 'pago' },
      { id: 'm2', banca_origen_id: 'b2', subtipo: 'pago' },
    ];
    bd.rpcErrorPorMovimiento.m1 = { code: 'P0001', message: 'Banca archivada' };
    const r = await aplicarComisionesDePago(entrada([bs('b1', true), bs('b2', true)], ['m1', 'm2']));
    expect(r.comisiones.map(c => c.bancaId)).toEqual(['b2']);
    expect(r.advertencia).toMatch(/no se pudo cargar la comisión bancaria/);
    expect(r.bancasFallidas).toEqual(['b1']);
  });

  it('informa las cuentas fallidas para reintentarlas cuando no se pueden leer los movimientos', async () => {
    bd.errorLectura = { message: 'caída' };
    const r = await aplicarComisionesDePago(entrada([bs('b1', true), bs('b2', true), usd('b3', true)]));
    expect(r.bancasFallidas).toEqual(['b1', 'b2']);
  });

  it('si no se pueden leer los movimientos devuelve una advertencia y no llama a la RPC', async () => {
    bd.errorLectura = { message: 'caída' };
    const r = await aplicarComisionesDePago(entrada([bs('b1', true)]));
    expect(r.comisiones).toEqual([]);
    expect(r.advertencia).toMatch(/Regístrala como egreso en Wallet/);
    expect(bd.llamadasRpc).toHaveLength(0);
  });

  it('si la categoría no se pudo aplicar, la comisión queda cargada y se avisa', async () => {
    bd.filas = [{ id: 'm1', banca_origen_id: 'b1', subtipo: 'pago' }];
    bd.avisoCategoria = 'No se pudo asignar la categoría.';
    const r = await aplicarComisionesDePago(entrada([bs('b1', true)], ['m1']));
    expect(r.comisiones).toHaveLength(1);
    expect(r.advertencia).toBe('No se pudo asignar la categoría.');
  });
});

describe('grupoLlevaComision', () => {
  it('es true si algún movimiento del grupo tiene un cargo de comisión ligado (comision_de_id)', async () => {
    bd.grupoConComision = true;
    expect(await grupoLlevaComision('g-1')).toBe(true);
  });
  it('es false si ninguno la tiene', async () => {
    expect(await grupoLlevaComision('g-1')).toBe(false);
  });
  it('es false sin la migración (columna inexistente) y ante un error de lectura', async () => {
    bd.errorCargos = { code: '42703', message: 'column movimientos.comision_de_id does not exist' };
    expect(await grupoLlevaComision('g-1')).toBe(false);
    bd.errorCargos = null;
    bd.errorGrupo = { code: '42703', message: 'column movimientos.comision_de_id does not exist' };
    expect(await grupoLlevaComision('g-1')).toBe(false);
    bd.errorGrupo = { message: 'caída' };
    expect(await grupoLlevaComision('g-1')).toBe(false);
  });
});

describe('validarEleccionComisionPago: moneda real de la cuenta', () => {
  it('rechaza si el cliente declara USD para una cuenta que en la BD es Bs', async () => {
    bd.monedaPorBanca.b9 = 'VES';
    expect(await validarEleccionComisionPago([{ bancaId: 'b9', moneda: 'USD' }])).toMatch(/no coincide/);
  });
  it('rechaza comisión declarada en Bs sobre una cuenta que en la BD es USD', async () => {
    bd.monedaPorBanca.b8 = 'USD';
    expect(await validarEleccionComisionPago([{ bancaId: 'b8', moneda: 'VES', llevaComision: true }])).toMatch(/no coincide/);
  });
});

describe('reintentarComisionDeBanca', () => {
  it('crea el cargo de la cuenta y le pone la categoría', async () => {
    bd.filas = [{ id: 'm1', banca_origen_id: 'b1', subtipo: 'pago' }];
    const r = await reintentarComisionDeBanca(['m1'], 'b1', USUARIO);
    expect(r).toEqual({ ok: true, comision: { bancaId: 'b1', movimientoId: 'c-m1', monto: 14 } });
    expect(bd.categoriaAplicada).toEqual([['c-m1']]);
  });

  it('si el pago ya tiene su comisión (un intento anterior sí llegó) cuenta como resuelto sin duplicar', async () => {
    bd.filas = [{ id: 'm1', banca_origen_id: 'b1', subtipo: 'pago' }];
    bd.rpcErrorPorMovimiento.m1 = { code: 'P0001', message: 'Este pago ya tiene comisión bancaria.' };
    expect(await reintentarComisionDeBanca(['m1'], 'b1', USUARIO)).toEqual({ ok: true });
  });

  it('otro error de la RPC o una cuenta sin movimiento devuelve ok:false con el motivo', async () => {
    bd.filas = [{ id: 'm1', banca_origen_id: 'b1', subtipo: 'pago' }];
    bd.rpcErrorPorMovimiento.m1 = { code: 'P0001', message: 'El pago está anulado' };
    expect(await reintentarComisionDeBanca(['m1'], 'b1', USUARIO)).toEqual({ ok: false, error: 'El pago está anulado' });
    expect(await reintentarComisionDeBanca(['m1'], 'bX', USUARIO)).toMatchObject({ ok: false });
  });

  it('si no se pueden leer los movimientos devuelve ok:false', async () => {
    bd.errorLectura = { message: 'caída' };
    expect(await reintentarComisionDeBanca(['m1'], 'b1', USUARIO)).toMatchObject({ ok: false });
  });
});
