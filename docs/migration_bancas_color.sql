-- Wallet: color opcional por banca (public.bancas.color).
-- Aditiva e idempotente. Sin default: las bancas existentes quedan sin color (NULL)
-- y el frontend les asigna un gris neutro según su posición.
-- Valores permitidos: clave de la paleta fija de 12 colores, o hex #RRGGBB en mayúsculas.
-- El backend tolera que esta migración aún no esté aplicada (degrada a "sin color").

alter table public.bancas
  add column if not exists color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bancas_color_formato_check' and conrelid = 'public.bancas'::regclass
  ) then
    alter table public.bancas
      add constraint bancas_color_formato_check
      check (
        color is null
        or color ~ '^#[0-9A-F]{6}$'
        or color in ('rojo','naranja','ambar','lima','verde','turquesa',
                     'celeste','azul','indigo','violeta','rosa','gris')
      );
  end if;
end $$;

-- ROLLBACK (manual):
--   alter table public.bancas drop constraint if exists bancas_color_formato_check;
--   alter table public.bancas drop column if exists color;
