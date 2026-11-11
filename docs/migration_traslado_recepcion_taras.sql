-- =============================================================================
-- Traslados: la recepción captura peso BRUTO y TARAS (como el pesaje) a 3 decimales.
--
-- Antes: por línea solo se guardaba peso_recibido (neto, tolerancia 0,01 kg, mensaje a 2 decimales).
-- Ahora: la recepción guarda además el bruto y la tara con que se pesó al llegar:
--   peso_recibido = round(peso_bruto_recibido - tara_recibida, 3)   (sigue siendo el NETO: stock, KPIs y
--   reportes lo leen de ahí, no cambian).
--
-- Cambios (aditivos, idempotentes, una transacción):
--   1. detalle_traslado.peso_bruto_recibido y tara_recibida (numeric, nullable). Nulos en las recepciones
--      anteriores y en las líneas pendientes: no hay backfill (no se conocen).
--   2. completar_traslado: base = versión vigente de migration_lote_stock_por_almacen.sql (sección 4).
--      - Cada recepción puede traer peso_bruto_recibido y tara_recibida; si trae bruto, el neto se
--        RECALCULA como bruto - tara (la tara se asume 0 si falta) y se rechazan negativos.
--      - Sin bruto (clientes y colas offline anteriores) se usa peso_recibido tal cual, como antes.
--      - Todo se redondea a 3 decimales; tolerancia recibido <= enviado + 0,001 kg si llega bruto, y se
--        conserva 0,01 kg (como antes) si no llega bruto.
--      - Mismo nombre y firma: CREATE OR REPLACE, sin overloads.
--
-- editar_traslado_pesos (edición con llave) NO se toca: sigue con su tolerancia de 0,01 kg y no actualiza
-- bruto/tara recibidos; la pantalla de detalle solo muestra "bruto - tara" si cuadra con el neto guardado.
--
-- Backend: backend/src/schemas/traslados.ts, backend/src/services/traslado-service.ts.
-- ROLLBACK: docs/migration_traslado_recepcion_taras_ROLLBACK.sql
-- =============================================================================

begin;

alter table public.detalle_traslado
  add column if not exists peso_bruto_recibido numeric,
  add column if not exists tara_recibida       numeric;

comment on column public.detalle_traslado.peso_bruto_recibido is
  'Peso bruto con que se pesó la línea al recibirla en el destino. peso_recibido = bruto - tara. Nulo en recepciones previas a las taras.';
comment on column public.detalle_traslado.tara_recibida is
  'Tara total (principal + adicionales) restada al bruto recibido. Nulo en recepciones previas a las taras.';

create or replace function public.completar_traslado(
  p_traslado_id      uuid,
  p_recepciones      jsonb,
  p_fotos            text[],
  p_completado_por   uuid
) returns uuid
language plpgsql
as $function$
declare
  v_estado text;
  v_item   jsonb;
  v_fila   record;
  v_almacen_origen_id uuid;
  v_almacen_destino_id uuid;
  v_peso_neto numeric;
  v_peso_recibido numeric;
  v_bruto numeric;
  v_tara numeric;
  v_tolerancia numeric;
  v_nombre text;
begin
  select estado, almacen_origen_id, almacen_destino_id
    into v_estado, v_almacen_origen_id, v_almacen_destino_id
    from public.tickets_traslado where id = p_traslado_id
    for update;

  if v_estado is null then
    raise exception 'Traslado no encontrado.';
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'El traslado ya está completo.';
  end if;

  for v_fila in select producto_id from public.detalle_traslado where traslado_id = p_traslado_id and producto_id is not null
  loop
    if public.hay_toma_fisica_abierta(v_almacen_origen_id, v_fila.producto_id)
       or public.hay_toma_fisica_abierta(v_almacen_destino_id, v_fila.producto_id) then
      raise exception 'Uno de los materiales tiene una toma física de inventario abierta en el origen o el destino. No se pueden recibir traslados hasta cerrarla.';
    end if;
  end loop;

  if p_fotos is null or array_length(p_fotos, 1) is null or array_length(p_fotos, 1) < 1 then
    raise exception 'La recepción requiere al menos una foto de evidencia.';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_recepciones, '[]'::jsonb)) as elems(value)
  loop
    select dt.peso_neto, coalesce(p.nombre, l.nombre) into v_peso_neto, v_nombre
      from public.detalle_traslado dt
      left join public.productos p on p.id = dt.producto_id
      left join public.lotes l on l.id = dt.lote_id
     where dt.id = (v_item->>'detalle_id')::uuid and dt.traslado_id = p_traslado_id;

    if v_peso_neto is null then
      raise exception 'Detalle de traslado % no encontrado.', (v_item->>'detalle_id')::uuid;
    end if;

    v_bruto := nullif(v_item->>'peso_bruto_recibido', '')::numeric;
    v_tara  := nullif(v_item->>'tara_recibida', '')::numeric;

    if v_bruto is not null then
      v_tara := coalesce(v_tara, 0);
      if v_bruto < 0 then
        raise exception 'El peso bruto recibido no puede ser negativo.';
      end if;
      if v_tara < 0 then
        raise exception 'La tara recibida no puede ser negativa.';
      end if;
      v_bruto := round(v_bruto, 3);
      v_tara  := round(v_tara, 3);
      v_peso_recibido := round(v_bruto - v_tara, 3);
    else
      v_tara := null;
      v_peso_recibido := round((v_item->>'peso_recibido')::numeric, 3);
    end if;

    if v_peso_recibido < 0 then
      raise exception 'El peso recibido no puede ser negativo.';
    end if;
    -- Con bruto (cliente nuevo, 3 decimales) tolerancia 0,001 kg; sin bruto (cliente o cola offline anterior,
    -- 2 decimales) se conserva la de antes, 0,01 kg, para que lo ya encolado no quede rechazado al sincronizar.
    v_tolerancia := 0.01;
    if v_bruto is not null then
      v_tolerancia := 0.001;
    end if;
    if v_peso_recibido > round(v_peso_neto, 3) + v_tolerancia then
      raise exception 'No se puede recibir más de lo que salió: % kg despachados de %.', round(v_peso_neto, 3), coalesce(v_nombre, 'este material');
    end if;

    update public.detalle_traslado
       set peso_recibido       = v_peso_recibido,
           peso_bruto_recibido = v_bruto,
           tara_recibida       = v_tara
     where id = (v_item->>'detalle_id')::uuid
       and traslado_id = p_traslado_id;
  end loop;

  update public.tickets_traslado
     set estado         = 'completo',
         fotos           = p_fotos,
         completado_por  = p_completado_por,
         completado_en   = now()
   where id = p_traslado_id;

  return p_traslado_id;
end;
$function$;

commit;
