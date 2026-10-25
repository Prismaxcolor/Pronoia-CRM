-- =============================================================================
-- Nómina: el «sueldo en Bs» pasa a ser un valor en USD DE REFERENCIA (se paga en bolívares a la tasa del día).
-- Diseño: docs/DISENO_nomina.md (sección «Fase 4»).
--
-- QUÉ CAMBIA EN EL SIGNIFICADO DE LOS DATOS
--   Antes (fase 3): «sueldo en Bs = 8» eran 8 BOLÍVARES por día.
--   Ahora:          «sueldo en Bs = 8» son 8 DÓLARES de referencia por día; al pagar se convierten a bolívares con la tasa de
--                   la nómina (la del día, Binance del mediodía de Caracas). A tasa 40 son 320 Bs por día.
--   Las columnas NO se renombran (nomina_trabajadores.pago_diario_bs, nomina_lineas.monto_base_bs): solo cambia su lectura.
--   nomina_lineas.bruto_bs, pagar_bs y total_bs siguen siendo bolívares reales; pagar_usd y total_usd siguen siendo USD.
--
-- QUÉ HACE ESTA MIGRACIÓN (ningún monto se modifica)
--   * nomina_lineas.sueldo_bs_en_usd (boolean, por defecto TRUE): TRUE = el monto_base_bs del renglón es USD de referencia
--     (formato nuevo, el que escribe el backend nuevo sin tocar la columna); FALSE = formato anterior (Bs).
--     Se marcan FALSE TODOS los renglones que tienen monto_base_bs > 0 (cerrados, anulados y borradores), porque esos montos se
--     calcularon cuando el número eran bolívares (los borradores los dejó así la migración de los dos sueldos). Así la pantalla
--     (y el PDF) los siguen mostrando bien: el backend los convierte a USD de referencia con la tasa de esa nómina SOLO para
--     mostrarlos; sus totales guardados no cambian. Al guardar de nuevo un borrador sus renglones se reescriben con el formato nuevo.
--   * nomina_trabajadores.pago_diario_bs NO se toca. Cualquier trabajador con un valor mayor que 0 pasa a leerse como USD de
--     referencia: revisa la consulta de verificación y corrige a mano el sueldo de quien corresponda desde la ficha.
--     (No se convierte automáticamente porque no hay una tasa «de la ficha» que lo haga sin adivinar.)
--
-- Requisitos aplicados: migration_nomina_dos_sueldos_cargo.sql.
-- Migración aditiva e idempotente; no se aplica desde el código.
-- ROLLBACK: docs/migration_nomina_sueldo_bs_referencia_usd_ROLLBACK.sql
-- CÓMO APLICAR: Supabase Studio -> SQL Editor, con backup previo. Orden de despliegue: esta migración PRIMERO, luego el código.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'nomina_lineas' and column_name = 'monto_base_bs') then
    raise exception 'Falta aplicar migration_nomina_dos_sueldos_cargo.sql.';
  end if;
end $$;

-- Solo la primera vez: marca como «formato anterior» los renglones ya cerrados o anulados con sueldo en Bs.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'nomina_lineas' and column_name = 'sueldo_bs_en_usd') then
    alter table public.nomina_lineas add column sueldo_bs_en_usd boolean not null default true;

    -- Los renglones de una nómina no borrador están protegidos: se desactiva el trigger solo para marcar la columna nueva
    -- (misma transacción, bajo el bloqueo de la tabla; ningún monto cambia).
    alter table public.nomina_lineas disable trigger trg_nomina_lineas_proteger;
    update public.nomina_lineas l
       set sueldo_bs_en_usd = false
      from public.nominas n
     where n.id = l.nomina_id and l.monto_base_bs > 0;
    alter table public.nomina_lineas enable trigger trg_nomina_lineas_proteger;
  end if;
end $$;

comment on column public.nomina_trabajadores.pago_diario_bs is
  'Sueldo diario «en Bs»: valor en USD de REFERENCIA que se paga en bolívares a la tasa del día (desde migration_nomina_sueldo_bs_referencia_usd.sql).';
comment on column public.nomina_lineas.monto_base_bs is
  'Sueldo diario «en Bs» del renglón: USD de referencia si sueldo_bs_en_usd, bolívares si es del formato anterior.';
comment on column public.nomina_lineas.sueldo_bs_en_usd is
  'TRUE = monto_base_bs son USD de referencia (formato vigente); FALSE = eran bolívares (renglones cerrados antes de este cambio).';

commit;

-- Que PostgREST vea de inmediato la columna nueva (sin esperar a su recarga automática).
notify pgrst, 'reload schema';

-- Verificación a mano (solo lectura, después de aplicar):
--   -- trabajadores con sueldo «en Bs»: ahora se leen como USD de referencia por día; corrige los que estén en bolívares:
--   select id, tipo, pago_diario_usd, pago_diario_bs from public.nomina_trabajadores where pago_diario_bs > 0 and activo;
--   -- renglones marcados como formato anterior (con sueldo en Bs guardado en bolívares):
--   select n.numero, n.estado, count(*) from public.nomina_lineas l join public.nominas n on n.id = l.nomina_id
--    where not l.sueldo_bs_en_usd group by 1, 2;
