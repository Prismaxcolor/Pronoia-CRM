import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: { from: () => ({}), rpc: async () => ({ data: null, error: null }) } }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => '' }));
import { unirComprobantes } from '../src/services/pago-detalle-service.js';

const leer = (archivo: string): string => readFileSync(resolve(__dirname, '../../docs', archivo), 'utf-8');

describe('migration_pagos_comprobante_por_banca.sql', () => {
  const sql = leer('migration_pagos_comprobante_por_banca.sql');

  it('es transaccional, exige la migración de idempotencia y elimina la firma de 7 parámetros antes de crear la de 8', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toContain('migration_idempotencia_pagos_cobros.sql');
    expect(sql.indexOf('raise exception')).toBeLessThan(sql.indexOf('create or replace function'));
    expect(sql.indexOf('drop function if exists public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid)'))
      .toBeLessThan(sql.indexOf('create or replace function public.aplicar_pasos_pago('));
  });

  it('reparte por movimiento de cada banca, anota fallos como paso comprobante y devuelve comprobantesPorBanca', () => {
    expect(sql).toContain('p_bancas               jsonb default null');
    expect(sql).toContain("banca_origen_id = (v_el->>'bancaId')::uuid");
    expect(sql).toMatch(/insert into public\.pagos_pasos_pendientes[\s\S]{0,200}'comprobante'/);
    expect(sql).toContain("'comprobantesPorBanca', v_n_bancas");
  });

  it('los dos envoltorios multi-banca pasan p_bancas a los pasos; el cobro no pide comisión', () => {
    expect(sql).toContain('p_bancas_con_comision, p_registrado_por, p_bancas)');
    expect(sql).toContain("'{}'::uuid[], p_registrado_por, p_bancas)");
    expect(sql).toContain('create or replace function public.registrar_pago_proveedor_multi_banca_completo(');
    expect(sql).toContain('create or replace function public.registrar_cobro_cliente_multi_banca_completo(');
  });

  it('solo service_role puede ejecutar las funciones nuevas', () => {
    expect(sql).toMatch(/revoke all on function public\.aplicar_pasos_pago\(uuid\[\], uuid, uuid, uuid, jsonb, uuid\[\], uuid, jsonb\)\s+from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.aplicar_pasos_pago\(uuid\[\], uuid, uuid, uuid, jsonb, uuid\[\], uuid, jsonb\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\._unir_comprobantes\(jsonb, jsonb\)/);
  });

  it('el ROLLBACK restaura la firma de 7 parámetros y los envoltorios anteriores', () => {
    const rb = leer('migration_pagos_comprobante_por_banca_ROLLBACK.sql');
    expect(rb).toMatch(/^begin;/m);
    expect(rb).toMatch(/^commit;/m);
    expect(rb).toContain('drop function if exists public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid, jsonb)');
    expect(rb).toContain('drop function if exists public._unir_comprobantes(jsonb, jsonb)');
    expect(rb).toContain('create or replace function public.aplicar_pasos_pago(');
    expect(rb).not.toContain('p_bancas               jsonb default null');
    expect(rb).not.toContain('p_registrado_por, p_bancas)');
    expect(rb).not.toContain('drop table');
  });
});

describe('migration_pago_factura_en_cero.sql', () => {
  const sql = leer('migration_pago_factura_en_cero.sql');

  it('es transaccional y exige la versión vigente de las funciones antes de reemplazarlas', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql.indexOf('raise exception')).toBeLessThan(sql.indexOf('create or replace function'));
    for (const nombre of ['aplicar_item_cruce', '_revertir_aplicaciones_grupo', 'registrar_pago_proveedor_multi_banca', 'registrar_cobro_cliente_multi_banca']) {
      expect(sql.toLowerCase()).toContain(`create or replace function public.${nombre}(`);
    }
  });

  it('el monto 0 solo se admite para facturas de total 0 y no crea movimientos', () => {
    expect(sql).toContain("p_monto < 0 or (p_monto = 0 and p_tipo <> 'factura')");
    expect(sql).toContain('round(v_total, 2) > 0.01');
    expect((sql.match(/\(v_item->>'montoUsd'\)::numeric = 0 and v_tipo <> 'factura'/g) ?? []).length).toBe(2);
    // No quedan validaciones antiguas de monto <= 0 en los ítems.
    expect(sql).not.toContain("(v_item->>'montoUsd')::numeric <= 0");
    expect(sql).not.toContain('p_monto is null or p_monto <= 0');
  });

  it('al reversar el cierre de una factura de total 0 vuelve a emitida (en proveedor y cliente)', () => {
    expect((sql.match(/\(v_nuevo < total - 0\.01 or total <= 0\.01\)/g) ?? []).length).toBe(2);
  });

  it('el ROLLBACK restaura la validación de monto mayor a 0', () => {
    const rb = leer('migration_pago_factura_en_cero_ROLLBACK.sql');
    expect(rb).toMatch(/^begin;/m);
    expect(rb).toMatch(/^commit;/m);
    expect(rb).toContain('p_monto is null or p_monto <= 0');
    expect(rb).toContain("(v_item->>'montoUsd')::numeric <= 0");
    expect(rb).not.toContain("p_tipo <> 'factura'");
  });
});

describe('unirComprobantes (detalle del pago)', () => {
  it('junta los comprobantes de todos los movimientos sin repetir, en orden', () => {
    expect(unirComprobantes([{ comprobantes: ['a', 'b'] }, { comprobantes: null }, { comprobantes: ['b', 'c'] }])).toEqual(['a', 'b', 'c']);
  });

  it('sin comprobantes devuelve una lista vacía', () => {
    expect(unirComprobantes([{ comprobantes: null }, { comprobantes: [] }])).toEqual([]);
  });
});
