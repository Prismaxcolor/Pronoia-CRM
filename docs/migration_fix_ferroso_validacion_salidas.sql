-- =============================================================================
-- MIGRACIÓN: completar_transformacion_ferroso() ahora valida que la suma de
-- las salidas no supere el peso neto de entrada, y bloquea la transformación
-- antes de leerla (consistencia con crear_transformacion/crear_transformacion_pcb).
--
-- PROBLEMA: a diferencia de completar_transformacion() y
-- completar_transformacion_pcb() (que sí validan `v_suma_salidas >
-- v_peso_neto_entrada`), completar_transformacion_ferroso() insertaba
-- cualquier combinación de salidas sin comparar contra lo que realmente
-- entró — se podía "sacar" más kg de los que se pesaron a la entrada,
-- inflando el stock del almacén con material que nunca existió.
--
-- FIX: se agrega la misma validación de suma de salidas que ya usan las
-- otras dos rutas de transformación, y se bloquea la fila de
-- `transformaciones` (`for update`) antes de leerla, igual que
-- crear_transformacion/crear_transformacion_pcb bloquean el lote origen —
-- evita que dos completaciones concurrentes de la misma transformación
-- pasen ambas la validación de estado 'bruto'.
--
-- Verificado en vivo (creado y limpiado en la misma sesión, sin dejar
-- rastro en producción): 100 kg de entrada, intento de completar con
-- 60+60=120 kg de salida → rechazado con el mensaje de error correcto;
-- completar con 40+60=100 kg → aceptado, stock_almacen() del almacén
-- reflejó exactamente 0 kg del producto de entrada, 40 kg y 60 kg de los
-- dos productos de salida — conservación de masa exacta.
--
-- CÓMO APLICAR: pegar en Supabase Studio → SQL Editor y ejecutar.
-- =============================================================================

create or replace function public.completar_transformacion_ferroso(p_transformacion_id uuid, p_salidas jsonb, p_completado_por uuid)
 returns void
 language plpgsql
as $function$
declare
  s                    jsonb;
  v_peso_neto_entrada  numeric;
  v_suma_salidas       numeric := 0;
  v_peso_bruto         numeric;
  v_tara               numeric;
  v_fotos              text[];
begin
  select t.peso_neto into v_peso_neto_entrada
  from public.transformaciones t
  where t.id = p_transformacion_id and t.estado = 'bruto' and t.categoria = 'ferroso_no_ferroso'
  for update;

  if v_peso_neto_entrada is null then
    raise exception 'Transformación no encontrada o ya está completa.';
  end if;

  if jsonb_array_length(p_salidas) = 0 then
    raise exception 'Agrega al menos una salida.';
  end if;

  for s in select * from jsonb_array_elements(p_salidas) loop
    if not (s ? 'fotos') or jsonb_array_length(s->'fotos') = 0 then
      raise exception 'Cada salida necesita al menos una foto.';
    end if;
    v_peso_bruto := (s->>'peso_bruto')::numeric;
    v_tara := coalesce((s->>'tara')::numeric, 0);
    if v_peso_bruto - v_tara <= 0 then
      raise exception 'El peso neto de cada salida debe ser mayor a 0.';
    end if;
    v_suma_salidas := v_suma_salidas + (v_peso_bruto - v_tara);
  end loop;

  if v_suma_salidas > v_peso_neto_entrada + 0.01 then
    raise exception 'La suma de las salidas (%) supera el peso neto de entrada (%).',
      round(v_suma_salidas, 2), round(v_peso_neto_entrada, 2);
  end if;

  for s in select * from jsonb_array_elements(p_salidas) loop
    v_fotos := coalesce(array(select jsonb_array_elements_text(s->'fotos')), '{}');
    insert into public.transformacion_salida_detalle (
      transformacion_id, producto_id, lote_destino_id, peso_bruto, tara, fotos
    ) values (
      p_transformacion_id,
      (s->>'producto_id')::uuid,
      null,
      (s->>'peso_bruto')::numeric,
      coalesce((s->>'tara')::numeric, 0),
      v_fotos
    );
  end loop;

  update public.transformaciones
  set estado = 'completa', completado_por = p_completado_por, completado_en = now()
  where id = p_transformacion_id;
end;
$function$;
