-- =============================================================================
-- ROLLBACK de docs/migration_nomina_dos_sueldos_cargo.sql
--
-- Se niega a correr si ya se usó algo de lo nuevo, porque quitar las columnas perdería datos: algún trabajador con sueldo en
-- Bs, algún renglón con sueldo en Bs o de pago mixto, o algún pago registrado con la migración nueva. En ese caso no se revierte.
-- Lo que la propia migración convirtió se restaura EXACTO desde sus tablas de respaldo (nomina_trabajadores_bak_dos_sueldos y
-- nomina_lineas_bak_dos_sueldos), siempre que nadie lo haya tocado después (el sueldo en Bs sigue igual al convertido, el
-- renglón del borrador sigue siendo el mismo); lo editado después cuenta como «usado» y bloquea el rollback.
--
-- Restaura nomina_guardar, nomina_cerrar y nomina_pagar a las versiones de migration_nomina.sql y
-- migration_nomina_pago_wallet.sql, y quita las columnas y la función nuevas.
-- =============================================================================

begin;

-- Nadie escribe estas tablas mientras se revierte (evita que un guardado o un pago se cuele entre la comprobación y el DROP).
lock table public.nomina_trabajadores, public.nomina_lineas, public.nominas, public.nomina_pagos in share row exclusive mode;

-- Restaura lo que la migración convirtió, si sigue como la dejó (si no, el dato es nuevo y la comprobación de abajo frena).
do $$
begin
  if to_regclass('public.nomina_trabajadores_bak_dos_sueldos') is not null then
    update public.nomina_trabajadores t
       set pago_diario_usd = b.pago_diario_usd, pago_diario_bs = 0, updated_at = b.updated_at
      from public.nomina_trabajadores_bak_dos_sueldos b
     where b.trabajador_id = t.id and t.pago_diario_usd = 0 and t.pago_diario_bs = b.pago_diario_bs_convertido;
  end if;
  if to_regclass('public.nomina_lineas_bak_dos_sueldos') is not null then
    update public.nomina_lineas l
       set monto_base_usd = b.monto_base_usd, monto_base_bs = 0, bruto_bs = 0
      from public.nomina_lineas_bak_dos_sueldos b, public.nominas n
     where b.linea_id = l.id and n.id = l.nomina_id and n.estado = 'BORRADOR'
       and l.monto_base_usd = 0 and l.monto_base_bs = b.monto_base_bs_convertido and l.moneda_pago = 'BS'
       and l.pagar_usd = 0;
  end if;
end $$;

do $$
begin
  if exists (select 1 from public.nomina_trabajadores where pago_diario_bs > 0) then
    raise exception 'Hay trabajadores con sueldo en bolívares: no se puede revertir sin perder ese dato.';
  end if;
  if exists (select 1 from public.nomina_lineas where monto_base_bs > 0 or moneda_pago = 'MIXTO' or pagar_usd <> 0 and pagar_bs <> 0) then
    raise exception 'Hay renglones de nómina con sueldo en bolívares o de pago mixto: no se puede revertir sin perder ese dato.';
  end if;
  if exists (select 1 from public.nomina_pagos where tasa_binance is not null or registrado_en is not null) then
    raise exception 'Hay pagos registrados con la tasa Binance congelada o con su fecha real: no se puede revertir sin perder ese dato.';
  end if;
end $$;

-- nomina_guardar: versión de migration_nomina.sql
create or replace function public.nomina_guardar(p_datos jsonb, p_usuario uuid)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_tipo text := p_datos->>'tipo';
  v_semana date := (p_datos->>'semanaInicio')::date;
  v_version integer := nullif(p_datos->>'version', '')::integer;
  v_t jsonb := p_datos->'totales';
  v_n public.nominas%rowtype;
  v_l jsonb;
  v_c jsonb;
  v_linea uuid;
begin
  perform pg_advisory_xact_lock(hashtext('nomina:' || v_tipo || ':' || v_semana::text));
  select * into v_n from public.nominas where tipo = v_tipo and semana_inicio = v_semana and estado <> 'ANULADA' for update;
  if not found then
    if v_version is not null then
      raise exception 'Esa nómina ya no existe: recarga la pantalla.';
    end if;
    insert into public.nominas (tipo, semana_inicio, registrado_por) values (v_tipo, v_semana, p_usuario) returning * into v_n;
  else
    if v_n.estado <> 'BORRADOR' then
      raise exception 'La nómina de esa semana ya está cerrada: no se puede editar.';
    end if;
    if v_version is null then
      raise exception 'Ya existe una nómina para esa semana: recarga la pantalla para editarla.';
    end if;
    if v_version <> v_n.version then
      raise exception 'Otra persona modificó esta nómina mientras la editabas: recarga la pantalla.';
    end if;
  end if;

  delete from public.nomina_lineas where nomina_id = v_n.id;
  for v_l in select * from jsonb_array_elements(p_datos->'lineas') loop
    if not exists (select 1 from public.nomina_trabajadores t where t.id = (v_l->>'trabajadorId')::uuid and t.tipo = v_tipo) then
      raise exception 'Un trabajador no existe o no corresponde a este tipo de personal.';
    end if;
    if not exists (select 1 from public.nomina_trabajadores t where t.id = (v_l->>'trabajadorId')::uuid and t.activo) then
      raise exception 'Un trabajador está inactivo: quítalo de la nómina.';
    end if;
    -- Lo ganado del renglón = bruto + bonificación; las cuotas de préstamo no pueden pasar de eso.
    if (v_l->>'descuentoPrestamoUsd')::numeric > (v_l->>'totalBrutoUsd')::numeric + (v_l->>'bonificacionUsd')::numeric then
      raise exception 'El descuento de préstamo de un trabajador supera lo que ganó en la semana: baja la cuota.';
    end if;
    insert into public.nomina_lineas (
      nomina_id, trabajador_id, trabajador_nombre, moneda_pago, dias_trabajados, monto_base_usd, total_bruto_usd,
      monto_ref_bs, bonificacion_usd, descuento_trabajo_usd, descuento_prestamo_usd, total_usd, total_bs, nota)
    values (
      v_n.id, (v_l->>'trabajadorId')::uuid, v_l->>'trabajadorNombre', v_l->>'monedaPago',
      (v_l->>'diasTrabajados')::numeric, (v_l->>'montoBaseUsd')::numeric, (v_l->>'totalBrutoUsd')::numeric,
      (v_l->>'montoRefBs')::numeric, (v_l->>'bonificacionUsd')::numeric, (v_l->>'descuentoTrabajoUsd')::numeric,
      (v_l->>'descuentoPrestamoUsd')::numeric, (v_l->>'totalUsd')::numeric, (v_l->>'totalBs')::numeric, v_l->>'nota')
    returning id into v_linea;
    for v_c in select * from jsonb_array_elements(v_l->'cuotas') loop
      if not exists (
        select 1 from public.nomina_prestamos p
         where p.id = (v_c->>'prestamoId')::uuid and p.trabajador_id = (v_l->>'trabajadorId')::uuid
           and p.estado = 'ACTIVO' and p.saldo_usd >= (v_c->>'montoUsd')::numeric) then
        raise exception 'Una cuota de préstamo no es válida: el préstamo no está activo, no es del trabajador o supera su saldo.';
      end if;
      insert into public.nomina_linea_cuotas (linea_id, prestamo_id, monto_usd)
      values (v_linea, (v_c->>'prestamoId')::uuid, (v_c->>'montoUsd')::numeric);
    end loop;
  end loop;

  -- Los totales los calcula el backend; aquí solo se comprueba que cuadren con los renglones.
  if abs(coalesce((select sum(total_usd) from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = 'USD'), 0)
         - (v_t->>'totalDivisasUsd')::numeric) > 0.01
     or abs(coalesce((select sum(total_usd) from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = 'BS'), 0)
         - (v_t->>'equivalenteUsdDeBs')::numeric) > 0.01 then
    raise exception 'Los totales no cuadran con los renglones: recarga la pantalla e inténtalo de nuevo.';
  end if;

  update public.nominas set
    tasa_bs = nullif(p_datos->>'tasaBs', '')::numeric,
    total_divisas_usd = (v_t->>'totalDivisasUsd')::numeric,
    total_bs = nullif(v_t->>'totalBs', '')::numeric,
    total_equivalente_usd = (v_t->>'equivalenteUsdDeBs')::numeric,
    total_combinado_usd = (v_t->>'totalCombinadoUsd')::numeric,
    total_combinado_bs = nullif(v_t->>'totalCombinadoBs', '')::numeric,
    cantidad_divisas = (v_t->>'cantidadDivisas')::integer,
    cantidad_bs = (v_t->>'cantidadBs')::integer,
    version = v_n.version + 1,
    updated_at = now()
   where id = v_n.id;
  return v_n.id;
end;
$function$;

-- nomina_cerrar: versión de migration_nomina.sql
create or replace function public.nomina_cerrar(p_nomina_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_n public.nominas%rowtype;
  v_c record;
begin
  select * into v_n from public.nominas where id = p_nomina_id for update;
  if not found then
    raise exception 'Nómina no encontrada.' using errcode = 'P0002';
  end if;
  if v_n.estado = 'CERRADA' then
    return jsonb_build_object('yaCerrada', true);
  end if;
  if v_n.estado = 'ANULADA' then
    raise exception 'No se puede cerrar una nómina anulada.';
  end if;
  if not exists (select 1 from public.nomina_lineas where nomina_id = v_n.id) then
    raise exception 'La nómina no tiene trabajadores.';
  end if;
  -- Un total negativo solo se tolera en borrador (con aviso); una nómina cerrada no puede pagar montos negativos.
  if exists (select 1 from public.nomina_lineas where nomina_id = v_n.id and total_usd < 0) then
    raise exception 'No se puede cerrar la nómina: hay trabajadores con un total a pagar negativo. Corrige los descuentos o los montos de esos renglones y guarda de nuevo.';
  end if;
  if v_n.tasa_bs is null and exists (select 1 from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = 'BS') then
    raise exception 'Indica la tasa para cerrar: hay trabajadores que se pagan en bolívares.';
  end if;

  perform set_config('nomina.ledger', '1', true);
  for v_c in
    select c.prestamo_id, sum(c.monto_usd) as monto
      from public.nomina_lineas l join public.nomina_linea_cuotas c on c.linea_id = l.id
     where l.nomina_id = v_n.id
     group by c.prestamo_id order by c.prestamo_id
  loop
    update public.nomina_prestamos
       set saldo_usd = saldo_usd - v_c.monto,
           estado = case when saldo_usd - v_c.monto = 0 then 'PAGADO' else estado end,
           updated_at = now()
     where id = v_c.prestamo_id and estado = 'ACTIVO' and saldo_usd >= v_c.monto;
    if not found then
      raise exception 'Un préstamo ya no está activo o su saldo es menor que la cuota: revisa los descuentos de préstamo.';
    end if;
    insert into public.nomina_prestamo_movimientos (prestamo_id, nomina_id, tipo, monto_usd)
    values (v_c.prestamo_id, v_n.id, 'CUOTA', v_c.monto);
  end loop;

  update public.nominas set estado = 'CERRADA', cerrada_at = now(), cerrada_por = p_usuario, updated_at = now()
   where id = v_n.id;
  return jsonb_build_object('yaCerrada', false);
end;
$function$;

-- nomina_pagar: versión de migration_nomina_pago_wallet.sql
create or replace function public.nomina_pagar(p_nomina_id uuid, p_datos jsonb, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  c_fn_comision constant text := 'public.crear_movimiento_con_comision_bancaria(text, uuid, uuid, numeric, numeric, text, text, date, uuid, uuid, uuid)';
  v_n          public.nominas%rowtype;
  v_fecha      date := nullif(p_datos->>'fecha', '')::date;
  v_ref        text := nullif(btrim(coalesce(p_datos->>'referencia', '')), '');
  v_cat        uuid := nullif(p_datos->>'categoriaId', '')::uuid;
  v_pagos      jsonb := p_datos->'pagos';
  v_p          jsonb;
  v_moneda     text;
  v_banca      uuid;
  v_lleva      boolean;
  v_monto      numeric;
  v_monto_usd  numeric;
  v_cant       integer;
  v_nom_b      text;
  v_mon_b      text;
  v_mon_esperada text;
  v_sal_b      numeric;
  v_arch_b     boolean;
  v_comision   numeric;
  v_com_id     uuid;
  v_mov_id     uuid;
  v_num        bigint;
  v_desc       text;
  v_r          jsonb;
  v_res        jsonb := '[]'::jsonb;
  v_requeridas text[];
  v_enviadas   text[];
begin
  if p_usuario is null then raise exception 'Falta el usuario que registra el pago.'; end if;
  select * into v_n from public.nominas where id = p_nomina_id for update;
  if not found then
    raise exception 'Nómina no encontrada.' using errcode = 'P0002';
  end if;
  if v_n.estado = 'ANULADA' then raise exception 'No se puede pagar una nómina anulada.'; end if;
  if v_n.estado <> 'CERRADA' then raise exception 'Solo se puede pagar una nómina cerrada: ciérrala primero.'; end if;
  if exists (select 1 from public.nomina_pagos where nomina_id = v_n.id) then
    return jsonb_build_object('yaPagada', true);
  end if;

  if v_fecha is null then raise exception 'La fecha del pago es obligatoria.'; end if;
  if v_fecha > (now() at time zone 'America/Caracas')::date + 1 then raise exception 'La fecha del pago no puede ser posterior a mañana.'; end if;
  if v_fecha < v_n.semana_inicio then raise exception 'La fecha del pago no puede ser anterior a la semana de la nómina.'; end if;
  if jsonb_typeof(v_pagos) is distinct from 'array' or jsonb_array_length(v_pagos) = 0 then
    raise exception 'Elige la cuenta desde la que se paga.';
  end if;

  -- Monedas con algo que pagar (la BD es la autoridad: se calcula de los renglones, no de lo que mande el navegador).
  select coalesce(array_agg(m order by m), '{}') into v_requeridas from (
    select 'USD' as m from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = 'USD' having coalesce(sum(total_usd), 0) > 0
    union all
    select 'BS' from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = 'BS' having coalesce(sum(total_bs), 0) > 0
  ) x;
  if coalesce(array_length(v_requeridas, 1), 0) = 0 then raise exception 'La nómina no tiene montos por pagar.'; end if;
  select coalesce(array_agg(e->>'moneda' order by e->>'moneda'), '{}') into v_enviadas from jsonb_array_elements(v_pagos) e;
  if v_enviadas is distinct from v_requeridas then
    raise exception 'Elige una cuenta para cada moneda a pagar (%).', array_to_string(v_requeridas, ' y ');
  end if;

  -- Bloquea las cuentas (en orden fijo) antes de leer saldos.
  perform 1 from public.bancas
   where id in (select (e->>'bancaId')::uuid from jsonb_array_elements(v_pagos) e) order by id for update;

  for v_p in select e from jsonb_array_elements(v_pagos) e order by e->>'moneda' loop
    v_moneda := v_p->>'moneda';
    v_banca := (v_p->>'bancaId')::uuid;
    v_lleva := case when jsonb_typeof(v_p->'llevaComision') = 'boolean' then (v_p->>'llevaComision')::boolean end;

    select nombre, moneda, saldo, archivada into v_nom_b, v_mon_b, v_sal_b, v_arch_b from public.bancas where id = v_banca;
    if v_nom_b is null then raise exception 'La cuenta elegida no existe.'; end if;
    if v_arch_b then raise exception 'La cuenta % está archivada.', v_nom_b; end if;
    v_mon_esperada := case v_moneda when 'USD' then 'USD' else 'VES' end;
    if v_mon_b <> v_mon_esperada then
      raise exception 'La cuenta % es en % y este pago es en %.', v_nom_b, v_mon_b, case v_moneda when 'USD' then 'divisas (USD)' else 'bolívares (Bs)' end;
    end if;

    select round(coalesce(sum(case v_moneda when 'USD' then total_usd else total_bs end), 0), 2),
           round(coalesce(sum(total_usd), 0), 2), count(*)
      into v_monto, v_monto_usd, v_cant
      from public.nomina_lineas where nomina_id = v_n.id and moneda_pago = v_moneda;
    v_desc := 'Nómina NOM-' || lpad(v_n.numero::text, 4, '0') || ' · '
      || case v_n.tipo when 'ADMINISTRATIVO' then 'Personal administrativo' else 'Personal operativo' end
      || ' · semana del ' || to_char(v_n.semana_inicio, 'DD/MM/YYYY')
      || ' · ' || case v_moneda when 'USD' then 'divisas' else 'bolívares' end;

    v_comision := null;
    v_com_id := null;
    if v_mon_b = 'VES' and v_lleva is true then
      if to_regprocedure(c_fn_comision) is null then
        raise exception 'La comisión bancaria aún no está habilitada en la base de datos (falta aplicar migration_wallet_comision_bancaria.sql).';
      end if;
      -- Reutiliza la regla vigente de comisión: valida cuenta VES y saldo para monto + comisión.
      v_r := public.crear_movimiento_con_comision_bancaria(
        'egreso', v_banca, null, v_monto, null, v_desc, v_ref, v_fecha, null, null, p_usuario);
      v_mov_id := (v_r->>'movimientoId')::uuid;
      v_num := (v_r->>'numeroSistema')::bigint;
      v_comision := (v_r->>'comision')::numeric;
      v_com_id := (v_r->>'comisionId')::uuid;
    else
      if v_mon_b = 'VES' and v_lleva is null and to_regprocedure(c_fn_comision) is not null then
        raise exception 'Indica si el pago en bolívares lleva comisión bancaria.';
      end if;
      if v_sal_b < v_monto then
        raise exception 'Saldo insuficiente en %: disponible %, se necesita %.', v_nom_b, round(v_sal_b, 2), v_monto;
      end if;
      insert into public.movimientos (tipo, monto, moneda, descripcion, banca_origen_id, fecha, referencia, registrado_por)
      values ('egreso', v_monto, v_mon_b, v_desc, v_banca, v_fecha, v_ref, p_usuario)
      returning id, numero_sistema into v_mov_id, v_num;
    end if;

    if v_cat is not null then
      update public.movimientos set categoria_id = v_cat where id = v_mov_id;
      -- El cargo de comisión bancaria (egreso aparte, comision_de_id) lleva la misma categoría que el egreso principal.
      if v_com_id is not null then
        update public.movimientos set categoria_id = v_cat where id = v_com_id;
      end if;
    end if;

    insert into public.nomina_pagos (nomina_id, moneda_pago, banca_id, movimiento_id, monto, monto_usd, cantidad, fecha, referencia, pagado_por)
    values (v_n.id, v_moneda, v_banca, v_mov_id, v_monto, v_monto_usd, v_cant, v_fecha, v_ref, p_usuario);

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'moneda', v_moneda, 'bancaId', v_banca, 'movimientoId', v_mov_id, 'numeroSistema', v_num, 'monto', v_monto,
      'comision', v_comision, 'comisionId', v_com_id, 'sinComision', (v_mon_b = 'VES' and v_lleva is false)));
  end loop;

  return jsonb_build_object('yaPagada', false, 'pagos', v_res);
end;
$function$;

revoke execute on function public.nomina_guardar(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_cerrar(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_pagar(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.nomina_guardar(jsonb, uuid) to service_role;
grant execute on function public.nomina_cerrar(uuid, uuid) to service_role;
grant execute on function public.nomina_pagar(uuid, jsonb, uuid) to service_role;

drop function if exists public.tasa_binance_del_dia(date);

alter table public.nomina_pagos drop constraint if exists nomina_pagos_tasa_binance_coherente;
alter table public.nomina_pagos drop column if exists registrado_en;
alter table public.nomina_pagos drop column if exists equivalente_binance_usd;
alter table public.nomina_pagos drop column if exists tasa_binance_capturada;
alter table public.nomina_pagos drop column if exists tasa_binance;

alter table public.nominas drop column if exists cantidad_trabajadores;

-- Renglones: vuelven a una sola moneda de pago por renglón (la comprobación de arriba garantiza que no hay mixtos).
alter table public.nomina_lineas drop constraint if exists nomina_lineas_moneda_pago_check;
alter table public.nomina_lineas add constraint nomina_lineas_moneda_pago_check check (moneda_pago in ('USD', 'BS'));
alter table public.nomina_lineas drop column if exists pagar_bs;
alter table public.nomina_lineas drop column if exists pagar_usd;
alter table public.nomina_lineas drop column if exists bruto_bs;
alter table public.nomina_lineas drop column if exists monto_base_bs;

alter table public.nomina_trabajadores drop column if exists pago_diario_bs;

-- Ya restaurado todo lo restaurable: los respaldos dejan de hacer falta.
drop table if exists public.nomina_lineas_bak_dos_sueldos;
drop table if exists public.nomina_trabajadores_bak_dos_sueldos;

commit;

notify pgrst, 'reload schema';
