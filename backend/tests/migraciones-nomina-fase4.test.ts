import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Contrato de las migraciones de la fase 4 de la nómina (sueldo en Bs como referencia USD, pago por trabajador, desembolso de
 * préstamos). No se pueden ejecutar en las pruebas (no hay Postgres): se fijan las reglas de seguridad y de negocio acordadas.
 */
const sql = (nombre: string): string =>
  readFileSync(fileURLToPath(new URL(`../../docs/${nombre}`, import.meta.url)), 'utf-8').replace(/\r\n/g, '\n');

function funcion(texto: string, nombre: string): string {
  const inicio = texto.indexOf(`create or replace function public.${nombre}(`);
  expect(inicio, `función ${nombre}`).toBeGreaterThan(-1);
  const fin = texto.indexOf('$function$;', texto.indexOf('as $function$', inicio) + 10);
  return texto.slice(inicio, fin);
}

/** Recarga el esquema de PostgREST como último comando (después solo pueden venir comentarios, p. ej. las consultas de verificación). */
function termina(texto: string): boolean {
  const marca = "notify pgrst, 'reload schema';";
  const i = texto.lastIndexOf(marca);
  return i > -1 && texto.slice(i + marca.length).split(/\r?\n/).every(l => l.trim() === '' || l.trim().startsWith('--'));
}

describe('migration_nomina_sueldo_bs_referencia_usd.sql', () => {
  const m = sql('migration_nomina_sueldo_bs_referencia_usd.sql');
  const rollback = sql('migration_nomina_sueldo_bs_referencia_usd_ROLLBACK.sql');

  it('no modifica ningún monto: solo agrega y marca una columna (sueldo_bs_en_usd) en los renglones cerrados o anulados con Bs', () => {
    expect(m).toContain('add column sueldo_bs_en_usd boolean not null default true');
    expect(m).toMatch(/set sueldo_bs_en_usd = false[\s\S]*where n\.id = l\.nomina_id and l\.monto_base_bs > 0/);
    expect(m).not.toMatch(/update public\.nomina_trabajadores/);
    expect(m).not.toMatch(/set monto_base_bs|set pago_diario_bs|set total_usd|set pagar_bs/);
  });

  it('desactiva el trigger de renglones protegidos solo para marcar y lo vuelve a activar', () => {
    expect(m.indexOf('disable trigger trg_nomina_lineas_proteger')).toBeGreaterThan(-1);
    expect(m.indexOf('enable trigger trg_nomina_lineas_proteger')).toBeGreaterThan(m.indexOf('disable trigger trg_nomina_lineas_proteger'));
  });

  it('es idempotente, termina recargando PostgREST y documenta qué pasa con los sueldos guardados', () => {
    expect(m).toMatch(/if not exists \(select 1 from information_schema\.columns/);
    expect(termina(m)).toBe(true);
    expect(m).toMatch(/pago_diario_bs NO se toca/);
  });

  it('el rollback se niega si hay nóminas cerradas con el formato nuevo y quita la columna', () => {
    expect(rollback).toMatch(/raise exception/);
    expect(rollback).toMatch(/drop column if exists sueldo_bs_en_usd/);
    expect(termina(rollback)).toBe(true);
  });
});

describe('migration_nomina_pago_por_trabajador.sql', () => {
  const m = sql('migration_nomina_pago_por_trabajador.sql');
  const rollback = sql('migration_nomina_pago_por_trabajador_ROLLBACK.sql');
  const pagar = funcion(m, 'nomina_pagar_trabajador');

  it('nomina_pagos liga un renglón y los únicos pasan a parciales: uno por nómina/moneda (completa) y otro por renglón/moneda', () => {
    expect(m).toContain('add column if not exists linea_id uuid references public.nomina_lineas(id) on delete restrict');
    expect(m).toMatch(/uq_nomina_pagos_nomina_moneda\s+on public\.nomina_pagos \(nomina_id, moneda_pago\) where linea_id is null/);
    expect(m).toMatch(/uq_nomina_pagos_linea_moneda\s+on public\.nomina_pagos \(linea_id, moneda_pago\) where linea_id is not null/);
  });

  it('pagar toda la nómina y pagar por trabajador son excluyentes (trigger) y el renglón debe ser de la nómina', () => {
    const f = funcion(m, 'nomina_pagos_exclusividad');
    expect(f).toMatch(/p\.linea_id is not null/);
    expect(f).toMatch(/p\.linea_id is null/);
    expect(f).toMatch(/l\.id = new\.linea_id and l\.nomina_id = new\.nomina_id/);
    expect(m).toMatch(/create trigger trg_nomina_pagos_exclusividad\s+before insert on public\.nomina_pagos/);
  });

  it('nomina_pagar_trabajador: search_path vacío, bloquea nómina y cuentas, exige nómina cerrada y es idempotente', () => {
    expect(pagar).toMatch(/set search_path = ''/);
    expect(pagar).toMatch(/from public\.nominas where id = p_nomina_id for update/);
    expect(pagar).toMatch(/Solo se puede pagar una nómina cerrada/);
    expect(pagar).toMatch(/perform 1 from public\.bancas[\s\S]*for update/);
    expect(pagar).toMatch(/return jsonb_build_object\('yaPagada', true\)/);
  });

  it('los montos salen del renglón (pagar_usd / pagar_bs), nunca del navegador, y el equivalente de los Bs es total_usd - pagar_usd', () => {
    expect(pagar).toMatch(/v_l\.pagar_usd else v_l\.pagar_bs/);
    expect(pagar).toMatch(/v_l\.total_usd - v_l\.pagar_usd/);
    expect(pagar).not.toMatch(/p_datos->>'monto/);
  });

  it('la tasa Binance se congela del día REAL del registro, no de la fecha elegida', () => {
    expect(pagar).toMatch(/tasa_binance_del_dia\(v_hoy_real\)/);
  });

  it('reutiliza la comisión bancaria vigente, la categoría y guarda los comprobantes en movimientos.comprobantes (máximo 10)', () => {
    expect(pagar).toContain('public.crear_movimiento_con_comision_bancaria(');
    expect(pagar).toMatch(/Indica si el pago en bolívares lleva comisión bancaria/);
    expect(pagar).toMatch(/update public\.movimientos set categoria_id = v_cat/);
    expect(pagar).toMatch(/update public\.movimientos set comprobantes = to_jsonb\(v_comp\) where id = v_mov_id/);
    expect(pagar).toMatch(/cardinality\(v_comp\) > 10/);
  });

  it('el egreso no lleva datos personales: solo número de nómina, tipo, semana y «pago individual»', () => {
    expect(pagar).toMatch(/pago individual/);
    expect(pagar).not.toMatch(/trabajador_nombre|cedula/);
  });

  it('solo service_role ejecuta; termina recargando PostgREST; no reemplaza nomina_pagar ni nomina_anular', () => {
    expect(m).toContain('revoke execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) from public, anon, authenticated');
    expect(m).toContain('grant execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) to service_role');
    expect(termina(m)).toBe(true);
    expect(m).not.toMatch(/create or replace function public\.nomina_pagar\(/);
    expect(m).not.toMatch(/create or replace function public\.nomina_anular\(/);
  });

  it('el rollback se niega si ya hay pagos por trabajador y restaura la unicidad anterior', () => {
    expect(rollback).toMatch(/where linea_id is not null\)' into v_usado;[\s\S]*if v_usado then\s+raise exception/);
    expect(rollback).toMatch(/unique \(nomina_id, moneda_pago\)/);
    expect(termina(rollback)).toBe(true);
  });
});

describe('migration_nomina_prestamo_desembolso.sql', () => {
  const m = sql('migration_nomina_prestamo_desembolso.sql');
  const rollback = sql('migration_nomina_prestamo_desembolso_ROLLBACK.sql');
  const pagar = funcion(m, 'nomina_prestamo_pagar');
  const anular = funcion(m, 'nomina_prestamo_anular');

  it('la tabla de desembolsos es única por préstamo y por movimiento, inmutable, con RLS deny-all', () => {
    expect(m).toMatch(/unique \(prestamo_id\)/);
    expect(m).toMatch(/unique \(movimiento_id\)/);
    expect(m).toMatch(/constraint nomina_prestamo_pagos_tasa_coherente check \(\(moneda = 'VES'\) = \(tasa_bs is not null\)\)/);
    expect(m).toMatch(/create trigger trg_nomina_prestamo_pagos_proteger\s+before update or delete/);
    expect(m).toContain('alter table public.nomina_prestamo_pagos enable row level security');
    expect(m).toMatch(/using \(false\) with check \(false\)/);
  });

  it('nomina_prestamo_pagar: cuenta USD = monto del préstamo; cuenta Bs = monto x tasa (tasa obligatoria), calculado en la BD', () => {
    expect(pagar).toMatch(/set search_path = ''/);
    expect(pagar).toMatch(/v_monto := round\(v_p\.monto_usd \* v_tasa, 2\)/);
    expect(pagar).toMatch(/Indica la tasa/);
    expect(pagar).toMatch(/v_monto := v_p\.monto_usd/);
    expect(pagar).not.toMatch(/p_datos->>'monto/);
  });

  it('bloquea préstamo y cuenta, valida saldo y comisión, es idempotente y rechaza préstamos anulados', () => {
    expect(pagar).toMatch(/from public\.nomina_prestamos where id = p_prestamo_id for update/);
    expect(pagar).toMatch(/from public\.bancas where id = v_banca for update/);
    expect(pagar).toMatch(/Saldo insuficiente/);
    expect(pagar).toMatch(/Indica si el pago en bolívares lleva comisión bancaria/);
    expect(pagar).toMatch(/return jsonb_build_object\('yaPagado', true\)/);
    expect(pagar).toMatch(/préstamo anulado/);
  });

  it('guarda los comprobantes en movimientos.comprobantes y el egreso no lleva datos personales', () => {
    expect(pagar).toMatch(/update public\.movimientos set comprobantes = to_jsonb\(v_comp\) where id = v_mov_id/);
    expect(pagar).toMatch(/desembolso/);
    expect(pagar).not.toMatch(/trabajador|cedula/);
  });

  it('anular el préstamo anula también el egreso (con su comisión) dentro de la misma transacción', () => {
    expect(anular).toMatch(/set estado = 'ANULADO'/);
    expect(anular).toMatch(/set_config\('app\.nomina_pago_rpc', 'on', true\)/);
    expect(anular).toMatch(/anular_movimiento_con_comision_bancaria/);
    expect(anular).toMatch(/anular_movimiento_banca/);
    // primero se anula el préstamo (el trigger rechaza si ya hay cuotas) y recién después el egreso
    expect(anular.indexOf("set estado = 'ANULADO'")).toBeLessThan(anular.indexOf('anular_movimiento_banca'));
  });

  it('el guardián de movimientos ahora cubre también los desembolsos', () => {
    const g = funcion(m, 'movimientos_nomina_proteger');
    expect(g).toMatch(/from public\.nomina_pagos p/);
    expect(g).toMatch(/from public\.nomina_prestamo_pagos p/);
  });

  it('solo service_role ejecuta, termina recargando PostgREST y el rollback se niega si hay pagos de préstamos', () => {
    expect(m).toContain('grant execute on function public.nomina_prestamo_pagar(uuid, jsonb, uuid) to service_role');
    expect(m).toContain('grant execute on function public.nomina_prestamo_anular(uuid, text, uuid) to service_role');
    expect(termina(m)).toBe(true);
    expect(rollback).toMatch(/select 1 from public\.nomina_prestamo_pagos\)\s+then\s+raise exception/);
    expect(rollback).not.toMatch(/from public\.nomina_prestamo_pagos p join/);
    expect(termina(rollback)).toBe(true);
  });
});
