-- Revierte migration_facturas_created_by.sql. Se pierde el dato de quién creó cada factura.
alter table public.facturas_compra drop column if exists created_by;
alter table public.facturas_venta  drop column if exists created_by;
