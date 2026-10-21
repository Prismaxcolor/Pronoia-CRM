import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const leer = (archivo: string): string => readFileSync(resolve(__dirname, '../../docs', archivo), 'utf-8');

describe('migration_categoria_comisiones_bancarias.sql', () => {
  const sql = leer('migration_categoria_comisiones_bancarias.sql');

  it('es transaccional, idempotente y exige las migraciones de categorías', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toContain('migration_wallet_categorias.sql');
    expect(sql).toContain('migration_categorias_uso.sql');
    expect(sql).toMatch(/drop trigger if exists trg_movimientos_categoria_comision/);
    expect(sql).toMatch(/where not exists \(select 1 from public\.categorias_uso where uso = 'comision_bancaria'\)/);
  });

  it('inserta COMISIONES BANCARIAS solo si no existe una activa de egresos y avisa si existe archivada', () => {
    expect(sql).toContain("c_nombre constant text := 'COMISIONES BANCARIAS'");
    expect(sql).toMatch(/if v_cat is null then[\s\S]*insert into public\.categorias_wallet \(nombre, tipo, padre_id\)/);
    expect(sql).toMatch(/raise exception 'Ya existe una categoría/);
  });

  it('amplía el check de usos con comision_bancaria', () => {
    expect(sql).toMatch(/uso in \('pago_proveedor', 'cobro_cliente', 'nomina_administrativo', 'nomina_operativo', 'comision_bancaria'\)/);
  });

  it('el trigger actúa sobre todo movimiento con comision_de_id y solo con una categoría vigente de egresos', () => {
    expect(sql).toMatch(/before insert or update of categoria_id, comision_de_id on public\.movimientos/);
    expect(sql).toMatch(/when \(new\.comision_de_id is not null\)/);
    expect(sql).toMatch(/c\.activo and \(p\.id is null or p\.activo\) and c\.tipo in \('EGRESO', 'AMBOS'\)/);
    expect(sql).toMatch(/search_path = ''/);
  });

  it('corre antes de la validación de categoría (orden alfabético de los triggers)', () => {
    expect('trg_movimientos_categoria_comision' < 'trg_movimientos_validar_categoria').toBe(true);
  });

  it('tiene rollback que quita el trigger y restaura el check original', () => {
    const rollback = leer('migration_categoria_comisiones_bancarias_ROLLBACK.sql');
    expect(rollback).toMatch(/drop trigger if exists trg_movimientos_categoria_comision/);
    expect(rollback).toMatch(/uso in \('pago_proveedor', 'cobro_cliente', 'nomina_administrativo', 'nomina_operativo'\)/);
    expect(rollback).not.toMatch(/delete from public\.categorias_wallet/);
  });
});

describe('correccion_categoria_comisiones_historicas.sql', () => {
  const sql = leer('correccion_categoria_comisiones_historicas.sql');

  it('solo clasifica cargos de comisión sin categoría por defecto (idempotente)', () => {
    expect(sql).toMatch(/where comision_de_id is not null\s+and categoria_id is null;/);
    expect(sql).toMatch(/v_incluir_otras constant boolean := false/);
  });

  it('el verificador es de solo lectura (todo comentado)', () => {
    const verificar = leer('verificar_categoria_comisiones.sql');
    const sinComentarios = verificar.split('\n').filter(l => l.trim() !== '' && !l.trimStart().startsWith('--'));
    expect(sinComentarios).toEqual([]);
  });
});

describe('migration_pago_comision_bancaria.sql', () => {
  const sql = leer('migration_pago_comision_bancaria.sql');

  it('usa la misma fórmula que Wallet (0.3%, mínimo 14 Bs) y solo para pagos o adelantos de proveedor en Bs', () => {
    expect(sql).toMatch(/c_tasa\s+constant numeric := 0\.003/);
    expect(sql).toMatch(/c_minimo\s+constant numeric := 14/);
    expect(sql).toMatch(/greatest\(round\(v_base \* c_tasa, 2\), c_minimo\)/);
    expect(sql).toMatch(/m\.subtipo not in \('pago', 'adelanto'\)/);
    expect(sql).toMatch(/m\.moneda <> 'VES'/);
  });

  it('liga el cargo con comision_de_id y marca la comisión en el principal', () => {
    expect(sql).toMatch(/comision_de_id\)\s+values/);
    expect(sql).toMatch(/update public\.movimientos set comision_bancaria = v_comision where id = m\.id/);
  });

  it('exige la migración de Wallet y la de editar/anular antes de aplicarse', () => {
    expect(sql).toContain('migration_wallet_comision_bancaria.sql');
    expect(sql).toContain('migration_editar_anular_transacciones.sql');
  });

  it('reemplaza anular_pago_cobro con la misma firma y anula el cargo antes de anular el pago', () => {
    expect(sql).toMatch(/create or replace function public\.anular_pago_cobro\(p_grupo_id uuid, p_motivo text, p_usuario uuid\)/);
    const iCargo = sql.indexOf("perform public.anular_movimiento_banca(v_cargo");
    const iAnulacion = sql.indexOf('update public.movimientos\n     set anulado = true');
    expect(iCargo).toBeGreaterThan(-1);
    expect(iAnulacion).toBeGreaterThan(iCargo);
    expect(sql).toContain("set_config('app.comision_bancaria_rpc', 'on', true)");
  });

  it('solo el service_role ejecuta las funciones', () => {
    expect(sql).toMatch(/revoke execute on function public\.agregar_comision_bancaria_a_pago\(uuid, uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.agregar_comision_bancaria_a_pago\(uuid, uuid\) to service_role/);
  });

  it('el rollback restaura anular_pago_cobro sin el paso de comisión', () => {
    const rollback = leer('migration_pago_comision_bancaria_ROLLBACK.sql');
    expect(rollback).toMatch(/drop function if exists public\.agregar_comision_bancaria_a_pago\(uuid, uuid\)/);
    expect(rollback).not.toContain('v_cargo');
  });
});
