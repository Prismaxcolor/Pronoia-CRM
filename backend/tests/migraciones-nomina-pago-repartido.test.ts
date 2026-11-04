import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Contrato de la migración del pago repartido de la nómina entre varias cuentas de la misma moneda. No se puede ejecutar en
 * las pruebas (no hay Postgres): se fijan las reglas de seguridad y de negocio acordadas leyendo el SQL.
 */
const sql = (nombre: string): string =>
  readFileSync(fileURLToPath(new URL(`../../docs/${nombre}`, import.meta.url)), 'utf-8').replace(/\r\n/g, '\n');

function funcion(texto: string, nombre: string): string {
  const inicio = texto.indexOf(`create or replace function public.${nombre}(`);
  expect(inicio, `función ${nombre}`).toBeGreaterThan(-1);
  const fin = texto.indexOf('$function$;', texto.indexOf('as $function$', inicio) + 10);
  return texto.slice(inicio, fin);
}

const m = sql('migration_nomina_pago_repartido.sql');
const rollback = sql('migration_nomina_pago_repartido_ROLLBACK.sql');

describe('migration_nomina_pago_repartido.sql: índices', () => {
  it('permite varias cuentas por moneda pero no repetir la misma cuenta (parciales como antes)', () => {
    expect(m).toMatch(/uq_nomina_pagos_nomina_moneda_banca\s+on public\.nomina_pagos \(nomina_id, moneda_pago, banca_id\) where linea_id is null/);
    expect(m).toMatch(/uq_nomina_pagos_linea_moneda_banca\s+on public\.nomina_pagos \(linea_id, moneda_pago, banca_id\) where linea_id is not null/);
  });

  it('quita los índices únicos antiguos de una cuenta por moneda, después de crear los nuevos', () => {
    expect(m).toMatch(/drop index if exists public\.uq_nomina_pagos_nomina_moneda;/);
    expect(m).toMatch(/drop index if exists public\.uq_nomina_pagos_linea_moneda;/);
    expect(m.indexOf('create unique index if not exists uq_nomina_pagos_linea_moneda_banca'))
      .toBeLessThan(m.indexOf('drop index if exists public.uq_nomina_pagos_linea_moneda;'));
  });

  it('es una transacción idempotente, comprueba sus requisitos y recarga PostgREST al final', () => {
    expect(m).toMatch(/^begin;/m);
    expect(m).toMatch(/^commit;/m);
    expect(m).toContain('Falta aplicar migration_nomina_pago_por_trabajador.sql');
    expect(m).toContain("notify pgrst, 'reload schema';");
    expect(m).not.toMatch(/drop table|truncate/i);
  });
});

describe('nomina_reparto_normalizar', () => {
  const f = funcion(m, 'nomina_reparto_normalizar');

  it('valida en centavos enteros que la suma por moneda sea exactamente la parte a pagar', () => {
    expect(f).toContain("round(case v_moneda when 'USD' then p_total_usd else p_total_bs end * 100)::bigint");
    expect(f).toMatch(/v_suma <> v_tot_c/);
    expect(f).toContain('round(v_monto * 100)::bigint');
  });

  it('exige cuentas distintas, monto > 0 con 2 decimales, monto en cada cuenta del reparto y un máximo de cuentas', () => {
    expect(f).toMatch(/v_banca = any\(v_vistas\)/);
    expect(f).toMatch(/v_monto <= 0/);
    expect(f).toMatch(/v_monto <> round\(v_monto, 2\)/);
    expect(f).toContain('Indica el monto de cada cuenta del reparto.');
    expect(f).toMatch(/c_max constant integer := 5/);
  });

  it('exige una cuenta para cada moneda con monto y ninguna de sobra; un pago único sin monto es el pago completo', () => {
    expect(f).toContain('Elige una cuenta para cada moneda a pagar');
    expect(f).toMatch(/elsif v_n = 1 then\s+v_c := v_tot_c/);
  });

  it('no se puede llamar desde el navegador: solo service_role', () => {
    expect(m).toMatch(/revoke execute on function public\.nomina_reparto_normalizar\(jsonb, numeric, numeric\) from public, anon, authenticated;/);
    expect(m).toMatch(/grant execute on function public\.nomina_reparto_normalizar\(jsonb, numeric, numeric\) to service_role;/);
    expect(f).not.toMatch(/security definer/i);
  });
});

describe.each(['nomina_pagar', 'nomina_pagar_trabajador'])('%s con reparto', nombre => {
  const f = funcion(m, nombre);

  it('mantiene el search_path vacío y bloquea la nómina y las cuentas antes de leer saldos', () => {
    expect(f).toContain("set search_path = ''");
    expect(f).toMatch(/from public\.nominas where id = p_nomina_id for update/);
    expect(f).toMatch(/from public\.bancas\s+where id in \(select \(e->>'bancaId'\)::uuid from jsonb_array_elements\(v_norm\) e\) order by id for update/);
  });

  it('normaliza el reparto con los totales que calcula la BD (nunca del navegador)', () => {
    expect(f).toContain('public.nomina_reparto_normalizar(v_pagos, v_tot_usd, v_tot_bs)');
    expect(f).toContain('nomina_lineas');
  });

  it('crea un egreso por cuenta con SU saldo, su comisión Sí/No, su categoría y su fila de nomina_pagos', () => {
    expect(f).toMatch(/Saldo insuficiente en %/);
    expect(f).toContain('crear_movimiento_con_comision_bancaria');
    expect(f).toContain('Indica si el pago en bolívares lleva comisión bancaria.');
    expect(f).toMatch(/update public\.movimientos set categoria_id = v_cat where id = v_mov_id/);
    expect(f).toMatch(/insert into public\.nomina_pagos/);
    expect(f).toMatch(/for v_p in select e from jsonb_array_elements\(v_norm\) e loop/);
  });

  it('cada parte en Bs congela su equivalente a la tasa Binance del día real y el reparto del equivalente suma exacto', () => {
    expect(f).toContain('tasa_binance_del_dia(v_hoy_real)');
    expect(f).toContain('v_eq_bin := round(v_monto / v_tasa, 2)');
    expect(f).toContain('public.nomina_reparto_equivalente(v_eq_bs, v_monto, v_tot_bs, v_asig_usd, v_indice = v_cuentas)');
  });

  it('es idempotente: si ya hay pago devuelve yaPagada sin tocar nada', () => {
    expect(f).toMatch(/return jsonb_build_object\('yaPagada', true\)/);
  });

  it('se concede solo a service_role', () => {
    expect(m).toMatch(new RegExp(`grant execute on function public\\.${nombre}\\(.*\\) to service_role;`));
    expect(m).toMatch(new RegExp(`revoke execute on function public\\.${nombre}\\(.*\\) from public, anon, authenticated;`));
  });
});

describe('nomina_pagar_trabajador: comprobantes y exclusividad', () => {
  const f = funcion(m, 'nomina_pagar_trabajador');
  it('los comprobantes jsonb van con to_jsonb en el egreso de cada cuenta y máximo 10', () => {
    expect(f).toContain('comprobantes = to_jsonb(v_comp)');
    expect(f).toContain('Máximo 10 comprobantes.');
  });
  it('conserva el guard de exclusión entre pago completo y por trabajador', () => {
    expect(f).toContain('Esta nómina ya se pagó completa desde el Wallet: no se puede pagar por trabajador.');
  });
});

describe('anulación y lecturas del reparto', () => {
  const wallet = sql('migration_nomina_pago_wallet.sql');

  it('nomina_anular (fase 2) recorre TODAS las filas de nomina_pagos: devuelve el dinero de cada cuenta del reparto', () => {
    const f = funcion(wallet, 'nomina_anular');
    expect(f).toMatch(/from public\.nomina_pagos p join public\.movimientos m on m\.id = p\.movimiento_id\s+where p\.nomina_id = v_n\.id and not m\.anulado/);
    expect(f).not.toMatch(/limit 1|into strict/i);
  });

  it('el guardián de movimientos busca por movimiento_id: cubre cada egreso del reparto', () => {
    expect(wallet).toContain('p.movimiento_id in (old.id, coalesce(old.comision_de_id, old.id))');
  });

  it('ninguna otra migración de nómina usa on conflict sobre (nómina o renglón, moneda)', () => {
    for (const nombre of ['migration_nomina_dos_sueldos_cargo.sql', 'migration_nomina_prestamo_desembolso.sql', 'migration_nomina_pago_wallet.sql']) {
      expect(sql(nombre)).not.toMatch(/on conflict \((nomina_id|linea_id), moneda_pago\)/);
    }
  });
});

describe('migration_nomina_pago_repartido_ROLLBACK.sql', () => {
  it('se niega si ya existen repartos (varias filas por moneda en una línea o nómina)', () => {
    expect(rollback).toMatch(/group by nomina_id, moneda_pago having count\(\*\) > 1/);
    expect(rollback).toMatch(/group by linea_id, moneda_pago having count\(\*\) > 1/);
    expect(rollback).toContain('raise exception');
    expect(rollback.indexOf('raise exception')).toBeLessThan(rollback.indexOf('create unique index'));
  });

  it('restaura los índices y las dos funciones anteriores y quita los auxiliares', () => {
    expect(rollback).toMatch(/create unique index if not exists uq_nomina_pagos_nomina_moneda\s+on public\.nomina_pagos \(nomina_id, moneda_pago\) where linea_id is null/);
    expect(rollback).toMatch(/create unique index if not exists uq_nomina_pagos_linea_moneda\s+on public\.nomina_pagos \(linea_id, moneda_pago\) where linea_id is not null/);
    expect(rollback).toContain('create or replace function public.nomina_pagar(');
    expect(rollback).toContain('create or replace function public.nomina_pagar_trabajador(');
    expect(rollback).not.toContain('nomina_reparto_normalizar(v_pagos');
    expect(rollback).toMatch(/drop function if exists public\.nomina_reparto_normalizar/);
    expect(rollback).toMatch(/drop function if exists public\.nomina_reparto_equivalente/);
  });
});
