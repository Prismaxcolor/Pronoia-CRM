-- Versión vigente tras docs/migration_anular_notas_sin_inversa.sql (anular = marcar, sin nota inversa).
-- Args: p_nota_id uuid, p_motivo text, p_registrado_por uuid

create or replace function public.anular_nota_ajuste_proveedor(
  p_nota_id uuid, p_motivo text, p_registrado_por uuid
) returns uuid
language plpgsql
as $function$
declare
  v_encontrada boolean;
  v_anulada    boolean;
  v_pagada     boolean;
  v_mov_id     uuid;
  v_mov_num    bigint;
  v_mov_sub    text;
  v_ref        text;
begin
  select true, anulada, pagada, movimiento_id
    into v_encontrada, v_anulada, v_pagada, v_mov_id
    from public.notas_ajuste_proveedor
   where id = p_nota_id
   for update;

  if v_encontrada is not true then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    select numero, subtipo into v_mov_num, v_mov_sub
      from public.movimientos where id = v_mov_id;
    v_ref := case
      when v_mov_num is not null then ' (PG-' || lpad(v_mov_num::text, 4, '0') || ')'
      else ''
    end;
    raise exception 'Esta nota ya fue aplicada en un pago%: no se puede anular sin reversar antes ese pago.', v_ref;
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  update public.notas_ajuste_proveedor
     set anulada = true,
         anulada_at = now(),
         anulada_por = p_registrado_por,
         anulada_motivo = btrim(p_motivo)
   where id = p_nota_id;

  return p_nota_id;
end;
$function$;
