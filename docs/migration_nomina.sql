-- =============================================================================
-- Nómina (fase 1: registro y cálculo). Personal administrativo y operativo, nómina semanal por tipo,
-- préstamos y adelantos. NO mueve dinero ni toca Wallet/bancas (siguiente fase: ver docs/DISENO_nomina.md).
--
--   * public.nomina_trabajadores         : ficha del trabajador (DATOS PERSONALES SENSIBLES) + pago diario en USD.
--   * public.nomina_prestamos            : préstamo/adelanto con saldo pendiente; numero PRE-0001.
--   * public.nomina_prestamo_movimientos : libro inmutable de cuotas (CUOTA al cerrar, REVERSA al anular una cerrada).
--   * public.nominas                     : una por (tipo, semana) no anulada; semana = fecha del lunes; numero NOM-0001.
--   * public.nomina_lineas               : un renglón por trabajador (montos ya calculados por el backend).
--   * public.nomina_linea_cuotas         : cuotas de préstamo planeadas en cada renglón (se aplican al cerrar).
--
-- Reglas de negocio que también vigila la BD (el backend las valida antes, esto es la última barrera):
--   * Cédula: el índice único la compara NORMALIZADA (mayúsculas, sin puntos, guiones ni espacios): "V-12.345.678"
--     y "V12345678" son la misma persona. El backend la guarda ya normalizada.
--   * nomina_guardar rechaza trabajadores inactivos y descuentos de préstamo mayores a lo ganado del renglón
--     (lo ganado = total bruto + bonificación); nomina_lineas lo refuerza con un CHECK.
--   * nomina_cerrar NO cierra una nómina con algún renglón de total negativo: un negativo solo puede quedar en
--     borrador (con aviso); para cerrar hay que corregir los montos.
--   * El tipo (ADMINISTRATIVO/OPERATIVO) de un trabajador que ya aparece en alguna nómina no se puede cambiar.
--
-- Estados: nómina BORRADOR -> CERRADA -> ANULADA (con motivo); préstamo ACTIVO -> PAGADO | ANULADO.
-- Cerrada = inmutable salvo anulación con motivo (trigger). Sin borrado físico de trabajadores (activo = false), de
-- préstamos ni de nóminas cerradas/anuladas.
--
-- Funciones atómicas (todas bloquean la fila; reintentar no duplica nada):
--   nomina_guardar(jsonb, uuid)   crea o reemplaza el borrador de (tipo, semana); controla la versión.
--   nomina_cerrar(uuid, uuid)     descuenta las cuotas, baja los saldos y cierra; si ya estaba cerrada no hace nada.
--   nomina_anular(uuid,text,uuid) anula; si estaba cerrada, devuelve las cuotas al saldo (REVERSA).
--
-- Seguridad: RLS activado y deny-all para anon/authenticated; solo el backend Express (service_role, que bypassa RLS)
-- accede. Las funciones fijan search_path vacío y solo service_role puede ejecutarlas. El backend responde 503 en
-- /api/nomina mientras estas tablas no existan.
--
-- Migración 100% aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_nomina_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo.
-- =============================================================================

begin;

create sequence if not exists public.nomina_numero_seq;
create sequence if not exists public.nomina_prestamo_numero_seq;

-- 1. Trabajadores ---------------------------------------------------------------
create table if not exists public.nomina_trabajadores (
  id                           uuid          primary key default gen_random_uuid(),
  tipo                         text          not null check (tipo in ('ADMINISTRATIVO', 'OPERATIVO')),
  nombres                      text          not null check (char_length(btrim(nombres)) between 1 and 80),
  apellidos                    text          not null check (char_length(btrim(apellidos)) between 1 and 80),
  cedula                       text          not null check (char_length(btrim(cedula)) between 3 and 20),
  rif                          text          check (rif is null or char_length(btrim(rif)) between 3 and 20),
  telefono                     text          check (telefono is null or char_length(telefono) <= 30),
  direccion                    text          check (direccion is null or char_length(direccion) <= 300),
  contacto_emergencia_nombre   text          check (contacto_emergencia_nombre is null or char_length(contacto_emergencia_nombre) <= 120),
  contacto_emergencia_telefono text          check (contacto_emergencia_telefono is null or char_length(contacto_emergencia_telefono) <= 30),
  pago_movil_banco             text          check (pago_movil_banco is null or char_length(pago_movil_banco) <= 60),
  pago_movil_telefono          text          check (pago_movil_telefono is null or char_length(pago_movil_telefono) <= 30),
  pago_movil_cedula            text          check (pago_movil_cedula is null or char_length(pago_movil_cedula) <= 20),
  binance_correo_id            text          check (binance_correo_id is null or char_length(binance_correo_id) <= 120),
  pago_diario_usd              numeric(14,2) not null default 0 check (pago_diario_usd >= 0),
  activo                       boolean       not null default true,
  created_at                   timestamptz   not null default now(),
  updated_at                   timestamptz   not null default now()
);

-- Cédula normalizada: mayúsculas y solo letras y números (quita puntos, guiones y espacios). Misma regla que el
-- backend (backend/src/utils/nomina-cedula.ts): si se cambia una, cambiar la otra.
create unique index if not exists idx_nomina_trabajadores_cedula
  on public.nomina_trabajadores ((upper(regexp_replace(cedula, '[^A-Za-z0-9]', '', 'g'))));
create index if not exists idx_nomina_trabajadores_tipo_activo
  on public.nomina_trabajadores (tipo, activo);

-- 2. Préstamos y adelantos ----------------------------------------------------------
create table if not exists public.nomina_prestamos (
  id                uuid          primary key default gen_random_uuid(),
  numero            bigint        not null default nextval('public.nomina_prestamo_numero_seq'),
  trabajador_id     uuid          not null references public.nomina_trabajadores(id) on delete restrict,
  tipo              text          not null check (tipo in ('PRESTAMO', 'ADELANTO')),
  monto_usd         numeric(14,2) not null check (monto_usd > 0),
  saldo_usd         numeric(14,2) not null check (saldo_usd >= 0),
  cuota_semanal_usd numeric(14,2) check (cuota_semanal_usd is null or (cuota_semanal_usd > 0 and cuota_semanal_usd <= monto_usd)),
  fecha             date          not null,
  nota              text          check (nota is null or char_length(nota) <= 300),
  estado            text          not null default 'ACTIVO' check (estado in ('ACTIVO', 'PAGADO', 'ANULADO')),
  registrado_por    uuid          references public.users(id) on delete set null,
  anulado_motivo    text,
  anulado_at        timestamptz,
  anulado_por       uuid          references public.users(id) on delete set null,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  constraint nomina_prestamos_saldo_max check (saldo_usd <= monto_usd),
  constraint nomina_prestamos_pagado_coherente check (estado = 'ANULADO' or ((estado = 'PAGADO') = (saldo_usd = 0))),
  constraint nomina_prestamos_anulado_coherente check (estado <> 'ANULADO' or (anulado_at is not null and anulado_motivo is not null))
);

create unique index if not exists idx_nomina_prestamos_numero on public.nomina_prestamos (numero);
create index if not exists idx_nomina_prestamos_trabajador on public.nomina_prestamos (trabajador_id, estado);

-- 3. Nóminas, renglones y cuotas planeadas -----------------------------------------------
create table if not exists public.nominas (
  id                    uuid          primary key default gen_random_uuid(),
  numero                bigint        not null default nextval('public.nomina_numero_seq'),
  tipo                  text          not null check (tipo in ('ADMINISTRATIVO', 'OPERATIVO')),
  semana_inicio         date          not null check (extract(isodow from semana_inicio) = 1),
  tasa_bs               numeric(18,6) check (tasa_bs is null or tasa_bs > 0),
  estado                text          not null default 'BORRADOR' check (estado in ('BORRADOR', 'CERRADA', 'ANULADA')),
  version               integer       not null default 1,
  total_divisas_usd     numeric(16,2) not null default 0,
  total_bs              numeric(18,2),
  total_equivalente_usd numeric(16,2) not null default 0,
  total_combinado_usd   numeric(16,2) not null default 0,
  total_combinado_bs    numeric(18,2),
  cantidad_divisas      integer       not null default 0,
  cantidad_bs           integer       not null default 0,
  registrado_por        uuid          references public.users(id) on delete set null,
  cerrada_at            timestamptz,
  cerrada_por           uuid          references public.users(id) on delete set null,
  anulada_motivo        text,
  anulada_at            timestamptz,
  anulada_por           uuid          references public.users(id) on delete set null,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint nominas_cerrada_coherente check (estado <> 'CERRADA' or cerrada_at is not null),
  constraint nominas_anulada_coherente check (estado <> 'ANULADA' or (anulada_at is not null and anulada_motivo is not null))
);

create unique index if not exists idx_nominas_numero on public.nominas (numero);
-- Una nómina por (tipo, semana): las anuladas no cuentan, así se puede cargar otra después de anular.
create unique index if not exists idx_nominas_tipo_semana_vigente
  on public.nominas (tipo, semana_inicio) where estado <> 'ANULADA';
create index if not exists idx_nominas_semana on public.nominas (semana_inicio desc);

create table if not exists public.nomina_lineas (
  id                     uuid          primary key default gen_random_uuid(),
  nomina_id              uuid          not null references public.nominas(id) on delete cascade,
  trabajador_id          uuid          not null references public.nomina_trabajadores(id) on delete restrict,
  trabajador_nombre      text          not null,
  moneda_pago            text          not null check (moneda_pago in ('USD', 'BS')),
  dias_trabajados        numeric(4,2)  not null check (dias_trabajados >= 0 and dias_trabajados <= 7),
  monto_base_usd         numeric(14,2) not null check (monto_base_usd >= 0),
  total_bruto_usd        numeric(14,2) not null,
  monto_ref_bs           numeric(18,2),
  bonificacion_usd       numeric(14,2) not null default 0 check (bonificacion_usd >= 0),
  descuento_trabajo_usd  numeric(14,2) not null default 0 check (descuento_trabajo_usd >= 0),
  descuento_prestamo_usd numeric(14,2) not null default 0 check (descuento_prestamo_usd >= 0),
  total_usd              numeric(14,2) not null,
  total_bs               numeric(18,2),
  nota                   text          check (nota is null or char_length(nota) <= 200),
  unique (nomina_id, trabajador_id),
  -- Un descuento de préstamo nunca puede superar lo ganado del renglón (bruto + bonificación).
  constraint nomina_lineas_prestamo_dentro_de_ganado check (descuento_prestamo_usd <= total_bruto_usd + bonificacion_usd)
);

create index if not exists idx_nomina_lineas_trabajador on public.nomina_lineas (trabajador_id);

create table if not exists public.nomina_linea_cuotas (
  id          uuid          primary key default gen_random_uuid(),
  linea_id    uuid          not null references public.nomina_lineas(id) on delete cascade,
  prestamo_id uuid          not null references public.nomina_prestamos(id) on delete restrict,
  monto_usd   numeric(14,2) not null check (monto_usd > 0),
  unique (linea_id, prestamo_id)
);

create index if not exists idx_nomina_linea_cuotas_prestamo on public.nomina_linea_cuotas (prestamo_id);

-- 4. Libro de cuotas aplicadas (inmutable) ------------------------------------------------
create table if not exists public.nomina_prestamo_movimientos (
  id          uuid          primary key default gen_random_uuid(),
  prestamo_id uuid          not null references public.nomina_prestamos(id) on delete restrict,
  nomina_id   uuid          not null references public.nominas(id) on delete restrict,
  tipo        text          not null check (tipo in ('CUOTA', 'REVERSA')),
  monto_usd   numeric(14,2) not null check (monto_usd > 0),
  created_at  timestamptz   not null default now(),
  -- Garantiza que una nómina nunca descuente dos veces el mismo préstamo (ni revierta dos veces).
  unique (prestamo_id, nomina_id, tipo)
);

-- 5. Triggers de protección ---------------------------------------------------------------
create or replace function public.nominas_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'BORRADOR' then
      raise exception 'Las nóminas cerradas o anuladas no se borran: se anulan.';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.numero is distinct from old.numero
     or new.tipo is distinct from old.tipo or new.semana_inicio is distinct from old.semana_inicio
     or new.created_at is distinct from old.created_at
     or (new.registrado_por is distinct from old.registrado_por and new.registrado_por is not null) then
    raise exception 'No se puede cambiar el número, el tipo ni la semana de una nómina.';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'Una nómina anulada no se puede modificar.';
  end if;
  if old.estado = 'CERRADA' then
    if new.estado <> 'ANULADA' then
      raise exception 'Una nómina cerrada no se puede modificar: anúlala con un motivo.';
    end if;
    if (new.tasa_bs, new.version, new.total_divisas_usd, new.total_bs, new.total_equivalente_usd,
        new.total_combinado_usd, new.total_combinado_bs, new.cerrada_at, new.cerrada_por)
       is distinct from
       (old.tasa_bs, old.version, old.total_divisas_usd, old.total_bs, old.total_equivalente_usd,
        old.total_combinado_usd, old.total_combinado_bs, old.cerrada_at, old.cerrada_por) then
      raise exception 'Al anular una nómina cerrada no se puede cambiar nada más.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.nomina_hijos_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_nomina uuid;
  v_estado text;
begin
  if tg_table_name = 'nomina_lineas' then
    v_nomina := case when tg_op = 'DELETE' then old.nomina_id else new.nomina_id end;
  else
    select l.nomina_id into v_nomina from public.nomina_lineas l
     where l.id = case when tg_op = 'DELETE' then old.linea_id else new.linea_id end;
  end if;
  -- Sin padre (borrado en cascada de un borrador) no hay nada que proteger.
  select n.estado into v_estado from public.nominas n where n.id = v_nomina;
  if v_estado is not null and v_estado <> 'BORRADOR' then
    raise exception 'La nómina ya no es un borrador: sus renglones no se pueden cambiar.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function public.nomina_prestamos_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.saldo_usd := new.monto_usd;
    new.estado := 'ACTIVO';
    new.anulado_motivo := null;
    new.anulado_at := null;
    new.anulado_por := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Los préstamos no se borran: se anulan.';
  end if;
  if new.id is distinct from old.id or new.numero is distinct from old.numero
     or new.trabajador_id is distinct from old.trabajador_id or new.tipo is distinct from old.tipo
     or new.monto_usd is distinct from old.monto_usd or new.fecha is distinct from old.fecha
     or new.created_at is distinct from old.created_at
     or (new.registrado_por is distinct from old.registrado_por and new.registrado_por is not null) then
    raise exception 'No se puede cambiar el monto, el trabajador, la fecha ni el tipo de un préstamo: anúlalo y registra otro.';
  end if;
  if old.estado = 'ANULADO' then
    raise exception 'Un préstamo anulado no se puede modificar.';
  end if;
  -- El saldo solo se mueve desde nomina_cerrar / nomina_anular (que marcan la sesión).
  if new.saldo_usd is distinct from old.saldo_usd
     and coalesce(current_setting('nomina.ledger', true), '') <> '1' then
    raise exception 'El saldo de un préstamo solo cambia al cerrar o anular una nómina.';
  end if;
  if new.estado = 'ANULADO' and new.saldo_usd <> new.monto_usd then
    raise exception 'El préstamo ya tiene cuotas descontadas: no se puede anular.';
  end if;
  return new;
end;
$function$;

create or replace function public.nomina_movimientos_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'El historial de cuotas de préstamos no se modifica ni se borra.';
end;
$function$;

create or replace function public.nomina_trabajadores_proteger()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.tipo is distinct from old.tipo
     and exists (select 1 from public.nomina_lineas l where l.trabajador_id = old.id) then
    raise exception 'No se puede cambiar el tipo de personal de un trabajador que ya aparece en alguna nómina: desactívalo y registra otro.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_nomina_trabajadores_proteger on public.nomina_trabajadores;
create trigger trg_nomina_trabajadores_proteger
  before update on public.nomina_trabajadores
  for each row execute function public.nomina_trabajadores_proteger();

drop trigger if exists trg_nominas_proteger on public.nominas;
create trigger trg_nominas_proteger
  before update or delete on public.nominas
  for each row execute function public.nominas_proteger();

drop trigger if exists trg_nomina_lineas_proteger on public.nomina_lineas;
create trigger trg_nomina_lineas_proteger
  before insert or update or delete on public.nomina_lineas
  for each row execute function public.nomina_hijos_proteger();

drop trigger if exists trg_nomina_linea_cuotas_proteger on public.nomina_linea_cuotas;
create trigger trg_nomina_linea_cuotas_proteger
  before insert or update or delete on public.nomina_linea_cuotas
  for each row execute function public.nomina_hijos_proteger();

drop trigger if exists trg_nomina_prestamos_proteger on public.nomina_prestamos;
create trigger trg_nomina_prestamos_proteger
  before insert or update or delete on public.nomina_prestamos
  for each row execute function public.nomina_prestamos_proteger();

drop trigger if exists trg_nomina_movimientos_proteger on public.nomina_prestamo_movimientos;
create trigger trg_nomina_movimientos_proteger
  before update or delete on public.nomina_prestamo_movimientos
  for each row execute function public.nomina_movimientos_proteger();

-- 6. Guardar el borrador (crea o reemplaza el de la semana) -----------------------------------------------
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

-- 7. Cerrar: descuenta cuotas y baja saldos (atómico, sin doble descuento) ---------------------------------
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

-- 8. Anular: si estaba cerrada, devuelve las cuotas al saldo ----------------------------------------------
create or replace function public.nomina_anular(p_nomina_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_n public.nominas%rowtype;
  v_m record;
begin
  select * into v_n from public.nominas where id = p_nomina_id for update;
  if not found then
    raise exception 'Nómina no encontrada.' using errcode = 'P0002';
  end if;
  if v_n.estado = 'ANULADA' then
    return jsonb_build_object('yaAnulada', true);
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'El motivo de la anulación es obligatorio.';
  end if;

  if v_n.estado = 'CERRADA' then
    perform set_config('nomina.ledger', '1', true);
    for v_m in
      select m.prestamo_id, m.monto_usd from public.nomina_prestamo_movimientos m
       where m.nomina_id = v_n.id and m.tipo = 'CUOTA'
         and not exists (select 1 from public.nomina_prestamo_movimientos r
                          where r.nomina_id = m.nomina_id and r.prestamo_id = m.prestamo_id and r.tipo = 'REVERSA')
       order by m.prestamo_id
    loop
      update public.nomina_prestamos
         set saldo_usd = saldo_usd + v_m.monto_usd,
             estado = case when estado = 'PAGADO' then 'ACTIVO' else estado end,
             updated_at = now()
       where id = v_m.prestamo_id and estado <> 'ANULADO';
      insert into public.nomina_prestamo_movimientos (prestamo_id, nomina_id, tipo, monto_usd)
      values (v_m.prestamo_id, v_n.id, 'REVERSA', v_m.monto_usd);
    end loop;
  end if;

  update public.nominas
     set estado = 'ANULADA', anulada_motivo = btrim(p_motivo), anulada_at = now(), anulada_por = p_usuario, updated_at = now()
   where id = v_n.id;
  return jsonb_build_object('yaAnulada', false);
end;
$function$;

revoke execute on function public.nomina_trabajadores_proteger() from public, anon, authenticated;
revoke execute on function public.nominas_proteger() from public, anon, authenticated;
revoke execute on function public.nomina_hijos_proteger() from public, anon, authenticated;
revoke execute on function public.nomina_prestamos_proteger() from public, anon, authenticated;
revoke execute on function public.nomina_movimientos_proteger() from public, anon, authenticated;
revoke execute on function public.nomina_guardar(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_cerrar(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.nomina_anular(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.nomina_guardar(jsonb, uuid) to service_role;
grant execute on function public.nomina_cerrar(uuid, uuid) to service_role;
grant execute on function public.nomina_anular(uuid, text, uuid) to service_role;

-- 9. RLS: deny-all para anon/authenticated (service_role bypassa RLS) ------------------------------------------
alter table public.nomina_trabajadores enable row level security;
alter table public.nomina_prestamos enable row level security;
alter table public.nomina_prestamo_movimientos enable row level security;
alter table public.nominas enable row level security;
alter table public.nomina_lineas enable row level security;
alter table public.nomina_linea_cuotas enable row level security;

revoke all on public.nomina_trabajadores from anon, authenticated;
revoke all on public.nomina_prestamos from anon, authenticated;
revoke all on public.nomina_prestamo_movimientos from anon, authenticated;
revoke all on public.nominas from anon, authenticated;
revoke all on public.nomina_lineas from anon, authenticated;
revoke all on public.nomina_linea_cuotas from anon, authenticated;
revoke all on sequence public.nomina_numero_seq from anon, authenticated;
revoke all on sequence public.nomina_prestamo_numero_seq from anon, authenticated;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'nomina_trabajadores', 'nomina_prestamos', 'nomina_prestamo_movimientos',
    'nominas', 'nomina_lineas', 'nomina_linea_cuotas'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_tabla and policyname = v_tabla || '_deny_anon'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
        v_tabla || '_deny_anon', v_tabla);
    end if;
  end loop;
end $$;

commit;

-- Que PostgREST vea de inmediato las tablas y funciones nuevas (sin esperar a su recarga automática).
notify pgrst, 'reload schema';
