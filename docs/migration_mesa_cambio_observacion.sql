-- Observación al completar (cobrar) una transferencia con mesa de cambio.
-- Aditiva e idempotente: una columna de texto libre en movimientos. Cada cobro (total o parcial) con
-- observación la agrega al final; los movimientos existentes quedan en null. Sin ella el sistema sigue igual.

alter table public.movimientos
  add column if not exists mesa_observacion text;

comment on column public.movimientos.mesa_observacion is
  'Observaciones escritas al cobrar la transferencia con mesa de cambio (una línea por cobro).';
