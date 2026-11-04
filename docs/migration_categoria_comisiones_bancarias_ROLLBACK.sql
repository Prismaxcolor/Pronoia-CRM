-- =============================================================================
-- ROLLBACK de migration_categoria_comisiones_bancarias.sql.
--
-- Quita el trigger y su función y el uso `comision_bancaria`, y devuelve el check de categorias_uso a los 4 usos
-- originales. NO borra la categoría COMISIONES BANCARIAS (puede tener movimientos; las categorías nunca se borran:
-- si ya no se quiere, archívala desde Wallet > Categorías) ni cambia la categoría de los cargos ya clasificados.
-- =============================================================================

begin;

drop trigger if exists trg_movimientos_categoria_comision on public.movimientos;
drop function if exists public.movimientos_categoria_comision();

delete from public.categorias_uso where uso = 'comision_bancaria';

alter table public.categorias_uso drop constraint if exists categorias_uso_uso_valido;
alter table public.categorias_uso add constraint categorias_uso_uso_check check (
  uso in ('pago_proveedor', 'cobro_cliente', 'nomina_administrativo', 'nomina_operativo')
);

commit;

notify pgrst, 'reload schema';
