import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bdFalsa } from './helpers/bd-falsa-compartida.js';

vi.mock('../src/config/supabase.js', async () => {
  const { bdFalsa: bd } = await import('./helpers/bd-falsa-compartida.js');
  return { supabaseAdmin: bd.cliente };
});
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => '' }));

const { resumirNotasVenta, obtenerResumenNotasVenta, resumenNotasVentaONull } = await import('../src/services/notas-resumen-service.js');
import { emitidoConNotas } from '../../frontend/src/lib/facturas-kpis';
import { totalesAdelantosDeFilas, type FilaTercero } from '../../frontend/src/lib/terceros-kpis';
import type { SaldoEntidad } from '../../shared/types/saldos';

const nota = (tipo: 'credito' | 'debito', monto: number | string, anulada = false) => ({ tipo, monto, anulada });

describe('resumirNotasVenta', () => {
  it('suma por tipo las notas vigentes', () => {
    const r = resumirNotasVenta([nota('debito', 100), nota('debito', 50.25), nota('credito', 30), nota('credito', 10.5)]);
    expect(r).toEqual({ notasDebito: 150.25, notasCredito: 40.5, cantidadDebito: 2, cantidadCredito: 2 });
  });

  it('ignora las anuladas', () => {
    const r = resumirNotasVenta([nota('debito', 100, true), nota('credito', 30, true), nota('credito', 5)]);
    expect(r).toEqual({ notasDebito: 0, notasCredito: 5, cantidadDebito: 0, cantidadCredito: 1 });
  });

  it('cuenta también las notas ya aplicadas a un cobro (no cambian lo emitido)', () => {
    // el resumen no distingue pagadas: solo vigentes
    expect(resumirNotasVenta([{ tipo: 'debito', monto: 40, anulada: false }]).notasDebito).toBe(40);
  });

  it('suma en centavos exactos (sin error de coma flotante) y acepta montos como texto', () => {
    const r = resumirNotasVenta([nota('debito', 0.1), nota('debito', 0.2), nota('credito', '0.30')]);
    expect(r.notasDebito).toBe(0.3);
    expect(r.notasCredito).toBe(0.3);
  });

  it('sin notas todo es cero', () => {
    expect(resumirNotasVenta([])).toEqual({ notasDebito: 0, notasCredito: 0, cantidadDebito: 0, cantidadCredito: 0 });
  });
});

describe('obtenerResumenNotasVenta (con BD falsa)', () => {
  beforeEach(() => {
    bdFalsa.reiniciar();
    bdFalsa.tablas.notas_ajuste_cliente = [
      { id: 'n1', tipo: 'debito', monto: 100, anulada: false, fecha: '2026-10-05' },
      { id: 'n2', tipo: 'credito', monto: 30, anulada: false, fecha: '2026-10-10' },
      { id: 'n3', tipo: 'debito', monto: 999, anulada: true, fecha: '2026-10-10' },
      { id: 'n4', tipo: 'credito', monto: 7, anulada: false, fecha: '2026-09-01' },
    ];
  });

  it('suma todas las vigentes cuando no hay periodo', async () => {
    const r = await obtenerResumenNotasVenta();
    expect(r).toMatchObject({ notasDebito: 100, notasCredito: 37 });
  });

  it('respeta el periodo por la fecha de la nota', async () => {
    const r = await obtenerResumenNotasVenta('2026-10-01', '2026-10-31');
    expect(r).toMatchObject({ notasDebito: 100, notasCredito: 30 });
  });

  it('si la lectura falla lanza; la variante "ONull" devuelve null', async () => {
    bdFalsa.errores.notas_ajuste_cliente = { message: 'boom' };
    await expect(obtenerResumenNotasVenta()).rejects.toThrow();
    expect(await resumenNotasVentaONull()).toBeNull();
  });
});

describe('emitidoConNotas (indicador "Emitido sin registro de cobros")', () => {
  it('suma las notas de débito y resta las de crédito a lo facturado', () => {
    expect(emitidoConNotas(1000, { notasDebito: 150, notasCredito: 40 })).toEqual({ facturas: 1000, notasDebito: 150, notasCredito: 40, total: 1110 });
  });

  it('sin notas cargadas se queda en las facturas', () => {
    expect(emitidoConNotas(1000, null)).toEqual({ facturas: 1000, notasDebito: 0, notasCredito: 0, total: 1000 });
  });

  it('trabaja en centavos exactos', () => {
    expect(emitidoConNotas(0.1, { notasDebito: 0.2, notasCredito: 0 }).total).toBe(0.3);
    expect(emitidoConNotas(100.1, { notasDebito: 0, notasCredito: 0.2 }).total).toBe(99.9);
  });

  it('las notas de crédito pueden superar lo facturado: el total queda negativo, no se oculta', () => {
    expect(emitidoConNotas(10, { notasDebito: 0, notasCredito: 25 }).total).toBe(-15);
  });
});

describe('totalesAdelantosDeFilas (Proveedores: cuánto hemos adelantado)', () => {
  const saldo = (adelantado: number, adelantoDisponible: number): SaldoEntidad => ({
    entidadId: 'x', nombre: 'x', activo: true, facturado: 0, pagado: 0, saldo: 0, adelantado, adelantoDisponible,
    notasCreditoDisponibles: 0, ultimaOperacion: null, cantidadFacturasPendientes: 0, antiguedadMasVieja: null,
  });
  const fila = (s: SaldoEntidad | null): FilaTercero => ({
    id: 'x', nombre: 'x', identificacion: null, telefono: null, email: null, activo: true, telegramChatId: null, telegramLinkedAt: null, saldo: s,
  });

  it('suma lo adelantado y lo que sigue sin aplicar, y cuenta los proveedores con adelanto', () => {
    expect(totalesAdelantosDeFilas([fila(saldo(100, 40)), fila(saldo(50.5, 50.5)), fila(saldo(0, 0))]))
      .toEqual({ adelantado: 150.5, disponible: 90.5, conAdelanto: 2 });
  });

  it('sin cifras (saldo null) cuenta 0', () => {
    expect(totalesAdelantosDeFilas([fila(null)])).toEqual({ adelantado: 0, disponible: 0, conAdelanto: 0 });
    expect(totalesAdelantosDeFilas([])).toEqual({ adelantado: 0, disponible: 0, conAdelanto: 0 });
  });

  it('suma en centavos exactos', () => {
    expect(totalesAdelantosDeFilas([fila(saldo(0.1, 0.1)), fila(saldo(0.2, 0.2))])).toMatchObject({ adelantado: 0.3, disponible: 0.3 });
  });
});
