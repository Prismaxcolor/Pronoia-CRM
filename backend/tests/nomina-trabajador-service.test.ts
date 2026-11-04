import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  insertado: null as Fila | null,
  actualizado: null as Fila | null,
  resultado: { data: null as Fila | null, error: null as null | { code?: string; message: string } },
}));

vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c;
      c.insert = (v: Fila) => { bd.insertado = v; return c; };
      c.update = (v: Fila) => { bd.actualizado = v; return c; };
      c.single = () => Promise.resolve(bd.resultado);
      c.maybeSingle = () => Promise.resolve(bd.resultado);
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: bd.resultado.data ? [bd.resultado.data] : [], error: bd.resultado.error }).then(ok);
      return c;
    },
  },
}));

import { aColumnas, actualizarTrabajador, crearTrabajador, desactivarTrabajador, listarTrabajadores } from '../src/services/nomina-trabajador-service';

const fila: Fila = {
  id: 't1', tipo: 'OPERATIVO', nombres: 'Ana', apellidos: 'Pérez', cedula: 'V-1', rif: null, telefono: '', direccion: null, puesto: 'Operador',
  contacto_emergencia_nombre: 'Luis', contacto_emergencia_telefono: null, pago_movil_banco: 'Banesco', pago_movil_telefono: '0414',
  pago_movil_cedula: 'V-1', binance_correo_id: null, pago_diario_usd: '15.50', activo: true, created_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  bd.insertado = null;
  bd.actualizado = null;
  bd.resultado = { data: fila, error: null };
});

describe('aColumnas', () => {
  it('los dos sueldos van a sus columnas', () => {
    expect(aColumnas({ pagoDiarioUsd: 12.5, pagoDiarioBs: 350 })).toEqual({ pago_diario_usd: 12.5, pago_diario_bs: 350 });
  });

  it('traduce a columnas, omite undefined y descarta claves ajenas', () => {
    const c = aColumnas({ nombres: 'Ana', direccion: undefined, rif: null, pagoMovilBanco: 'X', id: 'otro', created_at: 'hack' });
    expect(c).toEqual({ nombres: 'Ana', rif: null, pago_movil_banco: 'X' });
  });
});

describe('trabajadores', () => {
  it('crear devuelve la ficha mapeada (vacíos a null, pago diario numérico)', async () => {
    const r = await crearTrabajador({ tipo: 'OPERATIVO', nombres: 'Ana', apellidos: 'Pérez', cedula: 'V-1', pagoDiarioUsd: 15.5 } as never);
    if ('error' in r) throw new Error(r.error);
    expect(r.trabajador).toMatchObject({ id: 't1', telefono: null, pagoDiarioUsd: 15.5, pagoMovilBanco: 'Banesco', activo: true });
    expect(bd.insertado).toMatchObject({ pago_diario_usd: 15.5 });
  });

  it('cédula repetida: 409 con texto propio, sin citar la cédula', async () => {
    bd.resultado = { data: null, error: { code: '23505', message: 'Key (upper(btrim(cedula)))=(V-1) already exists.' } };
    const r = await crearTrabajador({ tipo: 'OPERATIVO', nombres: 'A', apellidos: 'B', cedula: 'V-1', pagoDiarioUsd: 0 } as never);
    expect(r).toEqual({ error: 'Ya existe un trabajador con esa cédula.', codigo: 409 });
  });

  it('sin migrar: 503 al listar y al crear', async () => {
    bd.resultado = { data: null, error: { code: '42P01', message: 'relation "nomina_trabajadores" does not exist' } };
    expect(await listarTrabajadores({ incluirInactivos: false })).toMatchObject({ codigo: 503 });
    expect(await crearTrabajador({ tipo: 'OPERATIVO', nombres: 'A', apellidos: 'B', cedula: 'V-1', pagoDiarioUsd: 0 } as never)).toMatchObject({ codigo: 503 });
  });

  it('cambiar el tipo de un trabajador que ya tiene nóminas: la BD lo rechaza y llega el mensaje claro (409)', async () => {
    const mensaje = 'No se puede cambiar el tipo de personal de un trabajador que ya aparece en alguna nómina: desactívalo y registra otro.';
    bd.resultado = { data: null, error: { code: 'P0001', message: mensaje } };
    expect(await actualizarTrabajador('t1', { tipo: 'ADMINISTRATIVO' })).toEqual({ error: mensaje, codigo: 409 });
  });

  it('actualizar inexistente: 404', async () => {
    bd.resultado = { data: null, error: null };
    expect(await actualizarTrabajador('t9', { nombres: 'X' })).toMatchObject({ codigo: 404 });
  });

  it('desactivar es soft-delete: solo pone activo=false', async () => {
    bd.resultado = { data: { id: 't1' }, error: null };
    expect(await desactivarTrabajador('t1')).toEqual({ ok: true });
    expect(bd.actualizado).toMatchObject({ activo: false });
    expect(Object.keys(bd.actualizado ?? {}).sort()).toEqual(['activo', 'updated_at']);
  });
});
