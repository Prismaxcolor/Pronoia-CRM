-- =====================================================================
-- OBSOLETO - NO APLICAR.
-- =====================================================================
-- Estado real (verificado en produccion, solo lectura, 2026-10-03):
--   En produccion se aplico la ALTERNATIVA descrita mas abajo (marcar la nota
--   inversa como anulada en vez de borrarla). Estado actual en
--   notas_ajuste_cliente (cliente d425e8e2-62d7-475e-af93-703072c46e1f):
--     * NDV-0001 (98bffb27-f48d-4824-a0ec-72470956cd10)  debito  10.00  anulada=true
--     * NCV-0001 (dcfee369-89f7-4ea8-9fa7-24704b270262)  credito 10.00  anulada=true
--   Ambas notas estan anuladas, ninguna esta pagada/aplicada y no afectan el
--   saldo del cliente. NO se borro ninguna fila.
--
-- Este script (DELETE de NCV-0001) ya no corresponde: ademas de ser innecesario,
-- las guardas lo abortarian (la nota inversa ya tiene anulada=true) y borrar la
-- fila perderia el rastro que se decidio conservar. Por seguridad se agrego una
-- excepcion inmediata tras "begin" para que no pueda ejecutarse por error.
-- Se conserva el resto del contenido solo como registro del diagnostico y de la
-- alternativa aplicada.
-- =====================================================================
--
-- (Historico) Corrección de notas "inversas" creadas por el flujo anterior de anulación.
-- Antes decia: NO aplicar sin revisión. Aplicar DESPUÉS de docs/migration_anular_notas_sin_inversa.sql.
--
-- Diagnóstico (solo lectura, 2026-10-03): en producción hay 1 nota inversa errónea.
--   notas_ajuste_cliente (cliente d425e8e2-62d7-475e-af93-703072c46e1f):
--     * 98bffb27-f48d-4824-a0ec-72470956cd10  NDV-0001  débito  10.00  "AJUSTE"  2026-09-29  anulada=true
--     * dcfee369-89f7-4ea8-9fa7-24704b270262  NCV-0001  crédito 10.00  "ERROR"   2026-09-29  anulada=false
--       anula_nota_id = 98bffb27... (es la nota inversa creada al anular la ND; es la que sobra)
--   notas_ajuste_proveedor: ninguna (0 anuladas, 0 inversas).
-- Ninguna de las dos está pagada ni aplicada en pago_aplicaciones.
--
-- Corrección propuesta: eliminar la nota inversa NCV-0001 (nunca debió existir). La ND
-- NDV-0001 queda anulada (con el código nuevo ya no cuenta en el estado de cuenta).
-- Efecto en el saldo del cliente: con el código ANTERIOR la ND anulada seguía sumando (+10)
--   y la inversa restaba (-10) = 0. Con el código NUEVO la ND anulada vale 0, por lo que,
--   SI NO se corrige, la NC inversa restaría 10 al saldo del cliente. Por eso esta
--   corrección debe aplicarse junto con el despliegue.
-- El correlativo NCV-0001 queda sin uso (hueco); la secuencia no se reinicia.
--
-- Alternativa sin borrar (ESTA FUE LA APLICADA EN PRODUCCION): equivale a reemplazar el DELETE por
--   update public.notas_ajuste_cliente
--      set anulada = true, anulada_at = now(),
--          anulada_motivo = 'Nota inversa generada por el flujo anterior de anulación'
--    where id = 'dcfee369-89f7-4ea8-9fa7-24704b270262';
-- (queda visible como "Anulada" en el estado de cuenta, sin efecto en el saldo.)
--
-- ROLLBACK: reinsertar la fila con el INSERT del bloque comentado al final (completar
-- registrado_por y created_at con los valores originales, reportados abajo en el informe).

begin;
do $$
begin
  raise exception 'OBSOLETO: no aplicar (en produccion se aplico la alternativa: ambas notas estan anuladas).';
end $$;
-- Guardas: abortar si el estado no es el esperado.
do $$
declare v_ok int;
begin
  select count(*) into v_ok
    from public.notas_ajuste_cliente i
    join public.notas_ajuste_cliente o on o.id = i.anula_nota_id
   where i.id = 'dcfee369-89f7-4ea8-9fa7-24704b270262'
     and o.id = '98bffb27-f48d-4824-a0ec-72470956cd10'
     and i.pagada = false and o.pagada = false and o.anulada = true;
  if v_ok <> 1 then
    raise exception 'El estado de las notas ya no coincide con el diagnóstico; revisar antes de corregir.';
  end if;
  if exists (select 1 from public.pago_aplicaciones where item_id = 'dcfee369-89f7-4ea8-9fa7-24704b270262') then
    raise exception 'La nota inversa está aplicada en un cobro; no eliminar.';
  end if;
end $$;

delete from public.notas_ajuste_cliente
 where id = 'dcfee369-89f7-4ea8-9fa7-24704b270262'
   and anula_nota_id = '98bffb27-f48d-4824-a0ec-72470956cd10';

commit;

-- Rollback (reinsertar la fila eliminada):
-- insert into public.notas_ajuste_cliente
--   (id, cliente_id, tipo, monto, motivo, anulada, anula_nota_id, registrado_por, created_at, pagada, numero, factura_id, fecha)
-- values ('dcfee369-89f7-4ea8-9fa7-24704b270262', 'd425e8e2-62d7-475e-af93-703072c46e1f', 'credito', 10, 'ERROR', false,
--         '98bffb27-f48d-4824-a0ec-72470956cd10', '74eebbc5-547b-4efd-bdf7-fb198a7ebfa4', '2026-09-29 20:40:21.088749+00', false, 1,
--         '11aee1af-12ab-4a06-98dc-05c6e38bfaca', '2026-09-29');
