-- ROLLBACK de docs/migration_idempotencia_pagos_cobros.sql
-- Quita solo los envoltorios y el auxiliar; las RPC originales de pago/cobro no se tocaron. El backend vuelve solo al flujo
-- anterior (RPC de dinero + pasos en el backend) porque detecta la función inexistente.
-- Después, si también se revierte migration_pagos_pasos_pendientes.sql, hacerlo DESPUÉS de este archivo.
begin;

drop function if exists public.registrar_cobro_cliente_multi_banca_completo(uuid, uuid, jsonb, numeric, text, text, date, uuid, jsonb, uuid, jsonb);
drop function if exists public.registrar_pago_proveedor_multi_banca_completo(uuid, uuid, jsonb, numeric, text, text, date, uuid, jsonb, uuid, jsonb, uuid[]);
drop function if exists public.registrar_pago_proveedor_completo(uuid, uuid, uuid, numeric, text, numeric, text, text, date, uuid, uuid, uuid, jsonb, boolean);
drop function if exists public.aplicar_pasos_pago(uuid[], uuid, uuid, uuid, jsonb, uuid[], uuid);

commit;
