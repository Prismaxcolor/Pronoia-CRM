-- Telegram: interruptor para silenciar los avisos de movimientos de dinero por cuenta, cliente o proveedor.
--
-- telegram_reportes_activos = false => el sistema NO avisa por Telegram los movimientos de esa banca/caja
-- (grupo "P.S Cajas Pagos" o chat propio de la banca) ni, en proveedores y clientes, los pagos, cobros,
-- adelantos, anticipos, cruces y notas de crédito/débito (ni al grupo de cajas ni a su chat propio).
-- No silencia facturas ni envíos manuales (p. ej. "enviar estado de cuenta por Telegram").
-- Solo un superadmin lo cambia (lo exige el backend). Por defecto true: todo sigue avisando como hasta hoy.
-- Aditiva e idempotente. NO se aplica sola. El backend tolera que aún no existan las columnas (avisa como siempre).

alter table public.bancas
  add column if not exists telegram_reportes_activos boolean not null default true;

alter table public.proveedores
  add column if not exists telegram_reportes_activos boolean not null default true;

alter table public.clientes
  add column if not exists telegram_reportes_activos boolean not null default true;

comment on column public.bancas.telegram_reportes_activos is
  'false = no avisar por Telegram los movimientos de esta cuenta/caja.';
comment on column public.proveedores.telegram_reportes_activos is
  'false = no avisar por Telegram pagos, adelantos, cruces y notas de este proveedor.';
comment on column public.clientes.telegram_reportes_activos is
  'false = no avisar por Telegram cobros, anticipos, cruces y notas de este cliente.';
