-- Clientes: subdivisión "Venta nacional" | "Venta internacional".
-- Idempotente. Los clientes existentes quedan como 'nacional' (default de la columna).
-- El formulario de alta no tiene predeterminado: obliga a elegir (regla solo del formulario). El backend
-- acepta altas sin tipoVenta (cola offline vieja) y asume 'nacional'.
alter table public.clientes
  add column if not exists tipo_venta text not null default 'nacional';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clientes_tipo_venta_check'
      and conrelid = 'public.clientes'::regclass
  ) then
    alter table public.clientes
      add constraint clientes_tipo_venta_check check (tipo_venta in ('nacional', 'internacional'));
  end if;
end $$;

create index if not exists clientes_tipo_venta_idx on public.clientes (tipo_venta);
