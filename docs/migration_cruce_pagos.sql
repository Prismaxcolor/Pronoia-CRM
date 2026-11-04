-- =====================================================================
-- Cruce (compensacion) de facturas con adelantos / anticipos y notas
-- de credito o debito, en el pago a proveedores y el cobro a clientes.
--
-- Modelo (verificado con datos reales):
--   saldo(entidad) = facturas(no anuladas) + ND - pagos - adelantos - NC
--   El adelanto ya resta del saldo global cuando se registra, pero nunca
--   se asignaba a una factura. El cruce NO cambia el saldo global: solo
--   asigna el adelanto / NC / ND a facturas (monto_pagado) y deja el
--   rastro en pago_aplicaciones. Por eso un cruce con efectivo = 0 no
--   crea movimiento de banca.
--
-- Cambios:
--   1. pago_aplicaciones.tipo admite 'adelanto' (item_id = grupo_id del
--      adelanto, o el id del movimiento si es una fila legacy sin grupo).
--   2. Tabla cruces: documento del cruce puro (sin movimiento de dinero),
--      con correlativo propio CR- (proveedor) / CRV- (cliente).
--   3. adelantos_disponibles(): total - aplicado por adelanto/anticipo.
--   4. aplicar_item_cruce(): validacion + aplicacion atomica de un item.
--   5. registrar_pago_proveedor_multi_banca y
--      registrar_cobro_cliente_multi_banca: misma firma (retrocompatible),
--      aceptan items tipo 'adelanto' y total en efectivo = 0 (bancas []).
--
-- Idempotente (CREATE OR REPLACE / IF NOT EXISTS) y en una transaccion.
-- ROLLBACK: docs/migration_cruce_pagos_ROLLBACK.sql
-- Hacer backup antes de aplicar. No inserta datos de negocio.
-- =====================================================================
begin;

-- 1. pago_aplicaciones: tipo 'adelanto' -------------------------------
alter table public.pago_aplicaciones drop constraint if exists pago_aplicaciones_tipo_check;
alter table public.pago_aplicaciones
  add constraint pago_aplicaciones_tipo_check
  check (tipo = any (array['factura'::text, 'nota_debito'::text, 'nota_credito'::text, 'adelanto'::text]));

create index if not exists idx_pago_aplicaciones_tipo_item
  on public.pago_aplicaciones (tipo, item_id);

-- 2. cruces: documento del cruce sin movimiento de dinero ---------------
create sequence if not exists public.cruces_proveedor_numero_seq;
create sequence if not exists public.cruces_cliente_numero_seq;

create table if not exists public.cruces (
  grupo_id       uuid primary key,
  proveedor_id   uuid references public.proveedores(id),
  cliente_id     uuid references public.clientes(id),
  numero         bigint not null,
  fecha          date not null default current_date,
  descripcion    text,
  registrado_por uuid references public.users(id),
  created_at     timestamptz not null default now(),
  constraint cruces_una_entidad_check check ((proveedor_id is null) <> (cliente_id is null))
);
create unique index if not exists cruces_proveedor_numero_uq on public.cruces (numero) where proveedor_id is not null;
create unique index if not exists cruces_cliente_numero_uq   on public.cruces (numero) where cliente_id is not null;
create index if not exists idx_cruces_proveedor on public.cruces (proveedor_id) where proveedor_id is not null;
create index if not exists idx_cruces_cliente   on public.cruces (cliente_id)   where cliente_id is not null;

-- Solo el backend (service_role, que ignora RLS) accede: RLS sin politicas.
alter table public.cruces enable row level security;
revoke all on public.cruces from anon, authenticated;

-- 3. Adelantos / anticipos con saldo sin aplicar ------------------------
create or replace function public.adelantos_disponibles(p_es_proveedor boolean, p_entidad_id uuid)
returns table (adelanto_id uuid, numero bigint, fecha date, descripcion text,
               total numeric, aplicado numeric, disponible numeric)
language sql
stable
set search_path = public
as $$
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
$$;

-- 4. Aplicacion atomica de un item del pago/cobro/cruce -----------------
-- Llamada solo desde las dos RPC de abajo (misma transaccion). Valida
-- contra lo realmente disponible y deja registro en pago_aplicaciones.
create or replace function public.aplicar_item_cruce(
  p_es_proveedor boolean, p_entidad_id uuid, p_grupo_id uuid,
  p_tipo text, p_id uuid, p_monto numeric, p_movimiento_id uuid)
returns void
language plpgsql
set search_path = public
as $$
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
$$;

-- 5a. Pago a proveedor (firma identica a la existente) -------------------
create or replace function public.registrar_pago_proveedor_multi_banca(
  p_proveedor_id uuid, p_bancas jsonb, p_monto_usd numeric, p_descripcion text,
  p_referencia text, p_fecha date, p_registrado_por uuid, p_items jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_item               jsonb;
  v_banca              jsonb;
  v_tipo               text;
  v_cargos             numeric := 0;
  v_creditos           numeric := 0;
  v_total_items        numeric;
  v_total_bancas       numeric;
  v_adelanto           numeric;
  v_saldo              numeric;
  v_nombre             text;
  v_archivada          boolean;
  v_num_pago           bigint;
  v_num_adel           bigint;
  v_num_cruce          bigint;
  v_grupo_id           uuid;
  v_restante_pago      numeric;
  v_banca_id           uuid;
  v_banca_monto        numeric;
  v_banca_monto_usd    numeric;
  v_banca_moneda       text;
  v_banca_referencia   text;
  v_ap_pago_usd        numeric;
  v_ap_adel_usd        numeric;
  v_monto_pago         numeric;
  v_monto_adel         numeric;
  v_mov_id             uuid;
  v_mov_pago_principal uuid;
  v_mov_adel_principal uuid;
  v_ids                uuid[] := '{}';
begin
  if p_items is null then p_items := '[]'::jsonb; end if;
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' then
    raise exception 'Debe indicar al menos una banca de origen.';
  end if;
  if p_monto_usd is null or p_monto_usd < 0 then
    raise exception 'El total a pagar no puede ser negativo.';
  end if;
  -- Sin bancas solo vale un cruce puro (efectivo = 0) con items.
  if jsonb_array_length(p_bancas) = 0 and (p_monto_usd > 0.01 or jsonb_array_length(p_items) = 0) then
    raise exception 'Debe indicar al menos una banca de origen.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un pago.';
  end if;

  -- Serializa pagos/cruces del mismo proveedor: evita que dos operaciones
  -- concurrentes consuman el mismo adelanto o la misma factura.
  perform 1 from public.proveedores where id = p_proveedor_id for update;
  if not found then
    raise exception 'Proveedor no encontrado.';
  end if;

  -- Facturas y notas de debito suman; notas de credito y adelantos restan.
  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    v_tipo := v_item->>'tipo';
    if (v_item->>'montoUsd')::numeric is null or (v_item->>'montoUsd')::numeric <= 0 then
      raise exception 'El monto de cada item debe ser mayor a 0.';
    end if;
    if v_tipo in ('factura', 'nota_debito') then
      v_cargos := v_cargos + round((v_item->>'montoUsd')::numeric, 2);
    elsif v_tipo in ('nota_credito', 'adelanto') then
      v_creditos := v_creditos + round((v_item->>'montoUsd')::numeric, 2);
    else
      raise exception 'Tipo de item desconocido: %', v_tipo;
    end if;
  end loop;

  if v_creditos > v_cargos + 0.01 then
    raise exception 'Los creditos aplicados (notas de credito + adelantos: %) superan lo que se esta pagando (%).', v_creditos, v_cargos;
  end if;

  v_total_items := round(v_cargos - v_creditos, 2);
  if abs(v_total_items) <= 0.01 then v_total_items := 0; end if;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a pagar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_adelanto := round(p_monto_usd - v_total_items, 2);
  if v_adelanto < -0.01 then
    raise exception 'El total a pagar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_adelanto) <= 0.01 then v_adelanto := 0; end if;

  -- Bloquea las bancas en orden estable (por id) antes de tocar ninguna.
  for v_banca in
    select value from jsonb_array_elements(p_bancas) as elems(value)
    order by (value->>'bancaId')
  loop
    select saldo, nombre, archivada into v_saldo, v_nombre, v_archivada
      from public.bancas where id = (v_banca->>'bancaId')::uuid
      for update;

    if v_saldo is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % esta archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_pago := nextval('public.movimientos_pago_numero_seq');
  end if;
  if v_adelanto > 0 then
    v_num_adel := nextval('public.movimientos_adelanto_numero_seq');
  end if;

  v_restante_pago := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    v_banca_referencia := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    if v_banca_monto_usd <= 0 then
      continue;
    end if;

    v_ap_pago_usd := least(v_banca_monto_usd, v_restante_pago);
    v_ap_adel_usd := v_banca_monto_usd - v_ap_pago_usd;
    v_restante_pago := v_restante_pago - v_ap_pago_usd;
    v_monto_pago := 0;

    if v_ap_pago_usd > 0.01 then
      v_monto_pago := round(v_banca_monto * v_ap_pago_usd / v_banca_monto_usd, 2);

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'pago', v_num_pago, v_grupo_id, v_monto_pago, v_banca_moneda, v_ap_pago_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_pago_principal is null then v_mov_pago_principal := v_mov_id; end if;
    end if;

    if v_ap_adel_usd > 0.01 then
      v_monto_adel := v_banca_monto - v_monto_pago;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, proveedor_id)
      values
        ('egreso', 'adelanto', v_num_adel, v_grupo_id, v_monto_adel, v_banca_moneda, v_ap_adel_usd,
         nullif(case when v_total_items > 0 then 'Adelanto' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_proveedor_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_adel_principal is null then v_mov_adel_principal := v_mov_id; end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(true, p_proveedor_id, v_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, v_mov_pago_principal);
  end loop;

  -- Sin movimiento de dinero el cruce queda como documento propio. El
  -- correlativo CR- se asigna al final: si algun item falla no queda hueco.
  -- OJO: los correlativos PG-/AD- (y CB-/AC- en el cobro) de esta version se
  -- tomaban antes de aplicar los items y si un item fallaba dejaban huecos;
  -- se corrigio en docs/migration_cruce_pagos_fixes.sql.
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    if jsonb_array_length(p_items) = 0 then
      raise exception 'No hay nada que registrar: indique items a cruzar o un monto a pagar.';
    end if;
    v_num_cruce := nextval('public.cruces_proveedor_numero_seq');
    insert into public.cruces (grupo_id, proveedor_id, numero, fecha, descripcion, registrado_por)
    values (v_grupo_id, p_proveedor_id, v_num_cruce, p_fecha, nullif(p_descripcion, ''), p_registrado_por);
  end if;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_pago_principal, v_mov_adel_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroPago', v_num_pago,
    'numeroAdelanto', v_num_adel,
    'numeroCruce', v_num_cruce
  );
end;
$$;

-- 5b. Cobro a cliente (firma identica a la existente) --------------------
create or replace function public.registrar_cobro_cliente_multi_banca(
  p_cliente_id uuid, p_bancas jsonb, p_monto_usd numeric, p_descripcion text,
  p_referencia text, p_fecha date, p_registrado_por uuid, p_items jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_item                   jsonb;
  v_banca                  jsonb;
  v_tipo                   text;
  v_cargos                 numeric := 0;
  v_creditos               numeric := 0;
  v_total_items            numeric;
  v_total_bancas           numeric;
  v_anticipo               numeric;
  v_nombre                 text;
  v_archivada              boolean;
  v_num_cobro              bigint;
  v_num_anticipo           bigint;
  v_num_cruce              bigint;
  v_grupo_id               uuid;
  v_restante_cobro         numeric;
  v_banca_id               uuid;
  v_banca_monto            numeric;
  v_banca_monto_usd        numeric;
  v_banca_moneda           text;
  v_banca_referencia       text;
  v_ap_cobro_usd           numeric;
  v_ap_anticipo_usd        numeric;
  v_monto_cobro            numeric;
  v_monto_anticipo         numeric;
  v_mov_id                 uuid;
  v_mov_cobro_principal    uuid;
  v_mov_anticipo_principal uuid;
  v_ids                    uuid[] := '{}';
begin
  if p_items is null then p_items := '[]'::jsonb; end if;
  if p_bancas is null or jsonb_typeof(p_bancas) <> 'array' then
    raise exception 'Debe indicar al menos una banca de destino.';
  end if;
  if p_monto_usd is null or p_monto_usd < 0 then
    raise exception 'El total a cobrar no puede ser negativo.';
  end if;
  if jsonb_array_length(p_bancas) = 0 and (p_monto_usd > 0.01 or jsonb_array_length(p_items) = 0) then
    raise exception 'Debe indicar al menos una banca de destino.';
  end if;

  if (select count(*) from jsonb_array_elements(p_bancas)) <>
     (select count(distinct (value->>'bancaId')) from jsonb_array_elements(p_bancas)) then
    raise exception 'No se puede repetir la misma banca en un cobro.';
  end if;

  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    v_tipo := v_item->>'tipo';
    if (v_item->>'montoUsd')::numeric is null or (v_item->>'montoUsd')::numeric <= 0 then
      raise exception 'El monto de cada item debe ser mayor a 0.';
    end if;
    if v_tipo in ('factura', 'nota_debito') then
      v_cargos := v_cargos + round((v_item->>'montoUsd')::numeric, 2);
    elsif v_tipo in ('nota_credito', 'adelanto') then
      v_creditos := v_creditos + round((v_item->>'montoUsd')::numeric, 2);
    else
      raise exception 'Tipo de item desconocido: %', v_tipo;
    end if;
  end loop;

  if v_creditos > v_cargos + 0.01 then
    raise exception 'Los creditos aplicados (notas de credito + anticipos: %) superan lo que se esta cobrando (%).', v_creditos, v_cargos;
  end if;

  v_total_items := round(v_cargos - v_creditos, 2);
  if abs(v_total_items) <= 0.01 then v_total_items := 0; end if;

  select coalesce(sum((value->>'montoUsd')::numeric), 0) into v_total_bancas
    from jsonb_array_elements(p_bancas) as elems(value);

  if abs(v_total_bancas - p_monto_usd) > 0.01 then
    raise exception 'La suma de las bancas (%) no coincide con el total a cobrar (%).', v_total_bancas, p_monto_usd;
  end if;

  v_anticipo := round(p_monto_usd - v_total_items, 2);
  if v_anticipo < -0.01 then
    raise exception 'El total a cobrar (%) es menor a la suma de lo seleccionado (%).', p_monto_usd, v_total_items;
  end if;
  if abs(v_anticipo) <= 0.01 then v_anticipo := 0; end if;

  for v_banca in
    select value from jsonb_array_elements(p_bancas) as elems(value)
    order by (value->>'bancaId')
  loop
    select nombre, archivada into v_nombre, v_archivada
      from public.bancas where id = (v_banca->>'bancaId')::uuid
      for update;

    if v_nombre is null then
      raise exception 'Banca % no encontrada.', v_banca->>'bancaId';
    end if;
    if v_archivada then
      raise exception 'La banca % esta archivada.', v_nombre;
    end if;
  end loop;

  v_grupo_id := gen_random_uuid();
  if v_total_items > 0 then
    v_num_cobro := nextval('public.movimientos_cobro_numero_seq');
  end if;
  if v_anticipo > 0 then
    v_num_anticipo := nextval('public.movimientos_anticipo_cliente_numero_seq');
  end if;

  v_restante_cobro := v_total_items;

  for v_banca in select value from jsonb_array_elements(p_bancas) as elems(value)
  loop
    v_banca_id := (v_banca->>'bancaId')::uuid;
    v_banca_monto := (v_banca->>'monto')::numeric;
    v_banca_monto_usd := (v_banca->>'montoUsd')::numeric;
    v_banca_moneda := v_banca->>'moneda';
    v_banca_referencia := coalesce(nullif(v_banca->>'referencia', ''), nullif(p_referencia, ''));

    if v_banca_monto_usd <= 0 then
      continue;
    end if;

    v_ap_cobro_usd := least(v_banca_monto_usd, v_restante_cobro);
    v_ap_anticipo_usd := v_banca_monto_usd - v_ap_cobro_usd;
    v_restante_cobro := v_restante_cobro - v_ap_cobro_usd;
    v_monto_cobro := 0;

    if v_ap_cobro_usd > 0.01 then
      v_monto_cobro := round(v_banca_monto * v_ap_cobro_usd / v_banca_monto_usd, 2);

      -- tipo='ingreso': banca_origen_id es la que RECIBE la plata.
      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'cobro', v_num_cobro, v_grupo_id, v_monto_cobro, v_banca_moneda, v_ap_cobro_usd,
         nullif(p_descripcion, ''), v_banca_id, null, p_fecha, v_banca_referencia,
         p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_cobro_principal is null then v_mov_cobro_principal := v_mov_id; end if;
    end if;

    if v_ap_anticipo_usd > 0.01 then
      v_monto_anticipo := v_banca_monto - v_monto_cobro;

      insert into public.movimientos
        (tipo, subtipo, numero, grupo_id, monto, moneda, monto_usd, descripcion,
         banca_origen_id, banca_destino_id, fecha, referencia, registrado_por, cliente_id)
      values
        ('ingreso', 'anticipo', v_num_anticipo, v_grupo_id, v_monto_anticipo, v_banca_moneda, v_ap_anticipo_usd,
         nullif(case when v_total_items > 0 then 'Anticipo' else p_descripcion end, ''),
         v_banca_id, null, p_fecha, v_banca_referencia, p_registrado_por, p_cliente_id)
      returning id into v_mov_id;

      v_ids := v_ids || v_mov_id;
      if v_mov_anticipo_principal is null then v_mov_anticipo_principal := v_mov_id; end if;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) as elems(value)
  loop
    perform public.aplicar_item_cruce(false, p_cliente_id, v_grupo_id,
      v_item->>'tipo', (v_item->>'id')::uuid, (v_item->>'montoUsd')::numeric, v_mov_cobro_principal);
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    if jsonb_array_length(p_items) = 0 then
      raise exception 'No hay nada que registrar: indique items a cruzar o un monto a cobrar.';
    end if;
    v_num_cruce := nextval('public.cruces_cliente_numero_seq');
    insert into public.cruces (grupo_id, cliente_id, numero, fecha, descripcion, registrado_por)
    values (v_grupo_id, p_cliente_id, v_num_cruce, p_fecha, nullif(p_descripcion, ''), p_registrado_por);
  end if;

  return jsonb_build_object(
    'movimientoPrincipalId', coalesce(v_mov_cobro_principal, v_mov_anticipo_principal),
    'movimientoIds', to_jsonb(v_ids),
    'grupoId', v_grupo_id,
    'numeroCobro', v_num_cobro,
    'numeroAnticipo', v_num_anticipo,
    'numeroCruce', v_num_cruce
  );
end;
$$;

-- 6. Permisos: solo el backend (service_role) ejecuta estas funciones ----
revoke execute on function public.adelantos_disponibles(boolean, uuid) from public, anon, authenticated;
revoke execute on function public.aplicar_item_cruce(boolean, uuid, uuid, text, uuid, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.registrar_pago_proveedor_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.registrar_cobro_cliente_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.adelantos_disponibles(boolean, uuid) to service_role;
grant execute on function public.aplicar_item_cruce(boolean, uuid, uuid, text, uuid, numeric, uuid) to service_role;
grant execute on function public.registrar_pago_proveedor_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) to service_role;
grant execute on function public.registrar_cobro_cliente_multi_banca(uuid, jsonb, numeric, text, text, date, uuid, jsonb) to service_role;

commit;
