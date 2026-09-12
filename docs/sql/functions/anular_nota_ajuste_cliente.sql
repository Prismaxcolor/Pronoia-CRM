-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_nota_id uuid, p_motivo text, p_registrado_por uuid

CREATE OR REPLACE FUNCTION public.anular_nota_ajuste_cliente(p_nota_id uuid, p_motivo text, p_registrado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_cliente_id   uuid;
  v_tipo         text;
  v_monto        numeric;
  v_anulada      boolean;
  v_pagada       boolean;
  v_factura_id   uuid;
  v_nueva_id     uuid;
begin
  select cliente_id, tipo, monto, anulada, pagada, factura_id
    into v_cliente_id, v_tipo, v_monto, v_anulada, v_pagada, v_factura_id
    from public.notas_ajuste_cliente
   where id = p_nota_id;

  if v_cliente_id is null then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    raise exception 'Esta nota ya fue aplicada a un cobro — no se puede anular sin reversar antes el cobro.';
  end if;

  insert into public.notas_ajuste_cliente
    (cliente_id, tipo, monto, motivo, anula_nota_id, registrado_por, factura_id)
  values (
    v_cliente_id,
    case when v_tipo = 'credito' then 'debito' else 'credito' end,
    v_monto,
    p_motivo,
    p_nota_id,
    p_registrado_por,
    v_factura_id
  )
  returning id into v_nueva_id;

  update public.notas_ajuste_cliente set anulada = true where id = p_nota_id;

  return v_nueva_id;
end;
$function$
;
