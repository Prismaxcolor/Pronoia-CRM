import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrato de las migraciones de cobros/pagos (cruce parcial de notas, descripción del adelanto/anticipo, correlativo de
 * cobro/anticipo) y de la comisión bancaria automática. No hay Postgres en los tests: se revisa el texto del SQL, que se
 * generó a partir de las versiones vigentes de cada función con cambios puntuales.
 */
const leer = (archivo: string): string => readFileSync(resolve(__dirname, '../../docs', archivo), 'utf-8');

/** Cuerpo de una función `create or replace function public.<nombre>(` hasta su cierre `$$;` / `$function$;`. */
function funcion(sql: string, nombre: string): string {
  const inicio = sql.search(new RegExp(`create or replace function public\\.${nombre}\\s*\\(`, 'i'));
  expect(inicio, `falta la función ${nombre}`).toBeGreaterThanOrEqual(0);
  const resto = sql.slice(inicio);
  const delim = /\bAS\s+(\$[a-z]*\$)/i.exec(resto)?.[1] ?? '$$';
  return resto.slice(0, resto.indexOf(`${delim};`, resto.indexOf(delim) + delim.length) + delim.length + 1);
}

describe('migration_cruce_parcial_notas_adelanto_descripcion.sql', () => {
  const sql = leer('migration_cruce_parcial_notas_adelanto_descripcion.sql');

  it('es transaccional, con guardia de requisitos y recarga del esquema', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/to_regprocedure\('public\.aplicar_item_cruce/);
    expect(sql).toMatch(/notify pgrst, 'reload schema'/);
  });

  describe('aplicar_item_cruce: notas en parte', () => {
    const f = funcion(sql, 'aplicar_item_cruce');

    it('ya no exige aplicar la nota completa', () => {
      expect(f).not.toContain('se aplica completa');
      expect(f).not.toMatch(/set pagada = true, movimiento_id = p_movimiento_id/);
    });

    it('valida contra lo que le queda a la nota (monto menos las aplicaciones vigentes)', () => {
      expect(f).toMatch(/from public\.pago_aplicaciones\s+where tipo in \('nota_debito', 'nota_credito'\) and item_id = p_id and not anulada/);
      expect(f).toMatch(/v_nota_resto := round\(v_nota_mto - v_aplicado, 2\)/);
      expect(f).toMatch(/if p_monto > v_nota_resto \+ 0\.01 then\s+raise exception 'La nota % solo tiene % disponible/);
    });

    it('solo marca pagada cuando se consume todo el monto (con tolerancia de un centavo)', () => {
      expect(f).toMatch(/v_nota_agotada := round\(v_aplicado \+ p_monto, 2\) >= round\(v_nota_mto, 2\) - 0\.01/);
      expect(f).toMatch(/set pagada = v_nota_agotada/);
    });

    it('conserva el resto de la función (facturas, adelantos y el registro de la aplicación)', () => {
      expect(f).toMatch(/Adelanto % no encontrado/);
      expect(f).toMatch(/insert into public\.pago_aplicaciones \(grupo_id, tipo, item_id, monto_usd\)/);
      expect(f).toMatch(/supera su saldo pendiente/);
    });

    it('sigue rechazando notas anuladas, ya agotadas, de otro tipo o de otra entidad', () => {
      expect(f).toMatch(/esta anulada y no se puede usar/);
      expect(f).toMatch(/ya fue aplicada/);
      expect(f).toMatch(/no es de tipo/);
      expect(f).toMatch(/proveedor_id = p_entidad_id/);
      expect(f).toMatch(/cliente_id = p_entidad_id/);
    });
  });

  describe('_revertir_aplicaciones_grupo', () => {
    const f = funcion(sql, '_revertir_aplicaciones_grupo');
    it('libera la nota aunque no figure pagada y solo falla si la nota ya no existe', () => {
      expect(f).not.toMatch(/and pagada = true/);
      expect(f).toMatch(/set pagada = false/);
      expect(f).toMatch(/La nota % ya no existe: no se puede revertir/);
    });
    it('conserva el enlace al movimiento si otra operación sigue usando la nota', () => {
      expect(f).toMatch(/o\.grupo_id <> p_grupo and not o\.anulada/);
    });
  });

  describe.each(['anular_nota_ajuste_proveedor', 'anular_nota_ajuste_cliente'])('%s', nombre => {
    it('bloquea anular una nota aplicada en parte', () => {
      const f = funcion(sql, nombre);
      expect(f).toMatch(/if v_pagada or exists \(select 1 from public\.pago_aplicaciones a\s+where a\.item_id = p_nota_id and a\.tipo in \('nota_debito', 'nota_credito'\) and not a\.anulada\) then/);
    });
  });

  describe('adelanto/anticipo conserva la descripción del pago/cobro', () => {
    it('registrar_pago_proveedor_multi_banca', () => {
      const f = funcion(sql, 'registrar_pago_proveedor_multi_banca');
      expect(f).not.toContain("then 'Adelanto' else p_descripcion");
      expect(f).toMatch(/'egreso', 'adelanto', v_num_adel, v_grupo_id, v_monto_adel, v_banca_moneda, v_ap_adel_usd,\s+nullif\(p_descripcion, ''\)/);
    });
    it('registrar_cobro_cliente_multi_banca', () => {
      const f = funcion(sql, 'registrar_cobro_cliente_multi_banca');
      expect(f).not.toContain("then 'Anticipo' else p_descripcion");
      expect(f).toMatch(/'ingreso', 'anticipo', v_num_anticipo, v_grupo_id, v_monto_anticipo, v_banca_moneda, v_ap_anticipo_usd,\s+nullif\(p_descripcion, ''\)/);
    });
    it('editar_pago_cobro_contable', () => {
      const f = funcion(sql, 'editar_pago_cobro_contable');
      expect(f).not.toMatch(/then \(case when v_es then 'Adelanto' else 'Anticipo' end\)/);
      expect(f).toMatch(/\(v_tipo_mov, v_sub_adel, v_num_adel, p_grupo_id, v_m_adel, v_b_mon, v_ap_adel,\s+coalesce\(p_descripcion, ''\)/);
    });
  });

  it('el correlativo de movimientos asigna también cobro (CB-) y anticipo (AC-), respetando un número ya dado', () => {
    const f = funcion(sql, 'asignar_correlativo_movimiento');
    expect(f).toMatch(/if new\.numero is null then/);
    expect(f).toContain("nextval('public.movimientos_cobro_numero_seq')");
    expect(f).toContain("nextval('public.movimientos_anticipo_cliente_numero_seq')");
    expect(f).toContain("nextval('public.movimientos_pago_numero_seq')");
    expect(f).toContain("nextval('public.movimientos_adelanto_numero_seq')");
  });

  it('el backfill de descripciones históricas queda comentado (no se ejecuta solo)', () => {
    const bloque = sql.slice(sql.indexOf('OPCIONAL'));
    for (const linea of bloque.split('\n').filter(l => /update public\.movimientos/.test(l))) {
      expect(linea.startsWith('--')).toBe(true);
    }
  });

  it('el rollback restaura las funciones anteriores', () => {
    const rb = leer('migration_cruce_parcial_notas_adelanto_descripcion_ROLLBACK.sql');
    expect(funcion(rb, 'aplicar_item_cruce')).toContain('se aplica completa');
    expect(funcion(rb, 'registrar_pago_proveedor_multi_banca')).toContain("then 'Adelanto' else p_descripcion");
    expect(funcion(rb, 'registrar_cobro_cliente_multi_banca')).toContain("then 'Anticipo' else p_descripcion");
    expect(funcion(rb, 'asignar_correlativo_movimiento')).not.toContain('movimientos_cobro_numero_seq');
    expect(rb).toMatch(/^begin;/m);
    expect(rb).toMatch(/^commit;/m);
  });
});

describe('migration_comision_automatica_banca.sql', () => {
  const sql = leer('migration_comision_automatica_banca.sql');

  it('documenta el supuesto y cómo cambiarlo sin tocar código', () => {
    expect(sql).toMatch(/SUPUESTO DE NEGOCIO/);
    expect(sql).toMatch(/CONFIRMAR con Julio/);
    expect(sql).toMatch(/update public\.bancas set comision_auto_tasa/);
  });

  it('agrega la regla por cuenta con una restricción que impide valores absurdos', () => {
    expect(sql).toMatch(/add column if not exists comision_auto_tasa\s+numeric/);
    expect(sql).toMatch(/add column if not exists comision_auto_minimo numeric/);
    expect(sql).toMatch(/comision_auto_tasa, 0\) <= 0\.1/);
    expect(sql).toMatch(/coalesce\(comision_auto_minimo, 0\) >= 0/);
  });

  it('siembra Citibank solo donde no hay regla, sin traspasar el mínimo en Bs a otras monedas', () => {
    expect(sql).toMatch(/where nombre ilike '%citibank%'\s+and comision_auto_tasa is null and comision_auto_minimo is null/);
    expect(sql).toMatch(/comision_auto_minimo = case when moneda = 'VES' then 14 else 0 end/);
  });

  describe('crear_movimiento_con_comision_bancaria', () => {
    const f = funcion(sql, 'crear_movimiento_con_comision_bancaria');

    it('usa la regla de la cuenta (cualquier moneda) o la de siempre (solo Bs)', () => {
      expect(f).toMatch(/select comision_auto_tasa, comision_auto_minimo into v_tasa, v_minimo from public\.bancas/);
      expect(f).toMatch(/if v_tasa is null and v_minimo is null then\s+if v_mon_o <> 'VES' then\s+raise exception/);
      expect(f).toMatch(/v_comision := greatest\(round\(p_monto \* v_tasa, 2\), v_minimo, 0\.01\)/);
    });

    it('valida el saldo contra monto + comisión, como antes', () => {
      expect(f).toMatch(/if v_sal_o < p_monto \+ v_comision then\s+raise exception 'Saldo insuficiente/);
    });

    it('un egreso con proveedor nace como adelanto, con grupo, y el cargo cita AD-', () => {
      expect(f).toMatch(/v_subtipo := case when p_tipo = 'egreso' and p_proveedor_id is not null then 'adelanto' else null end/);
      expect(f).toMatch(/gen_random_uuid\(\)/);
      expect(f).toMatch(/comision_bancaria, subtipo, grupo_id, monto_usd\)/);
      expect(f).toMatch(/returning id, numero_sistema, numero into v_mov_id, v_num, v_numdoc/);
      expect(f).toContain("'AD-' || lpad(coalesce(v_numdoc, 0)::text, 4, '0')");
    });

    it('un ingreso nunca lleva comisión ni es adelanto aquí (la función solo acepta egreso y transferencia)', () => {
      expect(f).toMatch(/p_tipo not in \('egreso', 'transferencia'\)/);
      expect(f).not.toMatch(/'anticipo'/);
    });

    it('mantiene security definer y search_path fijo', () => {
      expect(f).toMatch(/security definer/);
      expect(f).toMatch(/set search_path = public, pg_temp/);
    });
  });

  describe('agregar_comision_bancaria_a_pago', () => {
    const f = funcion(sql, 'agregar_comision_bancaria_a_pago');

    it('usa la regla de la cuenta o la de siempre y nunca cobra menos de un centavo', () => {
      expect(f).toMatch(/select comision_auto_tasa, comision_auto_minimo into v_tasa, v_minimo from public\.bancas where id = m\.banca_origen_id/);
      expect(f).toMatch(/v_comision := greatest\(round\(v_base \* v_tasa, 2\), v_minimo, 0\.01\)/);
    });

    it('el rechazo de monedas distintas de Bs solo aplica a cuentas sin regla propia', () => {
      expect(f).toMatch(/if v_tasa is null and v_minimo is null then\s+if m\.moneda <> 'VES' then/);
    });

    it('sigue siendo idempotente frente a doble comisión y no valida saldo', () => {
      expect(f).toMatch(/Este pago ya tiene comisión bancaria/);
      expect(f).not.toMatch(/Saldo insuficiente/);
    });
  });

  it('el rollback restaura las dos funciones con la regla fija y quita las columnas', () => {
    const rb = leer('migration_comision_automatica_banca_ROLLBACK.sql');
    expect(funcion(rb, 'crear_movimiento_con_comision_bancaria')).toMatch(/greatest\(round\(p_monto \* c_tasa, 2\), c_minimo\)/);
    expect(funcion(rb, 'agregar_comision_bancaria_a_pago')).toMatch(/greatest\(round\(v_base \* c_tasa, 2\), c_minimo\)/);
    expect(rb).toMatch(/drop column if exists comision_auto_tasa/);
    expect(rb).toMatch(/drop column if exists comision_auto_minimo/);
  });
});
