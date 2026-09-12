-- Extraído de producción vía pg_get_functiondef, 11-sep-2026
-- Args: 

CREATE OR REPLACE FUNCTION public.asignar_correlativo_nota_ajuste()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.numero is null then
    if new.tipo = 'credito' then
      new.numero := nextval('public.notas_credito_numero_seq');
    elsif new.tipo = 'debito' then
      new.numero := nextval('public.notas_debito_numero_seq');
    end if;
  end if;
  return new;
end;
$function$
;
