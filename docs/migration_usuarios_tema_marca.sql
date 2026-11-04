-- Tema de color por usuario (marca azul para un usuario concreto).
-- Tabla: public.users (usuarios propios con bcrypt; NO auth.users).
-- null = verde corporativo por defecto; 'azul' = escala azul anterior.
--
-- Idempotente: se puede ejecutar varias veces. El backend tolera que la
-- columna aún no exista (degrada a null), así que el orden de despliegue
-- no importa.
--
-- ROLLBACK (si hace falta revertir):
--   begin;
--   alter table public.users drop constraint if exists users_tema_marca_check;
--   alter table public.users drop column if exists tema_marca;
--   commit;

begin;

alter table public.users add column if not exists tema_marca text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_tema_marca_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_tema_marca_check check (tema_marca in ('azul'));
  end if;
end $$;

-- Asignación inicial: solo al usuario Dioni (trabajador). Guarda: no pisa un
-- valor ya definido (p. ej. si un superadmin lo cambió desde la app).
update public.users
   set tema_marca = 'azul'
 where id = '06149da3-6012-4aea-bdab-b74b246d9ff9'
   and tema_marca is null;

commit;

-- Verificación:
--   select id, nombre, tema_marca from public.users where tema_marca is not null;
