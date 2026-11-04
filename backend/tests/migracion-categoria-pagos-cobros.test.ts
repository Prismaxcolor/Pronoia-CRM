import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const leer = (archivo: string): string => readFileSync(resolve(__dirname, '../../docs', archivo), 'utf-8');

describe('migration_categoria_pagos_cobros.sql', () => {
  const sql = leer('migration_categoria_pagos_cobros.sql');

  it('reemplaza editar_pago_cobro_contable con la misma firma (sin sobrecarga)', () => {
    expect(sql).toMatch(/create or replace function public\.editar_pago_cobro_contable\(p_grupo_id uuid, p_bancas jsonb, p_monto_usd numeric, p_items jsonb, p_descripcion text, p_referencia text, p_fecha date, p_comprobantes jsonb, p_usuario uuid\)/i);
  });
  it('lee la categoría antes de borrar las filas y la reinserta en las dos filas de dinero (pago/cobro y adelanto/anticipo)', () => {
    const iLectura = sql.indexOf('select m.categoria_id into v_categoria');
    const iBorrado = sql.indexOf('delete from public.movimientos');
    expect(iLectura).toBeGreaterThan(-1);
    expect(iBorrado).toBeGreaterThan(iLectura);
    expect(sql.match(/cliente_id, creado_en, categoria_id\)/g)).toHaveLength(2);
    expect(sql.match(/v_creado, v_categoria\)/g)).toHaveLength(2);
  });
  it('solo conserva la categoría vigente (el trigger rechaza insertar con una archivada)', () => {
    expect(sql).toMatch(/c\.activo and \(cp\.id is null or cp\.activo\)/);
  });
  it('es transaccional, exige la migración de categorías y tiene rollback', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toContain('migration_wallet_categorias.sql');
    expect(leer('migration_categoria_pagos_cobros_ROLLBACK.sql')).not.toContain('v_categoria');
  });
});

describe('correccion_categoria_pagos_cobros_historicos.sql', () => {
  const sql = leer('correccion_categoria_pagos_cobros_historicos.sql');
  it('solo actualiza egresos de pago a proveedor sin categoría (idempotente) y no toca cobros', () => {
    expect(sql).toMatch(/subtipo in \('pago', 'adelanto'\)\s+and proveedor_id is not null\s+and categoria_id is null/);
    expect(sql).not.toMatch(/update public\.movimientos\s+set categoria_id = v_cat[^;]*'cobro'/);
  });
});
