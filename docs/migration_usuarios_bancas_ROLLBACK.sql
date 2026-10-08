-- Rollback de migration_usuarios_bancas.sql (el backend vuelve a no filtrar por banca).
drop function if exists public.reemplazar_bancas_usuario(uuid, uuid[]);
drop table if exists public.usuarios_bancas;
