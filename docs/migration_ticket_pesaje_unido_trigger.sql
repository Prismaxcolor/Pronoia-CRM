-- =============================================================================
-- Defensa en BD: un ticket unido (secundario) no admite detalle propio
-- =============================================================================
-- Requiere docs/migration_ticket_pesaje_unido.sql aplicada antes (columna
-- ticket_principal_id). Aditiva e idempotente.
--
-- ATENCIÓN: toca detalle_tickets_pesaje, una tabla caliente (toda creación,
-- completado y edición de tickets inserta ahí). DEBE probarse en staging antes
-- de producción: crear, completar, unir y editar tickets, y confirmar que no
-- hay regresiones de latencia ni errores.
--
-- ROLLBACK:
--   drop trigger if exists trg_bloquear_detalle_ticket_unido on public.detalle_tickets_pesaje;
--   drop function if exists public.fn_bloquear_detalle_ticket_unido();
-- =============================================================================

create or replace function public.fn_bloquear_detalle_ticket_unido()
 returns trigger
 language plpgsql
as $function$
begin
  if exists (
    select 1 from public.tickets_pesaje
     where id = new.ticket_id and ticket_principal_id is not null
  ) then
    raise exception 'El ticket está unido a otro ticket principal y no admite materiales propios.';
  end if;
  return new;
end;
$function$
;

drop trigger if exists trg_bloquear_detalle_ticket_unido on public.detalle_tickets_pesaje;
create trigger trg_bloquear_detalle_ticket_unido
  before insert on public.detalle_tickets_pesaje
  for each row execute function public.fn_bloquear_detalle_ticket_unido();
