import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { construirEstadoCuenta, saldoDeAsientos, type AsientoMesa } from '../src/utils/mesa-cambio';
import { describirSaldo } from '../../shared/types/mesa-cambio';
import { montoPendienteMesa } from '../../frontend/src/features/cochinito/cobro-mesa';
import { esTransferenciaEnProceso, etiquetaEstadoMesa } from '../../frontend/src/features/cochinito/detalle-movimiento';

/**
 * Mesa de cambio: con el cambista la deuda es SUYA hacia nosotros.
 *  - Toda transferencia con cambista crea al registrarse su CARGO (la deuda del cambista), siempre y en la misma transacción.
 *  - Mientras no se cobre completa, el saldo queda "pendiente por cobrar"; si el saldo favorece al cambista, "se le debe".
 */
let n = 0;
const asiento = (tipo: AsientoMesa['tipo'], monto: number, fecha = '2026-10-01', extra: Partial<AsientoMesa> = {}): AsientoMesa => ({
  id: `a${++n}`, numero: n, tipo, montoUsd: monto, fecha, anulado: false, ...extra,
});

describe('saldo del cambista: pendiente por cobrar hasta que se complete', () => {
  it('transferencia en proceso: el CARGO deja el saldo pendiente por cobrar (nos debe el cambista)', () => {
    const saldo = saldoDeAsientos([asiento('CARGO', 500, '2026-10-01', { movimientoId: 'm1' })]);
    expect(saldo).toBe(500);
    expect(describirSaldo(saldo)).toMatchObject({ sentido: 'por_cobrar', etiqueta: 'Pendiente por cobrar', monto: 500 });
  });

  it('cobro parcial: sigue pendiente por cobrar solo lo que falta', () => {
    const saldo = saldoDeAsientos([asiento('CARGO', 500), asiento('COBRO', 200)]);
    expect(describirSaldo(saldo)).toMatchObject({ sentido: 'por_cobrar', monto: 300 });
  });

  it('completada: el saldo vuelve a cero (al día)', () => {
    const saldo = saldoDeAsientos([asiento('CARGO', 500), asiento('COBRO', 200), asiento('COBRO', 300)]);
    expect(describirSaldo(saldo).sentido).toBe('en_cero');
  });

  it('si el saldo queda a favor del cambista se indica que SE LE DEBE', () => {
    const saldo = saldoDeAsientos([asiento('CARGO', 100), asiento('NC', 130)]);
    const d = describirSaldo(saldo);
    expect(d).toMatchObject({ sentido: 'se_le_debe', etiqueta: 'Se le debe', monto: 30 });
    expect(d.texto).toBe('Se le debe USD 30,00 al cambista');
  });

  it('el estado de cuenta arrastra el signo: positivo = por cobrar, negativo = se le debe', () => {
    const e = construirEstadoCuenta([asiento('CARGO', 80, '2026-10-01'), asiento('COBRO', 100, '2026-10-02')], {});
    expect(e.saldoFinal).toBe(-20);
    expect(describirSaldo(e.saldoFinal).sentido).toBe('se_le_debe');
  });
});

describe('detalle de la transferencia en Wallet: pendiente por cobrar mientras no se complete', () => {
  const base = {
    anulado: false, mesaCambistaId: 'c1', mesaMontoBruto: 1000, mesaComision: 20, mesaMontoCobrado: 0, montoDestino: null, monto: 1000,
  } as const;

  it('en proceso: queda por cobrar todo el neto (bruto - comisión)', () => {
    const m = { ...base, mesaEstado: 'en_proceso' as const };
    expect(esTransferenciaEnProceso(m)).toBe(true);
    expect(etiquetaEstadoMesa(m)).toBe('En proceso');
    expect(montoPendienteMesa(m)).toBe(980);
  });
  it('parcial: queda por cobrar lo que falta', () => {
    expect(montoPendienteMesa({ ...base, mesaEstado: 'parcial' as const, mesaMontoCobrado: 300 })).toBe(680);
  });
  it('completada: nada pendiente', () => {
    const m = { ...base, mesaEstado: 'completada' as const };
    expect(esTransferenciaEnProceso(m)).toBe(false);
    expect(montoPendienteMesa(m)).toBe(0);
  });
});

const sql = (nombre: string): string =>
  readFileSync(fileURLToPath(new URL(`../../docs/${nombre}`, import.meta.url)), 'utf-8').replace(/\r\n/g, '\n');

describe('toda transferencia con cambista crea la deuda del cambista (contrato del SQL)', () => {
  const m = sql('migration_mesa_cambio_transferencias.sql');
  const inicio = m.indexOf('create or replace function public.crear_transferencia_mesa_cambio(');
  const crear = m.slice(inicio, m.indexOf('$$;', m.indexOf('as $$', inicio) + 5));

  it('crear_transferencia_mesa_cambio inserta SIEMPRE el CARGO, sin condiciones, ligado al movimiento y en la misma transacción', () => {
    expect(crear).toMatch(/insert into public\.cambista_asientos[\s\S]*'CARGO'[\s\S]*v_mov_id/);
    // el CARGO se inserta justo después del movimiento y ningún `if` lo condiciona
    const despuesDelMovimiento = crear.slice(crear.indexOf('returning id, numero_sistema into v_mov_id, v_num;'));
    expect(despuesDelMovimiento.indexOf("'CARGO'")).toBeGreaterThan(-1);
    expect(despuesDelMovimiento.slice(0, despuesDelMovimiento.indexOf("'CARGO'"))).not.toMatch(/\bif\b|\bcase\b/);
    // el importe del CARGO es el equivalente en USD de la operación, y es obligatorio (mayor a 0)
    expect(crear).toMatch(/\(p_cambista_id, 'CARGO', v_usd, p_fecha,/);
    expect(crear).toMatch(/v_usd is null or v_usd <= 0/);
  });

  it('la transferencia nace en proceso (pendiente por cobrar) y no acredita el destino hasta cobrar', () => {
    expect(crear).toContain("p_cambista_id, 'en_proceso', v_bruto");
  });

  it('no existe otra ruta que cree una transferencia con cambista sin su CARGO', () => {
    const creadores = [...m.matchAll(/mesa_cambista_id/g)].length;
    expect(creadores).toBeGreaterThan(0);
    const inserts = [...m.matchAll(/insert into public\.movimientos[\s\S]*?mesa_cambista_id/g)];
    expect(inserts).toHaveLength(1);
  });
});
