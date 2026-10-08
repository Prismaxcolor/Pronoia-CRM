-- Revierte migration_clientes_tipo_venta.sql (se pierde la clasificación nacional/internacional).
drop index if exists public.clientes_tipo_venta_idx;
alter table public.clientes drop constraint if exists clientes_tipo_venta_check;
alter table public.clientes drop column if exists tipo_venta;
