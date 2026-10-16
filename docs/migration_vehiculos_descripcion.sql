-- Vehículos: descripción/tipo opcional en el catálogo (Configuración > Vehículos).
-- Idempotente. El "vehículo de tercero" NO usa esta tabla: se guarda como texto
-- libre en tickets_pesaje.vehiculo (columna ya existente).
alter table public.vehiculos
  add column if not exists descripcion text;
