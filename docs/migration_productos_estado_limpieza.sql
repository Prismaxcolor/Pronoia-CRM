-- =============================================================================
-- Estado de limpieza del material (limpio / sucio) en productos
--
-- Por qué: la pantalla nueva de /inventario separa Ferroso y No ferroso en limpio y sucio, pero los
-- nombres de los productos casi nunca lo dicen (hoy la mayor parte de los kg queda "sin clasificar").
-- Se guarda como dato del producto para que Julio lo clasifique y deje de depender del nombre.
--
-- Qué hace (idempotente: se puede ejecutar más de una vez sin efectos secundarios):
--   1. productos.estado_limpieza  text null check (in ('limpio','sucio'))   (null = sin definir)
--   2. Rellena SOLO donde el nombre lo indica sin ambigüedad, solo en las categorías Ferroso y
--      No ferroso y solo si estado_limpieza es null:
--        - el nombre contiene la palabra SUCIO (y no LIMPIO)  -> 'sucio'
--        - el nombre contiene la palabra LIMPIO (y no SUCIO)  -> 'limpio'
--      El resto queda null: no se adivina. Re-ejecutar no pisa lo que se haya elegido a mano.
--   3. Siembra configuracion_inventario.alerta_merma_min_kg = 5 (kg mínimos de merma para alertar)
--      si la tabla existe y la clave no.
--
-- Seguridad: no cambia permisos ni RLS (productos ya los tiene). Sin datos destructivos.
-- Cómo ensayar: pegar completo en el SQL Editor de una copia/branch (trae begin/commit; ante un
-- error no queda nada aplicado). El backend tolera que la migración aún no esté aplicada (ignora el
-- campo en vez de dar 500) y la pantalla de inventario cae al nombre cuando estado_limpieza es null.
--
-- ROLLBACK (ejecutar manualmente si hace falta; pierde lo clasificado a mano):
--   begin;
--     alter table public.productos drop constraint if exists productos_estado_limpieza_check;
--     alter table public.productos drop column if exists estado_limpieza;
--     delete from public.configuracion_inventario where clave = 'alerta_merma_min_kg';
--   commit;
-- =============================================================================

begin;

-- 1. Columna ---------------------------------------------------------------
alter table public.productos add column if not exists estado_limpieza text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'productos_estado_limpieza_check'
       and conrelid = 'public.productos'::regclass
  ) then
    alter table public.productos
      add constraint productos_estado_limpieza_check
      check (estado_limpieza is null or estado_limpieza in ('limpio', 'sucio'));
  end if;
end $$;

comment on column public.productos.estado_limpieza is
  'Estado del material para separar limpio/sucio en el inventario (Ferroso y No ferroso). null = sin definir.';

-- 2. Relleno SOLO donde el nombre es inequívoco ----------------------------
update public.productos p
   set estado_limpieza = case
         when p.nombre ~* '\msucio\M' then 'sucio'
         else 'limpio'
       end
  from public.tipos_material tm
 where tm.id = p.tipo_material_id
   and lower(btrim(tm.nombre)) in ('ferroso', 'no ferroso')
   and p.estado_limpieza is null
   and (
     (p.nombre ~* '\msucio\M' and p.nombre !~* '\mlimpio\M')
     or (p.nombre ~* '\mlimpio\M' and p.nombre !~* '\msucio\M')
   );

-- 3. Mínimo de kg de merma para alertar (solo si la tabla de configuración existe) ---
do $$
begin
  if to_regclass('public.configuracion_inventario') is not null then
    insert into public.configuracion_inventario (clave, valor, tipo, minimo, maximo, descripcion)
    values ('alerta_merma_min_kg', 5, 'decimal', 0, 100000,
            'Merma mínima en kg para que una transformación genere alerta de merma (evita ruido en pesos muy pequeños).')
    on conflict (clave) do nothing;
  end if;
end $$;

commit;
