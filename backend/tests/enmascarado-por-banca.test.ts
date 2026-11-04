import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estado, reiniciarSupabaseFalso } from './helpers/supabase-falso';

vi.mock('../src/config/supabase.js', async () => ({
  supabaseAdmin: (await import('./helpers/supabase-falso')).supabaseAdminFalso,
}));

import { obtenerPagoDetalle } from '../src/services/pago-detalle-service.js';
import { obtenerEstadoCuenta } from '../src/services/estado-cuenta-service.js';
import {
  cuentaVisible, enmascararDetalleMovimiento, enmascararMovimientoPorBanca, enmascararMovimientosPorBanca,
  tieneExtremoOculto, TEXTO_CUENTA_RESTRINGIDA,
} from '../src/utils/banca-acceso.js';

const PROV = '11111111-1111-4111-8111-111111111111';
const GRUPO = '22222222-2222-4222-8222-222222222222';

const fila = (id: string, bancaId: string, referencia: string, comprobantes: string[]) => ({
  id, proveedor_id: PROV, tipo: 'egreso', subtipo: 'pago', numero: 7, grupo_id: GRUPO,
  monto: 100, moneda: 'USD', monto_usd: 100, descripcion: 'Pago', referencia, fecha: '2026-10-01',
  comprobantes, registrado_por: null, banca_origen_id: bancaId, creado_en: '2026-10-01T10:00:00Z', anulado: false,
});

beforeEach(() => {
  reiniciarSupabaseFalso();
  estado.tablas.proveedores = [{ id: PROV, nombre: 'Metales Caribe' }];
  estado.tablas.bancas = [{ id: 'bA', nombre: 'Banesco' }, { id: 'bB', nombre: 'Caja secreta' }];
  estado.tablas.movimientos = [
    fila('m1', 'bA', 'REF-A', ['a.jpg']),
    fila('m2', 'bB', 'REF-B', ['b.jpg']),
  ];
});

describe('reglas puras de enmascarado', () => {
  it('cuentaVisible: sin banca o sin restricción es visible', () => {
    expect(cuentaVisible(null, 'x')).toBe(true);
    expect(cuentaVisible(new Set(), null)).toBe(true);
    expect(cuentaVisible(new Set(['a']), 'b')).toBe(false);
  });

  it('enmascararDetalleMovimiento oculta solo la punta sin acceso y no muta el original', () => {
    const d = { movimiento: { bancaOrigenId: 'o', bancaDestinoId: 'd' }, bancaOrigenNombre: 'Origen', bancaDestinoNombre: 'Destino' };
    const solo = enmascararDetalleMovimiento(d, new Set(['d']));
    expect(solo.bancaOrigenNombre).toBe(TEXTO_CUENTA_RESTRINGIDA);
    expect(solo.bancaDestinoNombre).toBe('Destino');
    expect(enmascararDetalleMovimiento(d, new Set(['o'])).bancaDestinoNombre).toBe(TEXTO_CUENTA_RESTRINGIDA);
    expect(d.bancaOrigenNombre).toBe('Origen');
    expect(enmascararDetalleMovimiento(d, null)).toBe(d);
  });
});

describe('enmascarado de transferencias con un extremo sin acceso', () => {
  const transferencia = {
    id: 't1', tipo: 'transferencia', monto: 100, bancaOrigenId: 'o', bancaDestinoId: 'd',
    referencia: 'REF-SECRETA', descripcion: 'Pago a Caja secreta', comprobantes: ['x.jpg'],
  };

  it('tieneExtremoOculto: solo las transferencias con un extremo fuera del acceso', () => {
    expect(tieneExtremoOculto(null, transferencia)).toBe(false);
    expect(tieneExtremoOculto(new Set(['o', 'd']), transferencia)).toBe(false);
    expect(tieneExtremoOculto(new Set(['o']), transferencia)).toBe(true);
    expect(tieneExtremoOculto(new Set(['d']), transferencia)).toBe(true);
    expect(tieneExtremoOculto(new Set(['x']), { bancaOrigenId: 'x', bancaDestinoId: null })).toBe(false);
  });

  it('oculta referencia, descripcion y comprobantes pero conserva los montos, sin mutar el original', () => {
    const r = enmascararMovimientoPorBanca(transferencia, new Set(['o']));
    expect(r.referencia).toBe(TEXTO_CUENTA_RESTRINGIDA);
    expect(r.descripcion).toBe(TEXTO_CUENTA_RESTRINGIDA);
    expect(r.comprobantes).toEqual([]);
    expect(r.monto).toBe(100);
    expect(transferencia.referencia).toBe('REF-SECRETA');
    expect(transferencia.comprobantes).toEqual(['x.jpg']);
  });

  it('con acceso a las dos puntas, o sin restriccion, devuelve el mismo objeto', () => {
    expect(enmascararMovimientoPorBanca(transferencia, new Set(['o', 'd']))).toBe(transferencia);
    expect(enmascararMovimientoPorBanca(transferencia, null)).toBe(transferencia);
  });

  it('un ingreso o egreso (sin destino) no se enmascara', () => {
    const egreso = { ...transferencia, bancaDestinoId: null };
    expect(enmascararMovimientoPorBanca(egreso, new Set(['o']))).toBe(egreso);
  });

  it('enmascararMovimientosPorBanca trata cada fila por separado', () => {
    const propia = { ...transferencia, id: 't2', bancaDestinoId: 'o2', bancaOrigenId: 'o' };
    const [a, b] = enmascararMovimientosPorBanca([transferencia, propia], new Set(['o', 'o2']));
    expect(a.referencia).toBe(TEXTO_CUENTA_RESTRINGIDA);
    expect(b.referencia).toBe('REF-SECRETA');
  });

  it('el detalle tambien enmascara el movimiento', () => {
    const d = { movimiento: transferencia, bancaOrigenNombre: 'Origen', bancaDestinoNombre: 'Destino' };
    const r = enmascararDetalleMovimiento(d, new Set(['d']));
    expect(r.movimiento.referencia).toBe(TEXTO_CUENTA_RESTRINGIDA);
    expect(r.movimiento.comprobantes).toEqual([]);
    expect(r.bancaOrigenNombre).toBe(TEXTO_CUENTA_RESTRINGIDA);
  });
});

describe('obtenerPagoDetalle con cuentas restringidas', () => {
  it('sin restricción muestra todo', async () => {
    const r = await obtenerPagoDetalle('proveedor', PROV, GRUPO);
    if ('error' in r) throw new Error(r.error);
    expect(r.bancas.map(b => b.bancaNombre)).toEqual(['Banesco', 'Caja secreta']);
  });

  it('conserva todas las filas (totales exactos) pero oculta nombre, referencia y comprobante de la cuenta sin acceso', async () => {
    const r = await obtenerPagoDetalle('proveedor', PROV, GRUPO, new Set(['bA']));
    if ('error' in r) throw new Error(r.error);
    expect(r.bancas).toHaveLength(2);
    expect(r.totalUsd).toBe(200);
    expect(r.bancas[0]).toMatchObject({ bancaNombre: 'Banesco', referencia: 'REF-A' });
    expect(r.bancas[1]).toMatchObject({ bancaId: null, bancaNombre: TEXTO_CUENTA_RESTRINGIDA, referencia: TEXTO_CUENTA_RESTRINGIDA });
    expect(r.comprobantes).toEqual(['a.jpg']);
    expect(JSON.stringify(r)).not.toContain('Caja secreta');
    expect(JSON.stringify(r)).not.toContain('b.jpg');
  });

  it('sin acceso a ninguna cuenta no hay comprobantes ni nombres', async () => {
    const r = await obtenerPagoDetalle('proveedor', PROV, GRUPO, new Set());
    if ('error' in r) throw new Error(r.error);
    expect(r.comprobantes).toEqual([]);
    expect(r.bancas.every(b => b.bancaNombre === TEXTO_CUENTA_RESTRINGIDA)).toBe(true);
  });
});

describe('obtenerEstadoCuenta con cuentas restringidas', () => {
  const referencias = (e: NonNullable<Awaited<ReturnType<typeof obtenerEstadoCuenta>>>) =>
    e.entradas.map(x => x.referenciaExterna ?? x.referencia);

  it('no quita filas ni cambia el saldo, solo oculta la referencia de la cuenta sin acceso', async () => {
    estado.tablas.movimientos = [
      { ...fila('m1', 'bA', 'REF-A', []), grupo_id: null, numero: null, subtipo: null },
      { ...fila('m2', 'bB', 'REF-B', []), grupo_id: null, numero: null, subtipo: null },
    ];
    const libre = await obtenerEstadoCuenta('proveedor', PROV);
    const restringido = await obtenerEstadoCuenta('proveedor', PROV, undefined, undefined, new Set(['bA']));
    expect(libre && restringido).toBeTruthy();
    expect(restringido!.totales).toEqual(libre!.totales);
    expect(restringido!.entradas).toHaveLength(libre!.entradas.length);
    expect(referencias(libre!)).toEqual(expect.arrayContaining(['REF-A', 'REF-B']));
    expect(referencias(restringido!)).toEqual(expect.arrayContaining(['REF-A', TEXTO_CUENTA_RESTRINGIDA]));
    expect(JSON.stringify(restringido)).not.toContain('REF-B');
  });

  it('con rango de fechas devuelve el periodo y el saldo actual de toda la cuenta', async () => {
    estado.tablas.movimientos = [{ ...fila('m1', 'bA', 'REF-A', []), grupo_id: null, numero: null, subtipo: null }];
    const r = await obtenerEstadoCuenta('proveedor', PROV, '2026-10-01', '2026-10-31');
    expect(r?.periodo).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(r?.saldoActual).toBe(-100);
    const sinRango = await obtenerEstadoCuenta('proveedor', PROV);
    expect(sinRango?.periodo).toBeUndefined();
    expect(sinRango?.saldoActual).toBe(sinRango?.totales.saldo);
  });
});
