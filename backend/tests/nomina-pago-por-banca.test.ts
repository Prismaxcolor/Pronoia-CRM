import { describe, it, expect, vi } from 'vitest';

// Los esquemas validan comprobantes contra ENV.SUPABASE_URL: se fija para no depender del .env local.
vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pagarNominaSchema, pagarTrabajadorSchema } from '../src/schemas/nomina';
import { planificarPagos, type CuentaWallet } from '../src/utils/nomina-pago';
import { datosSql } from '../src/services/nomina-pago-service';

/**
 * Pago de nómina por banca: cada cuenta lleva SU referencia y SUS comprobantes. El SQL no se puede ejecutar aquí (no hay Postgres):
 * se fija leyendo el archivo.
 */
const URL_A = 'https://p.supabase.test/storage/v1/object/public/comprobantes/a.jpg';
const URL_B = 'https://p.supabase.test/storage/v1/object/public/comprobantes/b.jpg';
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const B3 = '33333333-3333-4333-8333-333333333333';

describe('esquema: referencia y comprobantes por cuenta', () => {
  const fecha = '2026-10-09';

  it('cada cuenta acepta su referencia y sus comprobantes; sin ellos quedan vacíos', () => {
    const r = pagarNominaSchema.safeParse({
      fecha,
      bancas: [
        { moneda: 'USD', bancaId: B1, monto: 20, referencia: ' REF-1 ', comprobantes: [URL_A] },
        { moneda: 'USD', bancaId: B2, monto: 10 },
      ],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.bancas[0]).toMatchObject({ referencia: 'REF-1', comprobantes: [URL_A] });
    expect(r.data.bancas[1].comprobantes).toEqual([]);
    expect(r.data.bancas[1].referencia).toBeUndefined();
  });

  it('rechaza más de 10 comprobantes en una cuenta y referencias demasiado largas', () => {
    const muchos = Array.from({ length: 11 }, () => URL_A);
    expect(pagarNominaSchema.safeParse({ fecha, bancas: [{ moneda: 'USD', bancaId: B1, comprobantes: muchos }] }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({ fecha, bancas: [{ moneda: 'USD', bancaId: B1, referencia: 'x'.repeat(51) }] }).success).toBe(false);
  });

  it('rechaza comprobantes que no son una URL de imagen válida', () => {
    expect(pagarNominaSchema.safeParse({ fecha, bancas: [{ moneda: 'USD', bancaId: B1, comprobantes: ['no-es-url'] }] }).success).toBe(false);
  });

  it('un cliente anterior (referencia general y comprobantes generales) sigue siendo válido', () => {
    expect(pagarNominaSchema.safeParse({ fecha, referencia: 'GEN', bancas: [{ moneda: 'USD', bancaId: B1 }] }).success).toBe(true);
    expect(pagarTrabajadorSchema.safeParse({ fecha, comprobantes: [URL_A], bancas: [{ moneda: 'USD', bancaId: B1 }] }).success).toBe(true);
  });
});

describe('plan y datos que van a la función SQL', () => {
  const cuentas: CuentaWallet[] = [
    { id: B1, nombre: 'CAJA CHICA PS', moneda: 'USD', archivada: false },
    { id: B2, nombre: 'CAJA BINANCE PS', moneda: 'USD', archivada: false },
    { id: B3, nombre: 'CAJA BS PS', moneda: 'VES', archivada: false },
  ];
  const montos = { USD: 3000, BS: 200000 };

  it('el reparto conserva la referencia y los comprobantes de cada cuenta, en su orden', () => {
    const plan = planificarPagos(['USD', 'BS'], [
      { moneda: 'USD', bancaId: B1, monto: 20, referencia: 'A-1', comprobantes: [URL_A] },
      { moneda: 'USD', bancaId: B2, monto: 10, referencia: 'B-2', comprobantes: [URL_B] },
      { moneda: 'BS', bancaId: B3, llevaComision: false },
    ], cuentas, true, montos);
    expect('pagos' in plan).toBe(true);
    if (!('pagos' in plan)) return;
    expect(plan.pagos).toEqual([
      { moneda: 'USD', bancaId: B1, llevaComision: null, monto: 20, referencia: 'A-1', comprobantes: [URL_A] },
      { moneda: 'USD', bancaId: B2, llevaComision: null, monto: 10, referencia: 'B-2', comprobantes: [URL_B] },
      { moneda: 'BS', bancaId: B3, llevaComision: false },
    ]);
  });

  it('datosSql manda por cuenta solo lo que trae y mantiene la referencia general como respaldo', () => {
    const datos = datosSql(
      { fecha: '2026-10-09', referencia: 'GEN', bancas: [] },
      'cat-1',
      [
        { moneda: 'USD', bancaId: B1, llevaComision: null, monto: 20, referencia: 'A-1', comprobantes: [URL_A] },
        { moneda: 'BS', bancaId: B3, llevaComision: false },
      ],
    );
    expect(datos.referencia).toBe('GEN');
    expect(datos.pagos).toEqual([
      { moneda: 'USD', bancaId: B1, llevaComision: null, monto: 20, referencia: 'A-1', comprobantes: [URL_A] },
      { moneda: 'BS', bancaId: B3, llevaComision: false },
    ]);
    expect(datos).not.toHaveProperty('comprobantes');
  });
});

const sql = (nombre: string): string =>
  readFileSync(fileURLToPath(new URL(`../../docs/${nombre}`, import.meta.url)), 'utf-8').replace(/\r\n/g, '\n');

function funcion(texto: string, nombre: string): string {
  const inicio = texto.indexOf(`create or replace function public.${nombre}(`);
  expect(inicio, `función ${nombre}`).toBeGreaterThan(-1);
  return texto.slice(inicio, texto.indexOf('$function$;', texto.indexOf('as $function$', inicio) + 10));
}

describe('migration_nomina_pago_por_banca.sql', () => {
  const m = sql('migration_nomina_pago_por_banca.sql');
  const rb = sql('migration_nomina_pago_por_banca_ROLLBACK.sql');

  it.each(['nomina_pagar', 'nomina_pagar_trabajador'])('%s lee la referencia y los comprobantes de CADA cuenta y los pone en su egreso', nombre => {
    const f = funcion(m, nombre);
    expect(f).toContain("select e into v_extra from jsonb_array_elements(v_pagos) e where (e->>'bancaId')::uuid = v_banca limit 1;");
    expect(f).toContain("v_ref_c := coalesce(nullif(btrim(coalesce(v_extra->>'referencia', '')), ''), v_ref);");
    expect(f).toContain('Máximo 10 comprobantes por cuenta.');
    // la referencia de la cuenta va en el egreso (con y sin comisión) y en nomina_pagos; ya no se usa la general directamente
    expect(f.match(/v_ref_c/g)!.length).toBeGreaterThanOrEqual(5);
    expect(f).toContain('update public.movimientos set comprobantes = to_jsonb(v_comp_c) where id = v_mov_id;');
    expect(f).not.toMatch(/v_fecha, v_ref[,)]/);
    expect(f).toContain("set search_path = ''");
  });

  it('conserva las reglas de siempre (reparto, saldo, comisión, tasa congelada, idempotencia) y la firma', () => {
    for (const nombre of ['nomina_pagar', 'nomina_pagar_trabajador']) {
      const f = funcion(m, nombre);
      expect(f).toContain('public.nomina_reparto_normalizar(v_pagos');
      expect(f).toContain("return jsonb_build_object('yaPagada', true);");
      expect(f).toContain('Saldo insuficiente en %');
      expect(f).toContain('tasa_binance_del_dia(v_hoy_real)');
      expect(f).toContain('Indica si el pago en bolívares lleva comisión bancaria.');
    }
    expect(m).toContain('revoke execute on function public.nomina_pagar(uuid, jsonb, uuid) from public, anon, authenticated;');
    expect(m).toContain('grant execute on function public.nomina_pagar_trabajador(uuid, uuid, jsonb, uuid) to service_role;');
  });

  it('es una transacción que comprueba su requisito, no toca tablas y recarga PostgREST', () => {
    expect(m).toMatch(/^begin;/m);
    expect(m).toMatch(/^commit;/m);
    expect(m).toContain('Falta aplicar migration_nomina_pago_repartido.sql');
    expect(m).not.toMatch(/drop table|truncate|alter table|create unique index/i);
    expect(m).toContain("notify pgrst, 'reload schema';");
  });

  it('el ROLLBACK restaura las dos funciones anteriores (sin los campos por cuenta)', () => {
    expect(funcion(rb, 'nomina_pagar')).not.toContain('v_extra');
    expect(funcion(rb, 'nomina_pagar_trabajador')).not.toContain('v_ref_c');
    expect(funcion(rb, 'nomina_pagar_trabajador')).toContain('update public.movimientos set comprobantes = to_jsonb(v_comp) where id = v_mov_id;');
    expect(rb.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
