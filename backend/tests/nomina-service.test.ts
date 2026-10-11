import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  trabajadores: [] as Fila[],
  prestamos: [] as Fila[],
  nomina: null as Fila | null,
  errorTabla: null as { tabla: string; error: { code?: string; message: string } } | null,
  rpcResultado: { data: null as unknown, error: null as null | { code?: string; message: string } },
  rpc: vi.fn(),
  logs: [] as unknown[],
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: (p: unknown) => bd.logs.push(p), warn: (p: unknown) => bd.logs.push(p), error: (p: unknown) => bd.logs.push(p) },
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      let ids: string[] | null = null;
      const resultado = () => {
        if (bd.errorTabla?.tabla === tabla) return { data: null, error: bd.errorTabla.error };
        const filas = tabla === 'nomina_trabajadores' ? bd.trabajadores : tabla === 'nomina_prestamos' ? bd.prestamos : [];
        return { data: ids ? filas.filter(f => ids!.includes(f.id as string)) : filas, error: null };
      };
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'order', 'limit']) c[m] = () => c;
      c.in = (_col: string, valores: string[]) => { ids = valores; return c; };
      c.maybeSingle = () => Promise.resolve(tabla === 'nominas' ? { data: bd.nomina, error: null } : { data: null, error: null });
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
      return c;
    },
    rpc: (nombre: string, args: unknown) => {
      bd.rpc(nombre, args);
      return Promise.resolve(bd.rpcResultado);
    },
  },
}));

import { MENSAJE_CIERRE_CON_NEGATIVOS, anularNomina, cerrarNomina, guardarNomina } from '../src/services/nomina-escritura-service';
import { guardarNominaSchema } from '../src/schemas/nomina';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const NOMINA = '44444444-4444-4444-8444-444444444444';
const USUARIO = '55555555-5555-4555-8555-555555555555';

const entrada = (lineas: unknown[], extra: Record<string, unknown> = {}) =>
  guardarNominaSchema.parse({ tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs: 40, version: null, lineas, ...extra });

const renglon = (extra: Record<string, unknown> = {}) =>
  ({ trabajadorId: T1, monedaPago: 'USD', diasTrabajados: 5, montoBaseUsd: 20, ...extra });

const nominaGuardada = {
  id: NOMINA, numero: 7, tipo: 'OPERATIVO', semana_inicio: '2026-10-05', tasa_bs: 40, estado: 'BORRADOR', version: 2,
  cantidad_divisas: 1, cantidad_bs: 0, total_divisas_usd: 100, total_bs: 0, total_equivalente_usd: 0, total_combinado_usd: 100, total_combinado_bs: 4000,
  lineas: [],
};

beforeEach(() => {
  bd.trabajadores = [
    { id: T1, tipo: 'OPERATIVO', nombres: 'Ana', apellidos: 'Pérez', activo: true },
    { id: T2, tipo: 'ADMINISTRATIVO', nombres: 'Luis', apellidos: 'Gómez', activo: true },
  ];
  bd.prestamos = [{ id: P1, trabajador_id: T1, saldo_usd: 30, estado: 'ACTIVO' }];
  bd.nomina = nominaGuardada;
  bd.errorTabla = null;
  bd.rpcResultado = { data: NOMINA, error: null };
  bd.rpc.mockClear();
  bd.logs = [];
});

describe('guardarNomina', () => {
  it('guarda con los totales calculados en el servidor y devuelve la nómina', async () => {
    const r = await guardarNomina(entrada([renglon()]), USUARIO);
    if ('error' in r) throw new Error(r.error);
    expect(r.nomina).toMatchObject({ id: NOMINA, numero: 7, estado: 'BORRADOR', version: 2 });
    expect(bd.rpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = bd.rpc.mock.calls[0];
    expect(nombre).toBe('nomina_guardar');
    expect(args.p_usuario).toBe(USUARIO);
    expect(args.p_datos.totales.totalDivisasUsd).toBe(100);
    expect(args.p_datos.lineas[0]).toMatchObject({ trabajadorNombre: 'Ana Pérez', totalUsd: 100, totalBs: 4000 });
  });

  it('rechaza un trabajador inexistente sin llamar a la BD de escritura', async () => {
    const r = await guardarNomina(entrada([renglon({ trabajadorId: '99999999-9999-4999-8999-999999999999' })]), USUARIO);
    expect(r).toMatchObject({ codigo: 400 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('rechaza un trabajador de otro tipo de personal', async () => {
    const r = await guardarNomina(entrada([renglon({ trabajadorId: T2 })]), USUARIO);
    expect(r).toMatchObject({ codigo: 400 });
    expect('error' in r && r.error).toMatch(/tipo/i);
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('rechaza una cuota mayor al saldo del préstamo', async () => {
    const r = await guardarNomina(entrada([renglon({ cuotas: [{ prestamoId: P1, montoUsd: 30.01 }] })]), USUARIO);
    expect(r).toMatchObject({ codigo: 409 });
    expect('error' in r && r.error).toMatch(/saldo/i);
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('acepta una cuota dentro del saldo y la descuenta del total', async () => {
    const r = await guardarNomina(entrada([renglon({ cuotas: [{ prestamoId: P1, montoUsd: 30 }] })]), USUARIO);
    expect('error' in r).toBe(false);
    expect(bd.rpc.mock.calls[0][1].p_datos.lineas[0]).toMatchObject({ descuentoPrestamoUsd: 30, totalUsd: 70 });
  });

  it('total negativo sin confirmar: 422 con los renglones afectados y sin guardar', async () => {
    const input = entrada([renglon({ diasTrabajados: 1, descuentoTrabajoUsd: 50 })]);
    const r = await guardarNomina(input, USUARIO);
    expect(r).toMatchObject({ codigo: 422, extra: { lineasNegativas: [0] } });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('total negativo confirmado explícitamente: se guarda', async () => {
    const input = entrada([renglon({ diasTrabajados: 1, descuentoTrabajoUsd: 50 })], { confirmarNegativos: true });
    const r = await guardarNomina(input, USUARIO);
    expect('error' in r).toBe(false);
    expect(bd.rpc).toHaveBeenCalledTimes(1);
  });

  it('rechaza un trabajador inactivo', async () => {
    bd.trabajadores = bd.trabajadores.map(t => (t.id === T1 ? { ...t, activo: false } : t));
    const r = await guardarNomina(entrada([renglon()]), USUARIO);
    expect(r).toMatchObject({ codigo: 400 });
    expect('error' in r && r.error).toMatch(/inactivo/i);
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('el mensaje de confirmar negativos aclara que solo se guarda como borrador', async () => {
    const r = await guardarNomina(entrada([renglon({ diasTrabajados: 1, descuentoTrabajoUsd: 50 })]), USUARIO);
    expect('error' in r && r.error).toMatch(/borrador/i);
    expect('error' in r && r.error).toMatch(/no se puede cerrar/i);
  });

  it('tablas sin migrar: 503 con el mensaje de migración pendiente', async () => {
    bd.errorTabla = { tabla: 'nomina_trabajadores', error: { code: '42P01', message: 'relation "nomina_trabajadores" does not exist' } };
    const r = await guardarNomina(entrada([renglon()]), USUARIO);
    expect(r).toMatchObject({ codigo: 503 });
    expect('error' in r && r.error).toMatch(/migration_nomina\.sql/);
  });

  it('función SQL sin migrar: 503', async () => {
    bd.rpcResultado = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomina_guardar' } };
    expect(await guardarNomina(entrada([renglon()]), USUARIO)).toMatchObject({ codigo: 503 });
  });

  it('conflicto de versión (error de negocio de la BD): 409 con su mensaje', async () => {
    bd.rpcResultado = { data: null, error: { code: 'P0001', message: 'Otra persona modificó esta nómina: recarga la pantalla.' } };
    expect(await guardarNomina(entrada([renglon()]), USUARIO)).toEqual({ error: 'Otra persona modificó esta nómina: recarga la pantalla.', codigo: 409 });
  });

  it('un error inesperado de BD da 500 genérico y no filtra datos personales ni al cliente ni al log', async () => {
    bd.rpcResultado = { data: null, error: { code: '23505', message: 'Key (cedula)=(V-12345678) already exists' } };
    const r = await guardarNomina(entrada([renglon()]), USUARIO);
    expect(JSON.stringify(r)).not.toContain('V-12345678');
    bd.rpcResultado = { data: null, error: { code: 'XX000', message: 'detalle con V-12345678 y Ana Pérez' } };
    const r2 = await guardarNomina(entrada([renglon()]), USUARIO);
    expect(r2).toMatchObject({ codigo: 500 });
    expect(JSON.stringify(r2)).not.toContain('V-12345678');
    expect(JSON.stringify(bd.logs)).not.toContain('V-12345678');
    expect(JSON.stringify(bd.logs)).not.toContain('Ana');
  });
});

describe('cerrarNomina', () => {
  it('cierra llamando a la función atómica y devuelve la nómina', async () => {
    bd.rpcResultado = { data: { yaCerrada: false }, error: null };
    const r = await cerrarNomina(NOMINA, USUARIO);
    if ('error' in r) throw new Error(r.error);
    expect(bd.rpc).toHaveBeenCalledWith('nomina_cerrar', { p_nomina_id: NOMINA, p_usuario: USUARIO });
    expect(r.yaCerrada).toBe(false);
  });

  it('con un renglón de total negativo NO cierra: 409 claro y sin llamar a la función SQL', async () => {
    bd.nomina = { ...nominaGuardada, lineas: [{ id: 'l1', trabajador_id: T1, trabajador_nombre: 'Ana Pérez', total_usd: -30, cuotas: [] }] };
    const r = await cerrarNomina(NOMINA, USUARIO);
    expect(r).toEqual({ error: MENSAJE_CIERRE_CON_NEGATIVOS, codigo: 409 });
    expect(bd.rpc).not.toHaveBeenCalled();
  });

  it('si la función SQL rechaza el cierre por totales negativos, el mensaje de negocio llega como 409', async () => {
    bd.rpcResultado = { data: null, error: { code: 'P0001', message: MENSAJE_CIERRE_CON_NEGATIVOS } };
    expect(await cerrarNomina(NOMINA, USUARIO)).toEqual({ error: MENSAJE_CIERRE_CON_NEGATIVOS, codigo: 409 });
  });

  it('reintentar sobre una nómina ya cerrada no es error: avisa yaCerrada', async () => {
    bd.rpcResultado = { data: { yaCerrada: true }, error: null };
    const r = await cerrarNomina(NOMINA, USUARIO);
    expect('error' in r).toBe(false);
    expect('error' in r || r.yaCerrada).toBe(true);
  });

  it('saldo insuficiente en el cierre: 409 con el mensaje de la BD', async () => {
    bd.rpcResultado = { data: null, error: { code: 'P0001', message: 'Un préstamo ya no está activo o su saldo es menor que la cuota.' } };
    expect(await cerrarNomina(NOMINA, USUARIO)).toMatchObject({ codigo: 409 });
  });

  it('nómina inexistente: 404', async () => {
    bd.rpcResultado = { data: null, error: { code: 'P0002', message: 'Nómina no encontrada.' } };
    expect(await cerrarNomina(NOMINA, USUARIO)).toMatchObject({ codigo: 404 });
  });
});

describe('anularNomina', () => {
  it('anula con motivo', async () => {
    bd.rpcResultado = { data: { yaAnulada: false }, error: null };
    const r = await anularNomina(NOMINA, 'Se cargó la semana equivocada', USUARIO);
    expect('error' in r).toBe(false);
    expect(bd.rpc).toHaveBeenCalledWith('nomina_anular', { p_nomina_id: NOMINA, p_motivo: 'Se cargó la semana equivocada', p_usuario: USUARIO });
  });
});
