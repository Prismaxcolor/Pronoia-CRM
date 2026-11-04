-- Proveedores: dirección opcional (texto libre, máximo 300 caracteres), igual que clientes.direccion.
-- Idempotente. Aditiva: no modifica datos existentes.
-- El backend tolera que la columna aún no exista: el listado devuelve direccion = null y el alta/edición
-- solo la envía cuando la persona escribió o cambió una dirección. Aplicar con backup previo.
-- ROLLBACK: docs/migration_proveedores_direccion_ROLLBACK.sql
begin;

alter table public.proveedores
  add column if not exists direccion text;

alter table public.proveedores drop constraint if exists proveedores_direccion_largo;
alter table public.proveedores
  add constraint proveedores_direccion_largo check (direccion is null or char_length(direccion) <= 300);

commit;

-- Recarga el esquema de PostgREST para que el backend vea la columna sin reiniciar.
notify pgrst, 'reload schema';
