import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const leer = (archivo: string): string => readFileSync(resolve(__dirname, '../../docs', archivo), 'utf-8');

describe('migration_pagos_pasos_pendientes.sql', () => {
  const sql = leer('migration_pagos_pasos_pendientes.sql');

  it('es transaccional e idempotente y crea la tabla con los campos de reparación', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toContain('create table if not exists public.pagos_pasos_pendientes');
    for (const campo of ['grupo_id', 'movimiento_id', 'paso', 'detalle', 'creado_en', 'resuelto_at', 'intentos']) {
      expect(sql).toContain(campo);
    }
    expect(sql).toMatch(/paso in \('categoria', 'comprobante', 'comision'\)/);
    expect(sql).toMatch(/create index if not exists idx_pagos_pasos_pendientes_sin_resolver[\s\S]*where resuelto_at is null/);
  });

  it('queda cerrada: RLS sin políticas y sin acceso para anon/authenticated', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toMatch(/revoke all on public\.pagos_pasos_pendientes from anon, authenticated/);
  });

  it('el ROLLBACK la elimina dentro de una transacción', () => {
    const rb = leer('migration_pagos_pasos_pendientes_ROLLBACK.sql');
    expect(rb).toMatch(/^begin;/m);
    expect(rb).toContain('drop table if exists public.pagos_pasos_pendientes');
    expect(rb).toMatch(/^commit;/m);
  });
});

describe('migration_idempotencia_pagos_cobros.sql', () => {
  const sql = leer('migration_idempotencia_pagos_cobros.sql');
  const envoltorios = [
    'registrar_pago_proveedor_completo',
    'registrar_pago_proveedor_multi_banca_completo',
    'registrar_cobro_cliente_multi_banca_completo',
  ];

  it('es transaccional y exige la tabla de pendientes y la de operaciones antes de crear nada', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toContain('migration_pagos_pasos_pendientes.sql');
    expect(sql).toContain("to_regclass('public.operaciones_cliente')");
    expect(sql.indexOf('raise exception')).toBeLessThan(sql.indexOf('create or replace function'));
  });

  it('crea los tres envoltorios sobre las RPC originales y la función de pasos', () => {
    expect(sql).toContain('create or replace function public.aplicar_pasos_pago(');
    for (const nombre of envoltorios) expect(sql).toContain(`create or replace function public.${nombre}(`);
    expect(sql).toContain('public.registrar_pago_proveedor(');
    expect(sql).toContain('public.registrar_pago_proveedor_multi_banca(');
    expect(sql).toContain('public.registrar_cobro_cliente_multi_banca(');
  });

  it('cada paso va aislado y anota el fallo en la tabla de pendientes sin revertir el dinero', () => {
    for (const paso of ['categoria', 'comprobante', 'comision']) {
      expect(sql).toMatch(new RegExp(`insert into public\\.pagos_pasos_pendientes[\\s\\S]{0,160}'${paso}'`));
    }
    expect((sql.match(/exception when others then/g) ?? []).length).toBe(3);
    expect(sql).toContain('public.agregar_comision_bancaria_a_pago(v_mov, p_usuario)');
  });

  it('con clientRequestId usa candado, devuelve el resultado guardado y lo registra en operaciones_cliente', () => {
    expect((sql.match(/pg_advisory_xact_lock/g) ?? []).length).toBe(3);
    expect((sql.match(/update public\.operaciones_cliente set entidad_id/g) ?? []).length).toBe(3);
    expect((sql.match(/if v_previo is not null then/g) ?? []).length).toBe(3);
  });

  it('solo service_role puede ejecutar las funciones', () => {
    for (const nombre of ['aplicar_pasos_pago', ...envoltorios]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${nombre}\\([^)]*\\)\\s+from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${nombre}\\([^)]*\\) to service_role`));
    }
  });

  it('el ROLLBACK quita solo los envoltorios y el auxiliar', () => {
    const rb = leer('migration_idempotencia_pagos_cobros_ROLLBACK.sql');
    for (const nombre of ['aplicar_pasos_pago', ...envoltorios]) expect(rb).toContain(`drop function if exists public.${nombre}(`);
    expect(rb).not.toMatch(/drop function if exists public\.registrar_pago_proveedor\(/);
    expect(rb).not.toContain('drop table');
  });
});
