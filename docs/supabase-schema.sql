-- ============================================================================
-- Pronoia · esquema incremental para Supabase
--
-- Este archivo recoge SOLO las piezas que vamos agregando explícitamente.
-- Las tablas base (users, productos, bancas, movimientos, facturas,
-- factura_items) y las RPCs de auth (verify_login, create_user) ya existen
-- en Supabase y no están versionadas aquí todavía.
--
-- Cómo aplicar: pegar este script en Supabase Studio → SQL Editor → Run.
-- Es idempotente: usa CREATE IF NOT EXISTS / OR REPLACE.
-- ============================================================================


-- ============================================================================
-- Bloque 1 · tasas_cambio
-- Histórico de tasas de cambio. Lo usa el backend Express
-- (GET /api/tasas/oficial) para cachear la tasa BCV por 24 h.
-- ============================================================================

create table if not exists public.tasas_cambio (
  id            uuid        primary key default gen_random_uuid(),
  moneda_origen text        not null,
  moneda_destino text       not null,
  tasa          numeric(20, 6) not null check (tasa > 0),
  fuente        text        not null default 'BCV',
  fecha         timestamptz not null default now()
);

create index if not exists idx_tasas_cambio_fecha
  on public.tasas_cambio (moneda_origen, moneda_destino, fecha desc);


-- ============================================================================
-- Bloque 2 · trigger de saldo en bancas
-- Cuando se inserta un movimiento, ajusta automáticamente bancas.saldo.
-- Regla de dominio (CLAUDE.md): los saldos NUNCA se editan a mano,
-- se derivan de movimientos.
--
-- Reglas por tipo:
--   ingreso        → banca_origen_id  +=  monto
--   egreso         → banca_origen_id  -=  monto
--   transferencia  → banca_origen_id  -=  monto
--                    banca_destino_id +=  monto
--
-- Nota fase B: la transferencia entre monedas distintas (Bs↔USD)
-- requerirá conversión vía tasa de cambio. De momento asume misma moneda.
-- ============================================================================

create or replace function public.aplicar_movimiento_a_saldo()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'ingreso' then
    update public.bancas
       set saldo = saldo + new.monto
     where id = new.banca_origen_id;

  elsif new.tipo = 'egreso' then
    update public.bancas
       set saldo = saldo - new.monto
     where id = new.banca_origen_id;

  elsif new.tipo = 'transferencia' then
    update public.bancas
       set saldo = saldo - new.monto
     where id = new.banca_origen_id;

    update public.bancas
       set saldo = saldo + new.monto
     where id = new.banca_destino_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aplicar_movimiento on public.movimientos;

create trigger trg_aplicar_movimiento
after insert on public.movimientos
for each row
execute function public.aplicar_movimiento_a_saldo();


-- ============================================================================
-- Bloque 3 · función de reconciliación (opcional pero útil)
-- Recalcula desde cero el saldo de una banca a partir del histórico.
-- Úsala si los saldos quedan desincronizados (drift) o tras correcciones.
--
-- Ejemplo:  select public.reconciliar_saldo_banca('uuid-de-la-banca');
-- ============================================================================

create or replace function public.reconciliar_saldo_banca(p_banca_id uuid)
returns numeric
language plpgsql
as $$
declare
  v_saldo numeric := 0;
begin
  select coalesce(sum(case
           when tipo = 'ingreso'       and banca_origen_id  = p_banca_id then  monto
           when tipo = 'egreso'        and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_origen_id  = p_banca_id then -monto
           when tipo = 'transferencia' and banca_destino_id = p_banca_id then  monto
           else 0
         end), 0)
    into v_saldo
    from public.movimientos;

  update public.bancas set saldo = v_saldo where id = p_banca_id;
  return v_saldo;
end;
$$;


-- ============================================================================
-- Bloque 4 · RLS abierto en bancas/movimientos + tipo de banca
--
-- Contexto: el frontend usa la anon key (auth custom no integrado con Supabase
-- Auth), así que RLS basado en auth.uid() no aplica. Para que el frontend pueda
-- leer/escribir, se deshabilita RLS en estas tablas (consistente con productos
-- y users, que tienen RLS off o policy abierta).
--
-- Deuda técnica: cualquier app con la anon key puede leer/escribir estas tablas.
-- Para cerrarlo bien, hay que routear todo por backend Express (service_role)
-- o migrar auth a Supabase Auth.
-- ============================================================================

alter table public.bancas      disable row level security;
alter table public.movimientos disable row level security;

-- Tipo de banca (clasifica para iconos/agrupación en UI)
alter table public.bancas
  add column if not exists tipo text not null default 'banco_nacional';

alter table public.bancas drop constraint if exists bancas_tipo_check;
alter table public.bancas
  add constraint bancas_tipo_check
  check (tipo in ('banco_nacional', 'banco_internacional', 'exchange', 'efectivo'));
