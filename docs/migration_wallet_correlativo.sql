-- Wallet: correlativo del sistema (movimientos.numero_sistema).
--
-- Cada movimiento MANUAL de Wallet (ingreso, egreso o transferencia creado desde la pantalla
-- de Wallet) recibe un correlativo propio (MV-0001, MV-0002, ...). Los movimientos que vienen
-- de un pago/cobro del estado de cuenta de un proveedor o cliente NO lo reciben: conservan su
-- numeración PG-/AD-/CB-/AC-, que vive en `numero`.
--
-- CRITERIO DE "MANUAL" (revisado contra las versiones vigentes en docs/*.sql):
--   manual  <=>  subtipo IS NULL AND grupo_id IS NULL
-- Es el mismo criterio que usa public._movimiento_manual_bloqueado (migration_editar_anular_transacciones.sql)
-- para decidir qué movimientos se pueden editar/anular de forma suelta. Verificación de los puntos que insertan en
-- movimientos (versiones vigentes, las más recientes de cada función):
--   * registrar_pago_proveedor (supabase-schema.sql, 3.ª versión): inserta con subtipo ('pago'|'adelanto') -> no se numera.
--   * registrar_pago_proveedor_multi_banca y registrar_cobro_cliente_multi_banca (migration_cruce_pagos_fixes.sql):
--     insertan con subtipo Y grupo_id (pago/adelanto/cobro/anticipo) -> no se numera.
--   * editar_pago_cobro_contable (migration_editar_anular_transacciones.sql) reconstruye las filas con subtipo y grupo_id.
--   * registrar_pago_proveedor_multiple (Bloque 37) inserta SIN subtipo, pero el backend ya no la llama (usa
--     multi_banca) y los históricos de egreso+proveedor se migraron a subtipo 'pago' en supabase-schema.sql.
--     Conviene eliminarla (ver la nota de despliegue de supabase-schema.sql) para que nadie la reactive.
--   * crearMovimiento del backend (insert directo): sin subtipo ni grupo_id -> ES manual y SÍ se numera, incluso
--     si el usuario le asocia un proveedor o cliente desde el formulario de Wallet. DECISIÓN: ese movimiento no es
--     un pago/cobro del estado de cuenta (no tiene PG-/CB-, ni grupo, ni aplica a facturas), es un registro manual
--     de Wallet; si no se numerara quedaría sin ningún identificador.
--
-- ANULADOS: el backfill SÍ numera los anulados. Un movimiento anulado conserva su fila y sigue
-- apareciendo en Wallet (tachado); sin número quedaría sin identificador y se perdería la
-- trazabilidad. Los nuevos movimientos reciben número al insertarse, anulados o no después.
--
-- Mismo patrón que movimientos.numero: secuencia nativa + trigger BEFORE INSERT (así los puntos
-- de creación actuales -insert directo del backend- no cambian). El trigger es distinto del de
-- `asignar_correlativo_movimiento` para no tocar esa función. Respeta un valor ya provisto.
--
-- Aditiva e idempotente. Los manuales existentes se numeran por orden de creación.
-- Todo corre en UNA transacción con la tabla bloqueada contra escrituras concurrentes: ningún insert
-- puede colarse entre el backfill y la creación del trigger (quedaría sin número).
-- NO se aplica sola: ejecutar en Supabase SQL Editor con backup previo.
-- El backend tolera que esta migración aún no esté aplicada (el correlativo sale vacío).

begin;

-- Bloquea inserts/updates concurrentes hasta el commit (permite lecturas).
lock table public.movimientos in share row exclusive mode;

alter table public.movimientos
  add column if not exists numero_sistema bigint;

create sequence if not exists public.movimientos_wallet_numero_seq;

-- Backfill: solo movimientos manuales (sin subtipo y sin grupo), por orden de creación.
-- Si se vuelve a ejecutar, continúa después del mayor número ya asignado (no repite).
update public.movimientos m
set numero_sistema = o.rn + o.base
from (
  select id,
         row_number() over (order by creado_en, id) as rn,
         coalesce((select max(numero_sistema) from public.movimientos), 0) as base
  from public.movimientos
  where subtipo is null and grupo_id is null and numero_sistema is null
) o
where m.id = o.id;

select setval(
  'public.movimientos_wallet_numero_seq',
  coalesce((select max(numero_sistema) from public.movimientos), 0) + 1,
  false
);

create unique index if not exists idx_movimientos_numero_sistema
  on public.movimientos (numero_sistema)
  where numero_sistema is not null;

create or replace function public.asignar_numero_sistema_movimiento()
returns trigger
language plpgsql
as $$
begin
  if new.numero_sistema is null and new.subtipo is null and new.grupo_id is null then
    new.numero_sistema := nextval('public.movimientos_wallet_numero_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_asignar_numero_sistema_movimiento on public.movimientos;

create trigger trg_asignar_numero_sistema_movimiento
before insert on public.movimientos
for each row
execute function public.asignar_numero_sistema_movimiento();

commit;

-- Nota: las RPC de pago/cobro insertan con subtipo/grupo_id ya definidos en el mismo INSERT, por
-- eso el trigger (BEFORE INSERT) los distingue. Si alguna RPC futura insertara un movimiento de
-- pago sin subtipo, recibiría un número de sistema: mantener subtipo en el INSERT.

-- Verificación (ejecutar después, a mano):
-- select
--   count(*) filter (where numero_sistema is not null)                              as con_numero,
--   count(*) filter (where numero_sistema is null and subtipo is null and grupo_id is null) as manuales_sin_numero, -- debe ser 0
--   count(*) filter (where numero_sistema is not null and (subtipo is not null or grupo_id is not null)) as pagos_numerados, -- debe ser 0
--   count(numero_sistema) - count(distinct numero_sistema)                           as repetidos,        -- debe ser 0
--   min(numero_sistema) as minimo, max(numero_sistema) as maximo,
--   (select last_value from public.movimientos_wallet_numero_seq)                    as secuencia
-- from public.movimientos;
