-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: p_nota_id uuid, p_motivo text, p_registrado_por uuid

CREATE OR REPLACE FUNCTION public.anular_nota_ajuste_proveedor(p_nota_id uuid, p_motivo text, p_registrado_por uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_proveedor_id uuid;
  v_tipo         text;
  v_monto        numeric;
  v_anulada      boolean;
  v_pagada       boolean;
  v_factura_id   uuid;
  v_nueva_id     uuid;
begin
  select proveedor_id, tipo, monto, anulada, pagada, factura_id
    into v_proveedor_id, v_tipo, v_monto, v_anulada, v_pagada, v_factura_id
    from public.notas_ajuste_proveedor
   where id = p_nota_id;

  if v_proveedor_id is null then
    raise exception 'Nota no encontrada.';
  end if;
  if v_anulada then
    raise exception 'Esta nota ya fue anulada.';
  end if;
  if v_pagada then
    raise exception 'Esta nota ya fue pagada — no se puede anular sin reversar antes el pago.';
  end if;

  insert into public.notas_ajuste_proveedor
    (proveedor_id, tipo, monto, motivo, anula_nota_id, registrado_por, factura_id)
  values (
    v_proveedor_id,
    case when v_tipo = 'credito' then 'debito' else 'credito' end,
    v_monto,
    p_motivo,
    p_nota_id,
    p_registrado_por,
    v_factura_id
  )
  returning id into v_nueva_id;

  update public.notas_ajuste_proveedor set anulada = true where id = p_nota_id;

  return v_nueva_id;
end;
$function$
;
