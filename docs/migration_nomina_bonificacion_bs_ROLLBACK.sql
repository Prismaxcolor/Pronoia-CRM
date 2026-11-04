-- =============================================================================
-- ROLLBACK de docs/migration_nomina_bonificacion_bs.sql
--
-- Se niega a correr si algún renglón ya guarda una bonificación extra en Bs (> 0): quitar la columna borraría ese dinero y la
-- nómina es un registro financiero inmutable. Sin bonificaciones guardadas: restaura nomina_guardar (versión de
-- migration_nomina_dos_sueldos_cargo.sql), el CHECK anterior del préstamo y quita la columna. Idempotente.
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'nomina_lineas' and column_name = 'bonificacion_bs_usd') then
    if exists (select 1 from public.nomina_lineas where bonificacion_bs_usd > 0) then
      raise exception 'Hay renglones con bonificación extra en Bs: no se puede revertir sin perder ese dato. Conserva el respaldo.';
    end if;
  end if;
end $$;

-- Antes de quitar la columna, la función y el CHECK dejan de depender de ella.
create or replace function public.nomina_guardar(p_datos jsonb, p_usuario uuid)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_tipo text := p_datos->>'tipo';
  v_semana date := (p_datos->>'semanaInicio')::date;
  v_version integer := nullif(p_datos->>'version', '')::integer;
  v_tasa numeric := nullif(p_datos->>'tasaBs', '')::numeric;
  v_t jsonb := p_datos->'totales';
  v_n public.nominas%rowtype;
  v_l jsonb;
  v_c jsonb;
  v_linea uuid;
  v_base_bs numeric;
  v_pagar_usd numeric;
  v_pagar_bs numeric;
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
    -- Dos sueldos: lo que se paga en divisas y en Bs. Un cuerpo del backend anterior (sin estos campos) trae UNA moneda de
    -- pago por renglón: se interpreta igual que antes para que el despliegue no se rompa a medias.
    v_base_bs := coalesce(nullif(v_l->>'montoBaseBs', '')::numeric, 0);
    v_pagar_usd := coalesce(nullif(v_l->>'pagarUsd', '')::numeric,
                            case when v_l->>'monedaPago' = 'BS' then 0 else (v_l->>'totalUsd')::numeric end);
    v_pagar_bs := coalesce(nullif(v_l->>'pagarBs', '')::numeric,
                           case when v_l->>'monedaPago' = 'BS' then nullif(v_l->>'totalBs', '')::numeric else 0 end);
    if v_pagar_bs is null or (v_tasa is null and v_base_bs > 0) then
      raise exception 'Indica la tasa de la nómina: hay trabajadores con sueldo en bolívares.';
    end if;
    -- Lo ganado del renglón = bruto (divisas + Bs / tasa) + bonificación; las cuotas de préstamo no pueden pasar de eso.
    if (v_l->>'descuentoPrestamoUsd')::numeric > (v_l->>'totalBrutoUsd')::numeric + (v_l->>'bonificacionUsd')::numeric then
      raise exception 'El descuento de préstamo de un trabajador supera lo que ganó en la semana: baja la cuota.';
    end if;
    insert into public.nomina_lineas (
      nomina_id, trabajador_id, trabajador_nombre, moneda_pago, dias_trabajados, monto_base_usd, monto_base_bs, bruto_bs,
      total_bruto_usd, monto_ref_bs, bonificacion_usd, descuento_trabajo_usd, descuento_prestamo_usd, pagar_usd, pagar_bs,
      total_usd, total_bs, nota)
    values (
      v_n.id, (v_l->>'trabajadorId')::uuid, v_l->>'trabajadorNombre',
      case when v_pagar_bs <> 0 and v_pagar_usd <> 0 then 'MIXTO' when v_pagar_bs <> 0 then 'BS' else 'USD' end,
      (v_l->>'diasTrabajados')::numeric, (v_l->>'montoBaseUsd')::numeric, v_base_bs,
      coalesce(nullif(v_l->>'brutoBs', '')::numeric, 0), (v_l->>'totalBrutoUsd')::numeric,
      (v_l->>'montoRefBs')::numeric, (v_l->>'bonificacionUsd')::numeric, (v_l->>'descuentoTrabajoUsd')::numeric,
      (v_l->>'descuentoPrestamoUsd')::numeric, v_pagar_usd, v_pagar_bs, (v_l->>'totalUsd')::numeric,
      nullif(v_l->>'totalBs', '')::numeric, v_l->>'nota')
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
  if abs(coalesce((select sum(pagar_usd) from public.nomina_lineas where nomina_id = v_n.id), 0)
         - (v_t->>'totalDivisasUsd')::numeric) > 0.01
     or abs(coalesce((select sum(total_usd - pagar_usd) from public.nomina_lineas where nomina_id = v_n.id), 0)
         - (v_t->>'equivalenteUsdDeBs')::numeric) > 0.01
     or (nullif(v_t->>'totalBs', '') is not null
         and abs(coalesce((select sum(pagar_bs) from public.nomina_lineas where nomina_id = v_n.id), 0)
         - (v_t->>'totalBs')::numeric) > 0.01) then
    raise exception 'Los totales no cuadran con los renglones: recarga la pantalla e inténtalo de nuevo.';
  end if;

  update public.nominas set
    tasa_bs = v_tasa,
    total_divisas_usd = (v_t->>'totalDivisasUsd')::numeric,
    total_bs = nullif(v_t->>'totalBs', '')::numeric,
    total_equivalente_usd = (v_t->>'equivalenteUsdDeBs')::numeric,
    total_combinado_usd = (v_t->>'totalCombinadoUsd')::numeric,
    total_combinado_bs = nullif(v_t->>'totalCombinadoBs', '')::numeric,
    cantidad_divisas = (v_t->>'cantidadDivisas')::integer,
    cantidad_bs = (v_t->>'cantidadBs')::integer,
    cantidad_trabajadores = (select count(*) from public.nomina_lineas where nomina_id = v_n.id),
    version = v_n.version + 1,
    updated_at = now()
   where id = v_n.id;
  return v_n.id;
end;
$function$;

revoke execute on function public.nomina_guardar(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.nomina_guardar(jsonb, uuid) to service_role;

alter table public.nomina_lineas drop constraint if exists nomina_lineas_prestamo_dentro_de_ganado;
alter table public.nomina_lineas add constraint nomina_lineas_prestamo_dentro_de_ganado
  check (descuento_prestamo_usd <= total_bruto_usd + bonificacion_usd);
alter table public.nomina_lineas drop column if exists bonificacion_bs_usd;

commit;

notify pgrst, 'reload schema';
