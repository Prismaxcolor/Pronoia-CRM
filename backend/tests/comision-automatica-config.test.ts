import { describe, it, expect, vi, beforeEach } from 'vitest';

type Resp = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({ lectura: null as unknown, update: null as unknown, escrituras: [] as Array<Record<string, unknown>> }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(bd.lectura as Resp) }) }),
      update: (valores: Record<string, unknown>) => {
        bd.escrituras.push(valores);
        return { eq: () => Promise.resolve(bd.update as { error: { code?: string; message: string } | null }) };
      },
    }),
  },
}));

import { guardarReglaDeBanca } from '../src/services/comision-automatica-service.js';
import { comisionAutomaticaSchema } from '../src/schemas/cochinito.js';
import { ENTIDADES_AUDITABLES, RECURSO_POR_ENTIDAD } from '../src/utils/auditoria.js';
import {
  comisionCambio, comisionDeEjemplo, estadoInicialComision, leerNumero, validarComision,
} from '../../frontend/src/features/cochinito/comision-automatica-form.js';

beforeEach(() => {
  bd.lectura = { data: { id: 'b1', comision_auto_tasa: null, comision_auto_minimo: null }, error: null };
  bd.update = { error: null };
  bd.escrituras = [];
});

describe('comisionAutomaticaSchema', () => {
  it('acepta porcentaje y mínimo válidos', () => {
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 0.3, minimo: 14 }).success).toBe(true);
  });
  it('acepta solo porcentaje o solo mínimo', () => {
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 0.3, minimo: 0 }).success).toBe(true);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 0, minimo: 25 }).success).toBe(true);
  });
  it('activa con los dos en 0 se rechaza', () => {
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 0, minimo: 0 }).success).toBe(false);
    // Valores que al redondear (3 decimales de %, centavos) quedarían en 0 tampoco activan una regla vacía.
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 0.0004, minimo: 0.004 }).success).toBe(false);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 0.0004, minimo: 0.01 }).success).toBe(true);
  });
  it('desactivada acepta ceros', () => {
    expect(comisionAutomaticaSchema.safeParse({ activa: false, porcentaje: 0, minimo: 0 }).success).toBe(true);
  });
  it('rechaza negativos, porcentaje sobre el tope (10 %), mínimo excesivo y no numéricos', () => {
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: -1, minimo: 0 }).success).toBe(false);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 10.01, minimo: 0 }).success).toBe(false);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 10, minimo: 0 }).success).toBe(true);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 1, minimo: -5 }).success).toBe(false);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: 1, minimo: 2_000_000 }).success).toBe(false);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: '1', minimo: 0 }).success).toBe(false);
    expect(comisionAutomaticaSchema.safeParse({ activa: true, porcentaje: Infinity, minimo: 0 }).success).toBe(false);
  });
});

describe('guardarReglaDeBanca', () => {
  it('convierte el porcentaje a fracción (0.3 % -> 0.003) y guarda el mínimo a centavos', async () => {
    const r = await guardarReglaDeBanca('b1', { activa: true, porcentaje: 0.3, minimo: 14 });
    expect(bd.escrituras[0]).toEqual({ comision_auto_tasa: 0.003, comision_auto_minimo: 14 });
    expect(r).toEqual({ regla: { tasa: 0.003, minimo: 14 }, anterior: null });
  });
  it('sin errores de coma flotante (0.07 % -> 0.0007)', async () => {
    await guardarReglaDeBanca('b1', { activa: true, porcentaje: 0.07, minimo: 0 });
    expect(bd.escrituras[0].comision_auto_tasa).toBe(0.0007);
  });
  it('desactivar deja las dos columnas en null y devuelve la regla anterior', async () => {
    bd.lectura = { data: { id: 'b1', comision_auto_tasa: 0.003, comision_auto_minimo: 0 }, error: null };
    const r = await guardarReglaDeBanca('b1', { activa: false, porcentaje: 5, minimo: 5 });
    expect(bd.escrituras[0]).toEqual({ comision_auto_tasa: null, comision_auto_minimo: null });
    expect(r).toEqual({ regla: null, anterior: { tasa: 0.003, minimo: 0 } });
  });
  it('cuenta inexistente => noEncontrada, sin escribir', async () => {
    bd.lectura = { data: null, error: null };
    const r = await guardarReglaDeBanca('b1', { activa: true, porcentaje: 1, minimo: 0 });
    expect(r).toMatchObject({ noEncontrada: true });
    expect(bd.escrituras).toHaveLength(0);
  });
  it('migración sin aplicar al leer => pendiente (409), sin escribir', async () => {
    bd.lectura = { data: null, error: { code: '42703', message: 'column bancas.comision_auto_tasa does not exist' } };
    const r = await guardarReglaDeBanca('b1', { activa: true, porcentaje: 1, minimo: 0 });
    expect(r).toMatchObject({ pendiente: true });
    expect(bd.escrituras).toHaveLength(0);
  });
  it('migración sin aplicar al escribir => pendiente', async () => {
    bd.update = { error: { code: 'PGRST204', message: 'Could not find the comision_auto_tasa column of bancas' } };
    expect(await guardarReglaDeBanca('b1', { activa: true, porcentaje: 1, minimo: 0 })).toMatchObject({ pendiente: true });
  });
  it('otro error de BD (check) se devuelve como error sin pendiente', async () => {
    bd.update = { error: { code: '23514', message: 'violates check constraint' } };
    const r = await guardarReglaDeBanca('b1', { activa: true, porcentaje: 1, minimo: 0 });
    expect(r).toEqual({ error: 'Algún valor está fuera del rango permitido.' });
    expect(JSON.stringify(r)).not.toMatch(/constraint/);
  });
});

describe('auditoría de cambios de banca', () => {
  it('banca es entidad auditable y su historial lo ve quien ve cochinito', () => {
    expect(ENTIDADES_AUDITABLES).toContain('banca');
    expect(RECURSO_POR_ENTIDAD.banca).toBe('cochinito');
  });
});

describe('formulario de comisión automática (frontend)', () => {
  it('estado inicial: sin regla = desactivada y vacía; con regla = % y mínimo', () => {
    expect(estadoInicialComision({ comisionAuto: null })).toEqual({ activa: false, porcentaje: '', minimo: '' });
    expect(estadoInicialComision(undefined)).toEqual({ activa: false, porcentaje: '', minimo: '' });
    expect(estadoInicialComision({ comisionAuto: { tasa: 0.003, minimo: 14 } })).toEqual({ activa: true, porcentaje: '0.3', minimo: '14' });
    expect(estadoInicialComision({ comisionAuto: { tasa: 0, minimo: 25 } })).toEqual({ activa: true, porcentaje: '', minimo: '25' });
  });
  it('leerNumero acepta coma, vacío es 0 y rechaza texto', () => {
    expect(leerNumero('0,3')).toBe(0.3);
    expect(leerNumero(' ')).toBe(0);
    expect(Number.isNaN(leerNumero('abc'))).toBe(true);
    expect(Number.isNaN(leerNumero('-1'))).toBe(true);
    expect(Number.isNaN(leerNumero('1.2.3'))).toBe(true);
  });
  it('validarComision', () => {
    expect(validarComision({ activa: false, porcentaje: 'xx', minimo: '' })).toEqual({ ok: true, valor: { activa: false, porcentaje: 0, minimo: 0 } });
    expect(validarComision({ activa: true, porcentaje: '0,3', minimo: '14' })).toEqual({ ok: true, valor: { activa: true, porcentaje: 0.3, minimo: 14 } });
    expect(validarComision({ activa: true, porcentaje: '', minimo: '' }).ok).toBe(false);
    expect(validarComision({ activa: true, porcentaje: '11', minimo: '' }).ok).toBe(false);
    expect(validarComision({ activa: true, porcentaje: 'a', minimo: '' }).ok).toBe(false);
    expect(validarComision({ activa: true, porcentaje: '1', minimo: '2000000' }).ok).toBe(false);
  });
  it('comisionCambio detecta cambios reales', () => {
    const banca = { comisionAuto: { tasa: 0.003, minimo: 14 } };
    expect(comisionCambio({ activa: true, porcentaje: '0,3', minimo: '14' }, banca)).toBe(false);
    expect(comisionCambio({ activa: true, porcentaje: '0,4', minimo: '14' }, banca)).toBe(true);
    expect(comisionCambio({ activa: false, porcentaje: '', minimo: '' }, banca)).toBe(true);
    expect(comisionCambio({ activa: false, porcentaje: '', minimo: '' }, { comisionAuto: null })).toBe(false);
    expect(comisionCambio({ activa: true, porcentaje: '1', minimo: '' }, { comisionAuto: null })).toBe(true);
  });
  it('el ejemplo usa el mayor entre monto x % y el mínimo', () => {
    expect(comisionDeEjemplo(1000, { activa: true, porcentaje: 0.3, minimo: 0 })).toBe(3);
    expect(comisionDeEjemplo(1000, { activa: true, porcentaje: 0.3, minimo: 14 })).toBe(14);
    expect(comisionDeEjemplo(10000, { activa: true, porcentaje: 0.3, minimo: 14 })).toBe(30);
    expect(comisionDeEjemplo(1000, { activa: true, porcentaje: 0, minimo: 25 })).toBe(25);
  });
});
