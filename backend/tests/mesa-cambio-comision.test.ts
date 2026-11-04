import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  comisionEnUsd, conComisiones, construirEstadoCuenta, type AsientoMesa, type DatosComisionMovimiento,
} from '../src/utils/mesa-cambio.js';
import {
  buscarEvento, cuerpoCuentasTransferenciaMesa, detallesTransferenciaMesaCompletada, etiquetaTransferenciaMesa,
  type ContextoEvento,
} from '../src/services/grupo-eventos.js';
import { cuentasDeBody } from '../src/services/grupo-dinero.js';

const asiento = (o: Partial<AsientoMesa> & Pick<AsientoMesa, 'id' | 'numero' | 'tipo' | 'montoUsd'>): AsientoMesa => ({
  fecha: '2026-10-20', anulado: false, ...o,
});

describe('comisionEnUsd', () => {
  it('reparte el CARGO en proporción a comisión / bruto, a centavos', () => {
    expect(comisionEnUsd(1000, 20, 1000)).toBe(20);
    expect(comisionEnUsd(100, 2, 3650)).toBe(0.05);
  });

  it('sin bruto o sin comisión da 0', () => {
    expect(comisionEnUsd(100, 0, 500)).toBe(0);
    expect(comisionEnUsd(100, 5, 0)).toBe(0);
  });
});

describe('conComisiones (estado de cuenta del cambista)', () => {
  const asientos: AsientoMesa[] = [
    asiento({ id: 'a1', numero: 1, tipo: 'CARGO', montoUsd: 1000, movimientoId: 'm1' }),
    asiento({ id: 'a2', numero: 2, tipo: 'COBRO', montoUsd: 1000, movimientoId: 'm1' }),
    asiento({ id: 'a3', numero: 3, tipo: 'CARGO', montoUsd: 500, movimientoId: 'm2' }),
    asiento({ id: 'a4', numero: 4, tipo: 'CARGO', montoUsd: 300, movimientoId: 'm3', anulado: true }),
    asiento({ id: 'a5', numero: 5, tipo: 'ND', montoUsd: 10 }),
  ];
  const datos = new Map<string, DatosComisionMovimiento>([
    ['m1', { comision: 36.5, montoBruto: 36500, moneda: 'VES', numeroSistema: 7, completada: true }],
    ['m3', { comision: 9, montoBruto: 300, moneda: 'USD', numeroSistema: 9, completada: false }],
  ]);
  const base = construirEstadoCuenta(asientos, {});

  it('agrega la comisión solo al CARGO vigente de la transferencia que la tiene', () => {
    const r = conComisiones(base, datos);
    const porId = new Map(r.filas.map(f => [f.id, f]));
    expect(porId.get('a1')?.comision).toEqual({ monto: 36.5, moneda: 'VES', montoUsd: 1, movimientoNumero: 7, completada: true });
    expect(porId.get('a2')?.comision).toBeNull(); // el COBRO no repite la comisión
    expect(porId.get('a3')?.comision).toBeNull(); // m2 no tiene comisión
    expect(porId.get('a4')?.comision).toBeNull(); // asiento anulado
    expect(porId.get('a5')?.comision).toBeNull(); // asiento manual
  });

  it('suma el total de comisiones en USD sin tocar saldos, cargos ni cobros', () => {
    const r = conComisiones(base, datos);
    expect(r.totalComisionesUsd).toBe(1);
    expect(r.saldoFinal).toBe(base.saldoFinal);
    expect(r.totalCargos).toBe(base.totalCargos);
    expect(r.totalCobros).toBe(base.totalCobros);
    expect(r.filas.map(f => f.saldoCorrido)).toEqual(base.filas.map(f => f.saldoCorrido));
  });

  it('marca la comisión de una transferencia en proceso como no completada (texto neutro en pantalla)', () => {
    const r = conComisiones(construirEstadoCuenta([asiento({ id: 'b1', numero: 1, tipo: 'CARGO', montoUsd: 50, movimientoId: 'm9' })], {}),
      new Map([['m9', { comision: 5, montoBruto: 100, moneda: 'USD', numeroSistema: 3, completada: false }]]));
    expect(r.filas[0].comision).toMatchObject({ montoUsd: 2.5, completada: false });
  });

  it('no muta el estado de entrada y sin datos deja todas las comisiones en null', () => {
    const copia = JSON.stringify(base);
    const r = conComisiones(base, new Map());
    expect(JSON.stringify(base)).toBe(copia);
    expect(r.totalComisionesUsd).toBe(0);
    expect(r.filas.every(f => f.comision === null)).toBe(true);
  });
});

describe('aviso al grupo: transferencia con mesa completada', () => {
  const resBody = {
    movimiento: {
      id: 'mov-1', numeroSistema: 5, monto: 1200, moneda: 'USD', bancaOrigenId: 'banca-o', bancaDestinoId: 'banca-d',
      montoDestino: 43800, mesaComision: 438,
    },
    montoAcreditado: 43362, montoPendiente: 0, completada: true,
  };
  const ctx = (res: Record<string, unknown>, req: Record<string, unknown> = {}): ContextoEvento => ({
    metodo: 'POST', ruta: '/api/cochinito/movimientos/mov-1/completar', params: { id: 'mov-1' }, reqBody: req, resBody: res, extra: {},
  });

  it('el evento usa el rótulo, las cuentas y los detalles de la transferencia', () => {
    const e = buscarEvento('POST', '/api/cochinito/movimientos/mov-1/completar');
    expect(e?.evento.clave).toBe('banca.transferencia_mesa_completada');
    expect(e?.evento.cuerpoCuentas).toBe(cuerpoCuentasTransferenciaMesa);
  });

  it('nombra el número de movimiento con el correlativo MV-', () => {
    expect(etiquetaTransferenciaMesa(ctx(resBody))).toBe('Transferencia MV-0005');
    expect(etiquetaTransferenciaMesa(ctx({ movimiento: {} }))).toBe('Transferencia con mesa de cambio');
  });

  it('incluye el monto y la comisión de la mesa', () => {
    const detalles = detallesTransferenciaMesaCompletada(ctx(resBody));
    expect(detalles.some(l => l === 'Monto: 1200 USD')).toBe(true);
    expect(detalles).toContain('Comisión de la mesa: 438.00');
    expect(detalles.some(l => l.includes('PARCIAL'))).toBe(false);
  });

  it('en un cobro parcial no anuncia la comisión (su egreso se crea al completar)', () => {
    const detalles = detallesTransferenciaMesaCompletada(ctx({ ...resBody, completada: false, montoPendiente: 50 }));
    expect(detalles.some(l => l.startsWith('Comisión'))).toBe(false);
  });

  it('avisa el cobro parcial y la observación como antes', () => {
    const detalles = detallesTransferenciaMesaCompletada(ctx({ ...resBody, montoPendiente: 50 }, { observacion: 'Entregó la mitad' }));
    expect(detalles).toContain('Cobro PARCIAL: faltan 50.00 por cobrar al cambista');
    expect(detalles).toContain('Observación: Entregó la mitad');
  });

  it('las cuentas origen y destino salen de la respuesta (el body del cobro no las trae)', () => {
    const refs = cuentasDeBody(cuerpoCuentasTransferenciaMesa(ctx(resBody)));
    expect(refs).toEqual([
      { rol: 'Cuenta origen', id: 'banca-o', monto: 1200, moneda: 'USD' },
      { rol: 'Cuenta destino', id: 'banca-d', monto: 43362, moneda: null },
    ]);
  });

  it('sin movimiento en la respuesta no inventa cuentas', () => {
    expect(cuerpoCuentasTransferenciaMesa(ctx({}))).toEqual({});
  });
});

describe('migración de la comisión como movimiento', () => {
  const sql = readFileSync(path.resolve(import.meta.dirname, '../../docs/migration_mesa_cambio_comision_movimiento.sql'), 'utf8');

  it('crea el enlace propio (sin reutilizar comision_de_id) y la categoría', () => {
    expect(sql).toContain('mesa_comision_de_id');
    expect(sql).toContain("'Comisión cambio de divisas'");
    expect(sql).toMatch(/insert into public\.movimientos[\s\S]*mesa_comision_de_id/);
  });

  it('anular revierte también el egreso de comisión', () => {
    expect(sql).toMatch(/where mesa_comision_de_id = m\.id and not anulado/);
  });
});
