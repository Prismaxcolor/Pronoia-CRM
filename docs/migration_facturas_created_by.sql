-- Registro de quién creó cada factura ("Registrado por <nombre> · fecha hora").
-- ADITIVA: solo agrega una columna nullable. Las facturas existentes quedan con created_by = null
-- (la leyenda muestra "Registrado por —"). NO aplicada a producción: ejecutar a mano en Supabase.
-- El backend ya tolera que la columna no exista (no falla, solo no guarda ni muestra el nombre).

alter table public.facturas_compra
  add column if not exists created_by uuid references public.users(id) on delete set null;

alter table public.facturas_venta
  add column if not exists created_by uuid references public.users(id) on delete set null;

-- Rollback (ver también migration_facturas_created_by_ROLLBACK.sql):
--   alter table public.facturas_compra drop column if exists created_by;
--   alter table public.facturas_venta  drop column if exists created_by;
