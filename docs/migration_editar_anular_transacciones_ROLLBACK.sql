-- =====================================================================
-- ROLLBACK de docs/migration_editar_anular_transacciones.sql
--
-- Restaura aplicar_item_cruce, adelantos_disponibles y reconciliar_saldo_banca a su
-- version anterior, elimina las RPC nuevas, la vista pagos_grupo y las columnas de
-- anulacion.
--
-- PRECAUCION: si ya se anulo algo (movimientos.anulado, cruces.anulado), quitar las
-- columnas perderia esa informacion y, peor, las filas anuladas volverian a contar en
-- los saldos de las bancas y de las entidades. Por eso el script se detiene si
-- encuentra anulaciones: primero hay que decidir que hacer con ellas (por ejemplo
-- re-registrar manualmente el efecto contrario) o dejar las columnas y revertir solo
-- el backend.
-- =====================================================================
begin;

do $$
begin
  if exists (select 1 from public.movimientos where anulado)
     or exists (select 1 from public.cruces where anulado)
     or exists (select 1 from public.pago_aplicaciones where anulada) then
    raise exception 'Hay pagos/cobros/movimientos anulados: el rollback los dejaria contando otra vez. Resuelvelos antes (ver cabecera).';
  end if;
end $$;

drop function if exists public.editar_movimiento_banca_contable(uuid, uuid, uuid, numeric, text, numeric, uuid, uuid, text, text, date, jsonb, uuid);
drop function if exists public.editar_movimiento_banca_campos(uuid, text, text, date, jsonb, uuid);
drop function if exists public.anular_movimiento_banca(uuid, text, uuid);
drop function if exists public._movimiento_manual_bloqueado(uuid);
drop function if exists public.editar_pago_cobro_contable(uuid, jsonb, numeric, jsonb, text, text, date, jsonb, uuid);
drop function if exists public.editar_pago_cobro_campos(uuid, text, text, date, jsonb, uuid);
drop function if exists public.anular_pago_cobro(uuid, text, uuid);
drop function if exists public._revertir_saldos_grupo(uuid);
drop function if exists public._revertir_aplicaciones_grupo(boolean, uuid);
drop function if exists public._grupo_pago_contexto(uuid);
drop function if exists public._verificar_saldos(jsonb);
drop function if exists public._snapshot_saldos(uuid[]);
drop function if exists public._aplicar_efecto_saldo(text, uuid, uuid, numeric, numeric, int);

drop view if exists public.pagos_grupo;

-- Funciones previas (sin filtro de anulados) -------------------------------
create or replace function public.reconciliar_saldo_banca(p_banca_id uuid)
returns numeric
language plpgsql
as $function$
declare
  v_saldo numeric := 0;
begin
  select coalesce(sum(case
           when tipo = 'ingreso'       and banca_origen_id  = p_banca_id then  monto
           when tipo = 'egreso'        and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_destino_id = p_banca_id then  coalesce(monto_destino, monto)
           else 0
         end), 0)
    into v_saldo
    from public.movimientos;

  update public.bancas set saldo = v_saldo where id = p_banca_id;
  return v_saldo;
end;
$function$;

create or replace function public.adelantos_disponibles(p_es_proveedor boolean, p_entidad_id uuid)
 RETURNS TABLE(adelanto_id uuid, numero bigint, fecha date, descripcion text, total numeric, aplicado numeric, disponible numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ad as (
    select coalesce(m.grupo_id, m.id)                    as k,
           min(m.numero)                                 as numero,
           min(m.fecha)                                  as fecha,
           min(m.descripcion)                            as descripcion,
           round(sum(coalesce(m.monto_usd, m.monto)), 2) as total
      from public.movimientos m
     where m.subtipo = case when p_es_proveedor then 'adelanto' else 'anticipo' end
       and ((p_es_proveedor and m.proveedor_id = p_entidad_id)
         or (not p_es_proveedor and m.cliente_id = p_entidad_id))
     group by coalesce(m.grupo_id, m.id)
  )
  select ad.k, ad.numero, ad.fecha, ad.descripcion, ad.total,
         coalesce(ap.s, 0), round(ad.total - coalesce(ap.s, 0), 2)
    from ad
    left join lateral (
      select round(sum(a.monto_usd), 2) as s
        from public.pago_aplicaciones a
       where a.tipo = 'adelanto' and a.item_id = ad.k
    ) ap on true
   order by ad.fecha, ad.numero;
$function$;

create or replace function public.aplicar_item_cruce(p_es_proveedor boolean, p_entidad_id uuid, p_grupo_id uuid, p_tipo text, p_id uuid, p_monto numeric, p_movimiento_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_total     numeric;
  v_pagado    numeric;
  v_estado    text;
  v_saldo     numeric;
  v_nuevo     numeric;
  v_aplicado  numeric;
  v_nota_tipo text;
  v_nota_mto  numeric;
  v_anulada   boolean;
  v_pagada    boolean;
  v_nota_ok   boolean;
  v_etiqueta  text := case when p_es_proveedor then 'proveedor' else 'cliente' end;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto de cada item debe ser mayor a 0.';
  end if;

  if p_tipo = 'factura' then
    if p_es_proveedor then
      select total, monto_pagado, estado into v_total, v_pagado, v_estado
        from public.facturas_compra where id = p_id and proveedor_id = p_entidad_id for update;
    else
      select total, monto_pagado, estado into v_total, v_pagado, v_estado
        from public.facturas_venta where id = p_id and cliente_id = p_entidad_id for update;
    end if;

    if v_total is null then
      raise exception 'Factura % no encontrada para este %.', p_id, v_etiqueta;
    end if;
    if v_estado in ('anulada', 'borrador') then
      raise exception 'La factura % esta % y no se puede pagar ni cruzar.', p_id, v_estado;
    end if;

    v_saldo := round(v_total - coalesce(v_pagado, 0), 2);
    if p_monto > v_saldo + 0.01 then
      raise exception 'El monto aplicado a la factura % (%) supera su saldo pendiente (%).', p_id, p_monto, v_saldo;
    end if;

    v_nuevo := round(coalesce(v_pagado, 0) + p_monto, 2);
    if p_es_proveedor then
      update public.facturas_compra
         set monto_pagado = v_nuevo,
             estado = case when v_nuevo >= v_total - 0.01 then 'pagada' else estado end
       where id = p_id;
    else
      update public.facturas_venta
         set monto_pagado = v_nuevo,
             estado = case when v_nuevo >= v_total - 0.01 then 'pagada' else estado end
       where id = p_id;
    end if;

  elsif p_tipo in ('nota_debito', 'nota_credito') then
    -- Las notas se consumen completas (pagada = true), nunca en parte.
    if p_es_proveedor then
      select tipo, monto, anulada, pagada into v_nota_tipo, v_nota_mto, v_anulada, v_pagada
        from public.notas_ajuste_proveedor where id = p_id and proveedor_id = p_entidad_id for update;
    else
      select tipo, monto, anulada, pagada into v_nota_tipo, v_nota_mto, v_anulada, v_pagada
        from public.notas_ajuste_cliente where id = p_id and cliente_id = p_entidad_id for update;
    end if;

    if v_nota_tipo is null then
      raise exception 'Nota % no encontrada para este %.', p_id, v_etiqueta;
    end if;
    v_nota_ok := (p_tipo = 'nota_debito' and v_nota_tipo = 'debito')
              or (p_tipo = 'nota_credito' and v_nota_tipo = 'credito');
    if not v_nota_ok then
      raise exception 'La nota % no es de tipo %.', p_id, p_tipo;
    end if;
    if v_anulada then
      raise exception 'La nota % esta anulada y no se puede usar.', p_id;
    end if;
    if v_pagada then
      raise exception 'La nota % ya fue aplicada.', p_id;
    end if;
    if abs(round(p_monto, 2) - round(v_nota_mto, 2)) > 0.01 then
      raise exception 'La nota % se aplica completa (%), no por (%).', p_id, v_nota_mto, p_monto;
    end if;

    if p_es_proveedor then
      update public.notas_ajuste_proveedor set pagada = true, movimiento_id = p_movimiento_id where id = p_id;
    else
      update public.notas_ajuste_cliente set pagada = true, movimiento_id = p_movimiento_id where id = p_id;
    end if;

  elsif p_tipo = 'adelanto' then
    -- p_id = grupo_id del adelanto (o id del movimiento si es legacy sin grupo).
    select round(sum(coalesce(monto_usd, monto)), 2) into v_total
      from public.movimientos
     where (grupo_id = p_id or (grupo_id is null and id = p_id))
       and subtipo = case when p_es_proveedor then 'adelanto' else 'anticipo' end
       and ((p_es_proveedor and proveedor_id = p_entidad_id)
         or (not p_es_proveedor and cliente_id = p_entidad_id));

    if v_total is null then
      raise exception 'Adelanto % no encontrado para este %.', p_id, v_etiqueta;
    end if;

    select coalesce(sum(monto_usd), 0) into v_aplicado
      from public.pago_aplicaciones where tipo = 'adelanto' and item_id = p_id;

    if p_monto > round(v_total - v_aplicado, 2) + 0.01 then
      raise exception 'El adelanto % solo tiene % disponible (se intento aplicar %).',
        p_id, round(v_total - v_aplicado, 2), p_monto;
    end if;

  else
    raise exception 'Tipo de item desconocido: %', p_tipo;
  end if;

  insert into public.pago_aplicaciones (grupo_id, tipo, item_id, monto_usd)
  values (p_grupo_id, p_tipo, p_id, round(p_monto, 2));
end;
$function$;

alter table public.movimientos drop constraint if exists movimientos_anulado_coherente;
alter table public.cruces drop constraint if exists cruces_anulado_coherente;
drop index if exists public.idx_movimientos_grupo_id;
drop index if exists public.idx_pago_aplicaciones_grupo_id;
alter table public.movimientos
  drop column if exists anulado, drop column if exists anulado_at,
  drop column if exists anulado_por, drop column if exists anulado_motivo;
alter table public.cruces
  drop column if exists anulado, drop column if exists anulado_at,
  drop column if exists anulado_por, drop column if exists anulado_motivo;
alter table public.pago_aplicaciones
  drop column if exists anulada, drop column if exists anulada_at;

commit;
