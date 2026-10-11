import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizarCedula } from '../src/utils/nomina-cedula.js';

/**
 * Las migraciones no se pueden ejecutar en las pruebas (no hay Postgres): estas pruebas de contrato fijan que las reglas
 * de seguridad y de negocio acordadas siguen escritas en el SQL.
 */
const sql = (nombre: string): string =>
  readFileSync(fileURLToPath(new URL(`../../docs/${nombre}`, import.meta.url)), 'utf-8');

/** Cuerpo de una función SQL: desde su `create or replace function` hasta el siguiente `$function$;`. */
function funcion(texto: string, nombre: string): string {
  const inicio = texto.indexOf(`create or replace function public.${nombre}(`);
  expect(inicio, `función ${nombre}`).toBeGreaterThan(-1);
  const fin = texto.indexOf('$function$;', texto.indexOf('as $function$', inicio) + 10);
  return texto.slice(inicio, fin);
}

describe('migration_nomina.sql', () => {
  const nomina = sql('migration_nomina.sql');

  it('el índice único de cédula usa la misma normalización que el backend', () => {
    expect(nomina).toMatch(/idx_nomina_trabajadores_cedula\s+on public\.nomina_trabajadores \(\(upper\(regexp_replace\(cedula, '\[\^A-Za-z0-9\]', '', 'g'\)\)\)\)/);
    expect(normalizarCedula('V-12.345.678')).toBe(normalizarCedula('v 12345678'));
  });

  it('nomina_cerrar no cierra con renglones de total negativo, con un mensaje claro', () => {
    const cerrar = funcion(nomina, 'nomina_cerrar');
    expect(cerrar).toMatch(/total_usd < 0/);
    expect(cerrar).toMatch(/No se puede cerrar la nómina: hay trabajadores con un total a pagar negativo/);
    // la comprobación va antes de tocar saldos de préstamos
    expect(cerrar.indexOf('total_usd < 0')).toBeLessThan(cerrar.indexOf("set_config('nomina.ledger'"));
  });

  it('nomina_guardar rechaza trabajadores inactivos y descuentos de préstamo mayores a lo ganado', () => {
    const guardar = funcion(nomina, 'nomina_guardar');
    expect(guardar).toMatch(/t\.activo\)/);
    expect(guardar).toMatch(/Un trabajador está inactivo/);
    expect(guardar).toMatch(/descuentoPrestamoUsd'\)::numeric > .*totalBrutoUsd'\)::numeric \+ .*bonificacionUsd'\)::numeric/);
  });

  it('nomina_lineas refuerza el tope del préstamo con un CHECK', () => {
    expect(nomina).toMatch(/check \(descuento_prestamo_usd <= total_bruto_usd \+ bonificacion_usd\)/);
  });

  it('bloquea cambiar el tipo de un trabajador que ya tiene nóminas', () => {
    expect(funcion(nomina, 'nomina_trabajadores_proteger')).toMatch(/new\.tipo is distinct from old\.tipo[\s\S]*nomina_lineas/);
    expect(nomina).toMatch(/create trigger trg_nomina_trabajadores_proteger/);
  });

  it('termina recargando el esquema de PostgREST', () => {
    expect(nomina.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('migraciones de packing list', () => {
  it.each(['migration_packing_list_cliente_resultados.sql', 'migration_packing_list_lote_fotos.sql'])(
    '%s termina recargando el esquema de PostgREST y fija el search_path de guardar_packing_list',
    nombre => {
      const texto = sql(nombre);
      expect(texto.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
      expect(texto).toMatch(/set search_path = public, pg_temp/);
      expect(texto).not.toMatch(/set search_path = public\s*$/m);
    }
  );

  it('la preservación de fotos/almacén empareja por numero_paleta + lote cuando hay número de paleta', () => {
    const f = funcion(sql('migration_packing_list_lote_fotos.sql'), 'guardar_packing_list');
    expect(f).toMatch(/'numero_paleta', numero_paleta/);
    expect(f).toMatch(/\(p\.prev->>'numero_paleta'\) = \(e\.item->>'numero_paleta'\)/);
    expect(f).toMatch(/coalesce\(p\.prev->>'lote', ''\) = coalesce\(nullif\(btrim\(e\.item->>'lote'\), ''\), ''\)/);
  });

  it('el bucket packing-fotos es privado y limita tamaño y tipos', () => {
    const texto = sql('migration_packing_list_lote_fotos.sql');
    expect(texto).toMatch(/'packing-fotos', 'packing-fotos', false, 6291456, array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  });
});
