-- =============================================================================
-- Wallet: categoría "COMISIONES BANCARIAS" para TODOS los cargos de comisión bancaria.
--
-- Un "cargo de comisión" es el egreso que nace junto a un movimiento y apunta a él con movimientos.comision_de_id
-- (Wallet, pagos a proveedor y nómina; ver migration_wallet_comision_bancaria.sql). Qué hace:
--
--  1. Crea la categoría COMISIONES BANCARIAS (tipo EGRESO) si no existe. Si ya existe una activa que admite egresos
--     (en cualquier nivel), la reutiliza. Si existe pero está archivada o es solo de ingresos, la migración se
--     detiene con un aviso (no la toca): corrígela en Wallet > Categorías y vuelve a ejecutar.
--     Dónde se crea: como SUBCATEGORÍA de GASTOS FINANCIEROS si esa categoría activa existe (allí viven las de
--     nómina); si no, como categoría raíz.
--  2. Registra el uso `comision_bancaria` en public.categorias_uso (se amplía su check) apuntando a esa categoría,
--     igual que pago_proveedor y nómina: renombrarla no rompe nada y el backend la encuentra por el uso.
--  3. Trigger movimientos_categoria_comision: todo movimiento con comision_de_id (es decir, todo cargo de comisión)
--     recibe esa categoría al insertarse y si alguien intenta cambiársela. Cubre cualquier camino (RPC de Wallet,
--     de pagos, de nómina) sin tocar sus funciones. Si la categoría estuviera archivada o el uso sin asignar, el
--     trigger NO interviene (el cargo se registra sin categoría) para no bloquear nunca un pago.
--     Corre antes de trg_movimientos_validar_categoria (orden alfabético), que valida el valor resultante.
--
-- Efecto sobre nómina: el cargo de comisión de un pago de nómina deja de llevar la categoría del egreso principal
-- y lleva COMISIONES BANCARIAS (decisión del cliente: todas las comisiones bancarias en una sola categoría).
--
-- Históricos: docs/correccion_categoria_comisiones_historicas.sql (opcional). Verificación: docs/verificar_categoria_comisiones.sql.
-- Requisitos: migration_wallet_categorias.sql y migration_categorias_uso.sql (obligatorias);
-- migration_wallet_comision_bancaria.sql (si falta, no se crea el trigger: vuelve a ejecutar esto después de aplicarla).
-- Aditiva e idempotente. ROLLBACK: docs/migration_categoria_comisiones_bancarias_ROLLBACK.sql. NO se aplica sola.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.categorias_wallet') is null or to_regclass('public.categorias_uso') is null then
    raise exception 'Faltan migration_wallet_categorias.sql y/o migration_categorias_uso.sql: aplícalas antes.';
  end if;
end $$;

-- 1. Amplía los usos válidos (el check original lista solo 4) ----------------------------------------------
do $$
declare
  v_check record;
begin
  for v_check in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.categorias_uso'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%pago_proveedor%'
  loop
    execute format('alter table public.categorias_uso drop constraint %I', v_check.conname);
  end loop;
end $$;

alter table public.categorias_uso drop constraint if exists categorias_uso_uso_valido;
alter table public.categorias_uso add constraint categorias_uso_uso_valido check (
  uso in ('pago_proveedor', 'cobro_cliente', 'nomina_administrativo', 'nomina_operativo', 'comision_bancaria')
);

-- 2. Categoría COMISIONES BANCARIAS y su uso ------------------------------------------------------------------
do $$
declare
  c_nombre constant text := 'COMISIONES BANCARIAS';
  v_cat    uuid;
  v_padre  uuid;
begin
  select id into v_cat
    from public.categorias_wallet
   where upper(btrim(nombre)) = c_nombre and activo and tipo in ('EGRESO', 'AMBOS')
   order by created_at
   limit 1;

  if v_cat is null then
    if exists (select 1 from public.categorias_wallet where upper(btrim(nombre)) = c_nombre) then
      raise exception 'Ya existe una categoría "%" pero está archivada o es solo de ingresos. Actívala o cámbiala a EGRESO/AMBOS desde Wallet > Categorías y vuelve a ejecutar esta migración.', c_nombre;
    end if;

    select id into v_padre
      from public.categorias_wallet
     where upper(btrim(nombre)) = 'GASTOS FINANCIEROS' and padre_id is null and activo and tipo in ('EGRESO', 'AMBOS')
     order by created_at
     limit 1;

    insert into public.categorias_wallet (nombre, tipo, padre_id)
    values (c_nombre, 'EGRESO', v_padre)
    returning id into v_cat;
    raise notice 'Categoría % creada (%).', c_nombre, case when v_padre is null then 'categoría raíz' else 'subcategoría de GASTOS FINANCIEROS' end;
  end if;

  -- Un solo uso: si ya está asignada (p. ej. al volver a ejecutar), no se pisa.
  insert into public.categorias_uso (uso, categoria_id)
  select 'comision_bancaria', v_cat
   where not exists (select 1 from public.categorias_uso where uso = 'comision_bancaria');
end $$;

-- 3. Trigger: todo cargo de comisión lleva la categoría del uso comision_bancaria ---------------------------------
create or replace function public.movimientos_categoria_comision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cat uuid;
begin
  -- Solo una categoría vigente (y de padre vigente): una archivada haría fallar la validación y bloquearía el pago.
  select u.categoria_id into v_cat
    from public.categorias_uso u
    join public.categorias_wallet c on c.id = u.categoria_id
    left join public.categorias_wallet p on p.id = c.padre_id
   where u.uso = 'comision_bancaria' and c.activo and (p.id is null or p.activo) and c.tipo in ('EGRESO', 'AMBOS')
   limit 1;
  if v_cat is not null then
    new.categoria_id := v_cat;
  end if;
  return new;
end;
$function$;

revoke execute on function public.movimientos_categoria_comision() from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'movimientos' and column_name = 'comision_de_id'
  ) then
    drop trigger if exists trg_movimientos_categoria_comision on public.movimientos;
    create trigger trg_movimientos_categoria_comision
      before insert or update of categoria_id, comision_de_id on public.movimientos
      for each row
      when (new.comision_de_id is not null)
      execute function public.movimientos_categoria_comision();
  else
    raise notice 'Falta migration_wallet_comision_bancaria.sql (columna comision_de_id): se creó la categoría y su uso, pero NO el trigger. Aplica esa migración y vuelve a ejecutar este archivo.';
  end if;
end $$;

commit;

-- Recarga el esquema de PostgREST.
notify pgrst, 'reload schema';

-- Verificación (a mano): docs/verificar_categoria_comisiones.sql
