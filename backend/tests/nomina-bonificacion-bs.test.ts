import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as back from '../src/utils/nomina-calculo';
import * as front from '../../shared/types/nomina-calculo';
import { armarNomina, payloadGuardado } from '../src/utils/nomina-armado';
import { guardarNominaSchema } from '../src/schemas/nomina';
import { mapNomina } from '../src/services/nomina-service';

/**
 * Bonificación extra «en Bs (ref.)»: USD de referencia que se pagan en bolívares a la tasa de la nómina (como el sueldo en Bs).
 * La bonificación de siempre (bonificacionUsd) sigue pagándose en divisas.
 */
const T1 = '11111111-1111-4111-8111-111111111111';
const base = { diasTrabajados: 5, montoBaseUsd: 20, montoBaseBs: 0, bonificacionUsd: 0, descuentoTrabajoUsd: 0, descuentoPrestamoUsd: 0 };

describe.each([['backend', back], ['shared', front]] as const)('calcularLinea con bonificación extra en Bs (%s)', (_n, m) => {
  it('se paga en Bs a la tasa, no toca la parte en divisas y suma al total del trabajador', () => {
    const l = m.calcularLinea({ ...base, bonificacionUsd: 5, bonificacionBsUsd: 10 }, 40);
    expect(l).toMatchObject({
      pagarUsd: 105, pagarBs: 400, equivalenteBsUsd: 10, totalUsd: 115, bonificacionUsd: 5, bonificacionBsUsd: 10, monedaPago: 'MIXTO',
    });
    // el bruto sigue siendo solo los sueldos: las bonificaciones van aparte
    expect(l.totalBrutoUsd).toBe(100);
  });

  it('sin el campo (clientes y nóminas anteriores) vale 0 y nada cambia', () => {
    expect(m.calcularLinea(base, 40)).toMatchObject({ bonificacionBsUsd: 0, pagarUsd: 100, pagarBs: 0, totalUsd: 100, monedaPago: 'USD' });
  });

  it('solo bonificación en Bs: el renglón se paga únicamente en bolívares', () => {
    const l = m.calcularLinea({ ...base, montoBaseUsd: 0, bonificacionBsUsd: 8 }, 36.5);
    expect(l).toMatchObject({ pagarUsd: 0, pagarBs: 292, equivalenteBsUsd: 8, totalUsd: 8, monedaPago: 'BS', faltaTasa: false });
  });

  it('con bonificación en Bs y sin tasa falta la tasa (no se puede calcular los Bs)', () => {
    const l = m.calcularLinea({ ...base, bonificacionBsUsd: 10 }, null);
    expect(l).toMatchObject({ faltaTasa: true, pagarBs: null });
  });

  it('cuenta como ganado para el tope del préstamo', () => {
    const e = { ...base, diasTrabajados: 1, montoBaseUsd: 20, bonificacionBsUsd: 10 }; // ganado 30
    expect(m.gananciaDeLinea(e)).toBe(30);
    expect(m.prestamoExcedeGanado({ ...e, descuentoPrestamoUsd: 30 })).toBe(false);
    expect(m.prestamoExcedeGanado({ ...e, descuentoPrestamoUsd: 30.01 })).toBe(true);
  });

  it('los descuentos que las divisas no cubren se cargan a la parte en Bs (incluida su bonificación)', () => {
    const l = m.calcularLinea({ ...base, diasTrabajados: 1, montoBaseUsd: 10, bonificacionBsUsd: 10, descuentoTrabajoUsd: 15 }, 40);
    expect(l).toMatchObject({ pagarUsd: 0, equivalenteBsUsd: 5, pagarBs: 200, totalUsd: 5, negativo: false });
  });
});

describe('paridad backend / shared con bonificación en Bs', () => {
  const casos = [
    { ...base, bonificacionBsUsd: 10 },
    { ...base, diasTrabajados: 4.5, montoBaseUsd: 17.3, montoBaseBs: 9.9, bonificacionUsd: 3.15, bonificacionBsUsd: 2.35, descuentoTrabajoUsd: 1.1, descuentoPrestamoUsd: 2.2 },
    { ...base, montoBaseUsd: 0, bonificacionBsUsd: 7.77, descuentoPrestamoUsd: 3 },
  ];
  it.each([null, 36.4567, 1])('calcularLinea con tasa %s', tasa => {
    expect(casos.map(c => front.calcularLinea(c, tasa))).toEqual(casos.map(c => back.calcularLinea(c, tasa)));
    casos.forEach(c => {
      expect(front.gananciaDeLinea(c)).toBe(back.gananciaDeLinea(c));
      expect(front.prestamoExcedeGanado(c)).toBe(back.prestamoExcedeGanado(c));
    });
  });
});

describe('guardarNominaSchema y armado del servidor', () => {
  const entrada = (extra: Record<string, unknown> = {}, tasaBs: number | null = 40) => guardarNominaSchema.safeParse({
    tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs, version: null,
    lineas: [{ trabajadorId: T1, diasTrabajados: 5, montoBaseUsd: 20, ...extra }],
  });

  it('bonificacionBsUsd es opcional (0 por defecto), no negativa y con 2 decimales como máximo', () => {
    const sin = entrada();
    expect(sin.success && sin.data.lineas[0].bonificacionBsUsd).toBe(0);
    expect(entrada({ bonificacionBsUsd: 12.5 }).success).toBe(true);
    expect(entrada({ bonificacionBsUsd: -1 }).success).toBe(false);
    expect(entrada({ bonificacionBsUsd: 1.234 }).success).toBe(false);
  });

  it('el servidor recalcula con la bonificación en Bs y la manda a guardar con el renglón', () => {
    const input = entrada({ bonificacionUsd: 5, bonificacionBsUsd: 10 });
    if (!input.success) throw new Error('entrada inválida');
    const armada = armarNomina(input.data, new Map([[T1, 'Ana Pérez']]));
    expect(armada.lineas[0]).toMatchObject({ pagarUsd: 105, pagarBs: 400, totalUsd: 115, bonificacionBsUsd: 10 });
    expect(armada.totales).toMatchObject({ totalDivisasUsd: 105, totalBs: 400, equivalenteUsdDeBs: 10, totalCombinadoUsd: 115 });
    expect(payloadGuardado(input.data, armada).lineas[0].bonificacionBsUsd).toBe(10);
  });

  it('con bonificación en Bs y sin tasa no se puede guardar (falta la tasa)', () => {
    const input = entrada({ bonificacionBsUsd: 10 }, null);
    if (!input.success) throw new Error('entrada inválida');
    expect(armarNomina(input.data, new Map([[T1, 'Ana Pérez']])).faltaTasa).toBe(true);
  });

  it('el préstamo no puede superar lo ganado incluyendo la bonificación en Bs', () => {
    const lineas = (cuota: number) => ({ diasTrabajados: 1, montoBaseUsd: 20, bonificacionBsUsd: 10, cuotas: [{ prestamoId: '33333333-3333-4333-8333-333333333333', montoUsd: cuota }] });
    expect(entrada(lineas(30)).success).toBe(true);
    expect(entrada(lineas(30.01)).success).toBe(false);
  });
});

describe('lectura de la nómina guardada', () => {
  const fila = (extra: Record<string, unknown>) => ({
    id: 'n1', numero: 7, tipo: 'OPERATIVO', semana_inicio: '2026-10-05', tasa_bs: 40, estado: 'CERRADA', version: 2,
    lineas: [{
      trabajador_id: T1, trabajador_nombre: 'Ana', moneda_pago: 'MIXTO', dias_trabajados: 5, monto_base_usd: 20, monto_base_bs: 0,
      total_bruto_usd: 100, bruto_bs: 0, monto_ref_bs: 4000, bonificacion_usd: 5, descuento_trabajo_usd: 0, descuento_prestamo_usd: 0,
      pagar_usd: 105, pagar_bs: 400, total_usd: 115, total_bs: 4600, nota: null, cuotas: [], ...extra,
    }],
  });
  it('lee la columna nueva; si la migración no está aplicada (columna ausente) o es una nómina anterior, es 0', () => {
    expect(mapNomina(fila({ bonificacion_bs_usd: '10.00' })).lineas[0].bonificacionBsUsd).toBe(10);
    expect(mapNomina(fila({})).lineas[0].bonificacionBsUsd).toBe(0);
  });
});

const sql = (nombre: string): string =>
  readFileSync(fileURLToPath(new URL(`../../docs/${nombre}`, import.meta.url)), 'utf-8').replace(/\r\n/g, '\n');

describe('migration_nomina_bonificacion_bs.sql', () => {
  const m = sql('migration_nomina_bonificacion_bs.sql');
  const rb = sql('migration_nomina_bonificacion_bs_ROLLBACK.sql');
  const guardar = m.slice(m.indexOf('create or replace function public.nomina_guardar('), m.indexOf('$function$;', m.indexOf('as $function$') + 10));

  it('agrega la columna con default 0 y check >= 0, de forma idempotente', () => {
    expect(m).toContain('add column if not exists bonificacion_bs_usd numeric(14,2) not null default 0 check (bonificacion_bs_usd >= 0)');
  });
  it('el tope del préstamo cuenta la bonificación en Bs, en el CHECK y en nomina_guardar', () => {
    expect(m).toContain('check (descuento_prestamo_usd <= total_bruto_usd + bonificacion_usd + bonificacion_bs_usd)');
    expect(guardar).toMatch(/descuentoPrestamoUsd'\)::numeric > .*bonificacionUsd'\)::numeric \+ v_bono_bs/);
  });
  it('nomina_guardar guarda la columna nueva y exige la tasa si hay bonificación en Bs', () => {
    expect(guardar).toMatch(/bonificacion_usd, bonificacion_bs_usd, descuento_trabajo_usd/);
    expect(guardar).toMatch(/\(v_base_bs > 0 or v_bono_bs > 0\)/);
    expect(guardar).toContain("v_bono_bs := coalesce(nullif(v_l->>'bonificacionBsUsd', '')::numeric, 0);");
    expect(guardar).toContain("set search_path = ''");
  });
  it('comprueba sus requisitos, reparte permisos y recarga PostgREST al final', () => {
    expect(m).toContain('Falta aplicar migration_nomina_sueldo_bs_referencia_usd.sql');
    expect(m).toContain('revoke execute on function public.nomina_guardar(jsonb, uuid) from public, anon, authenticated;');
    expect(m).toContain('grant execute on function public.nomina_guardar(jsonb, uuid) to service_role;');
    expect(m).toMatch(/^begin;/m);
    expect(m).toMatch(/^commit;/m);
    expect(m).not.toMatch(/drop table|truncate/i);
    expect(m.trimEnd()).toMatch(/notify pgrst, 'reload schema';[\s\S]*$/);
  });
  it('el ROLLBACK se niega si hay bonificaciones en Bs y restaura la función y el CHECK anteriores', () => {
    expect(rb).toMatch(/exists \(select 1 from public\.nomina_lineas where bonificacion_bs_usd > 0\)/);
    expect(rb).toContain('check (descuento_prestamo_usd <= total_bruto_usd + bonificacion_usd);');
    expect(rb).toContain('drop column if exists bonificacion_bs_usd');
    expect(rb).not.toContain('v_bono_bs');
    expect(rb.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
