import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});

import { pagarNominaSchema } from '../src/schemas/nomina.js';
import { crearCategoriaSchema } from '../src/schemas/categorias-wallet.js';
import { hoyNegocio } from '../src/utils/fecha-negocio.js';

const CUENTA = '11111111-1111-4111-8111-111111111111';
const cuerpo = (fecha: string) => ({ fecha, bancas: [{ moneda: 'USD', bancaId: CUENTA }] });

function sumarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

describe('L1: tope superior de la fecha del pago de nómina', () => {
  it('acepta hoy y mañana (holgura por desfase de reloj)', () => {
    const hoy = hoyNegocio();
    expect(pagarNominaSchema.safeParse(cuerpo(hoy)).success).toBe(true);
    expect(pagarNominaSchema.safeParse(cuerpo(sumarDias(hoy, 1))).success).toBe(true);
  });

  it('rechaza una fecha posterior a mañana', () => {
    expect(pagarNominaSchema.safeParse(cuerpo(sumarDias(hoyNegocio(), 2))).success).toBe(false);
    expect(pagarNominaSchema.safeParse(cuerpo('2999-01-01')).success).toBe(false);
  });
});

describe('L2: la extensión de la imagen de categoría escapa el punto', () => {
  const base = 'https://p.supabase.test/storage/v1/object/public/categorias/';
  it('rechaza un nombre que termina en jpg sin punto', () => {
    expect(crearCategoriaSchema.safeParse({ nombre: 'A', tipo: 'EGRESO', imagenUrl: `${base}abc-jpg` }).success).toBe(false);
  });
  it('acepta la extensión con punto', () => {
    expect(crearCategoriaSchema.safeParse({ nombre: 'A', tipo: 'EGRESO', imagenUrl: `${base}abc.jpg` }).success).toBe(true);
  });
});

describe('L3 y L1 en SQL', () => {
  const sql = (f: string) => readFileSync(resolve(__dirname, '../../docs', f), 'utf8');

  it('el bucket categorias fija tamaño y tipos y se actualiza si ya existe', () => {
    const s = sql('migration_categorias_imagen.sql');
    expect(s).toMatch(/file_size_limit/);
    expect(s).toContain('6291456');
    expect(s).toMatch(/allowed_mime_types/);
    for (const m of ['image/jpeg', 'image/png', 'image/webp']) expect(s).toContain(m);
    expect(s).toMatch(/on conflict \(id\) do update/i);
  });

  it('la función de pago de nómina rechaza fechas futuras', () => {
    expect(sql('migration_nomina_pago_wallet.sql')).toMatch(/v_fecha > .*America\/Caracas.*\+ 1/);
  });
});
