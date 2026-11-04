-- =============================================================================
-- Wallet: categorías asignadas a cada operación (qué categoría lleva cada tipo de movimiento automático).
--
--   * public.categorias_uso : (uso, categoria_id). Un "uso" es una operación del sistema que clasifica
--     sola sus movimientos. Usos:
--        pago_proveedor        -> 1 categoría fija (se aplica sola al pagar facturas de proveedor)
--        cobro_cliente         -> las categorías entre las que se ELIGE al cobrar a un cliente
--        nomina_administrativo -> categoría del egreso de la nómina del personal administrativo
--        nomina_operativo      -> categoría del egreso de la nómina del personal operativo
--
-- Se guarda el id (no el nombre) para que renombrar una categoría no rompa nada. La siembra busca por
-- nombre una sola vez; lo que no encuentre queda sin asignar (el backend entonces no pone categoría).
-- Sembrado con las categorías de Julio (2026-10-12): COMPRA DE MATERIA PRIMA, VENTA DE CHATARRA NF,
-- VENTA DE CHATARRA PCB, y las dos de nómina bajo GASTOS FINANCIEROS ("ADMISNTRATIVO" está así escrito).
--
-- Seguridad: RLS activado y deny-all para anon/authenticated; solo el backend (service_role) accede.
-- Aditiva e idempotente; no se aplica desde el código. ROLLBACK: docs/migration_categorias_uso_ROLLBACK.sql
-- =============================================================================

begin;

create table if not exists public.categorias_uso (
  uso          text        not null check (uso in ('pago_proveedor', 'cobro_cliente', 'nomina_administrativo', 'nomina_operativo')),
  categoria_id uuid        not null references public.categorias_wallet(id) on delete restrict,
  created_at   timestamptz not null default now(),
  primary key (uso, categoria_id)
);

-- pago_proveedor y las dos de nómina admiten una sola categoría; cobro_cliente admite varias.
create unique index if not exists idx_categorias_uso_unica
  on public.categorias_uso (uso) where uso <> 'cobro_cliente';

alter table public.categorias_uso enable row level security;
revoke all on public.categorias_uso from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'categorias_uso' and policyname = 'categorias_uso_deny_anon'
  ) then
    create policy categorias_uso_deny_anon
      on public.categorias_uso for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

-- Siembra por nombre (subcategorías activas). Si ya hay filas para un uso no se toca.
insert into public.categorias_uso (uso, categoria_id)
select s.uso, c.id
from (values
  ('pago_proveedor',        'COMPRA DE MATERIA PRIMA'),
  ('cobro_cliente',         'VENTA DE CHATARRA NF'),
  ('cobro_cliente',         'VENTA DE CHATARRA PCB'),
  ('nomina_administrativo', 'NOMINA PERSONAL ADMISNTRATIVO'),
  ('nomina_operativo',      'NOMINA PERSONAL OPERATIVO')
) as s(uso, nombre)
join public.categorias_wallet c
  on upper(btrim(c.nombre)) = s.nombre and c.padre_id is not null and c.activo
where not exists (
  select 1 from public.categorias_uso u where u.uso = s.uso and (s.uso <> 'cobro_cliente' or u.categoria_id = c.id)
)
on conflict do nothing;

commit;

-- Verificación (a mano):
--   select u.uso, c.nombre from public.categorias_uso u join public.categorias_wallet c on c.id = u.categoria_id order by 1, 2;
--   -- esperado: 5 filas

notify pgrst, 'reload schema';
