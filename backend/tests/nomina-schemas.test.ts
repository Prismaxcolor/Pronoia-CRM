import { describe, it, expect } from 'vitest';
import {
  actualizarPrestamoSchema, actualizarTrabajadorSchema, anularSchema, crearPrestamoSchema, crearTrabajadorSchema,
  filtroNominasSchema, filtroPrestamosSchema, filtroSemanaSchema, filtroTrabajadoresSchema, guardarNominaSchema,
} from '../src/schemas/nomina';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';

const trabajador = { tipo: 'OPERATIVO', nombres: 'Ana María', apellidos: 'Pérez', cedula: 'V-12345678' };

describe('trabajador', () => {
  it('mínimo válido: tipo, nombres, apellidos y cédula', () => {
    const r = crearTrabajadorSchema.safeParse(trabajador);
    expect(r.success).toBe(true);
  });
  it('tipo solo ADMINISTRATIVO u OPERATIVO', () => {
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, tipo: 'OTRO' }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, tipo: undefined }).success).toBe(false);
  });
  it('nombres, apellidos y cédula obligatorios y recortados', () => {
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, nombres: '  ' }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, apellidos: '' }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, cedula: '' }).success).toBe(false);
    const r = crearTrabajadorSchema.safeParse({ ...trabajador, nombres: '  Ana  ' });
    expect(r.success && r.data.nombres).toBe('Ana');
  });
  it('cédula, RIF y teléfonos rechazan caracteres raros (inyección, HTML)', () => {
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, cedula: "V-1'; drop" }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, rif: '<script>' }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, telefono: 'abc' }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, pagoMovilTelefono: '0414-1234567', rif: 'J-12345678-9', telefono: '+58 414 1234567' }).success).toBe(true);
  });
  it('opcionales vacíos pasan a null', () => {
    const r = crearTrabajadorSchema.safeParse({ ...trabajador, direccion: '   ', rif: '' });
    expect(r.success && r.data.direccion).toBeNull();
    expect(r.success && r.data.rif).toBeNull();
  });
  it('pago diario: no negativo y con hasta 2 decimales', () => {
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, pagoDiarioUsd: -1 }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, pagoDiarioUsd: 10.123 }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, pagoDiarioUsd: 12.5 }).success).toBe(true);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, pagoDiarioBs: -1 }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, pagoDiarioBs: 10.123 }).success).toBe(false);
    expect(crearTrabajadorSchema.parse({ ...trabajador, pagoDiarioBs: 3500.5 }).pagoDiarioBs).toBe(3500.5);
    expect(crearTrabajadorSchema.parse(trabajador).pagoDiarioBs).toBe(0);
  });
  it('largos máximos', () => {
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, direccion: 'x'.repeat(301) }).success).toBe(false);
    expect(crearTrabajadorSchema.safeParse({ ...trabajador, binanceCorreoId: 'x'.repeat(121) }).success).toBe(false);
  });
  it('actualizar: lo no enviado queda sin tocar (undefined), no se borra', () => {
    const r = actualizarTrabajadorSchema.safeParse({ nombres: 'Luis' });
    expect(r.success && r.data.direccion).toBeUndefined();
    expect(r.success && r.data.activo).toBeUndefined();
  });
  it('actualizar: null o vacío borra el campo opcional', () => {
    const r = actualizarTrabajadorSchema.safeParse({ direccion: '', rif: null, activo: false });
    expect(r.success && r.data.direccion).toBeNull();
    expect(r.success && r.data.rif).toBeNull();
    expect(r.success && r.data.activo).toBe(false);
  });
  it('no deja pasar campos desconocidos (id, activo en alta)', () => {
    const r = crearTrabajadorSchema.safeParse({ ...trabajador, id: T1, activo: false });
    expect(r.success && Object.keys(r.data)).not.toContain('id');
    expect(r.success && Object.keys(r.data)).not.toContain('activo');
  });
});

describe('préstamo', () => {
  const base = { trabajadorId: T1, tipo: 'PRESTAMO', montoUsd: 100, fecha: '2026-10-01' };
  it('válido', () => expect(crearPrestamoSchema.safeParse(base).success).toBe(true));
  it('monto positivo', () => {
    expect(crearPrestamoSchema.safeParse({ ...base, montoUsd: 0 }).success).toBe(false);
    expect(crearPrestamoSchema.safeParse({ ...base, montoUsd: -5 }).success).toBe(false);
  });
  it('tipo PRESTAMO o ADELANTO, obligatorio', () => {
    expect(crearPrestamoSchema.safeParse({ ...base, tipo: 'ADELANTO' }).success).toBe(true);
    expect(crearPrestamoSchema.safeParse({ ...base, tipo: undefined }).success).toBe(false);
  });
  it('cuota semanal opcional, positiva y no mayor al monto', () => {
    expect(crearPrestamoSchema.safeParse({ ...base, cuotaSemanalUsd: 25 }).success).toBe(true);
    expect(crearPrestamoSchema.safeParse({ ...base, cuotaSemanalUsd: 0 }).success).toBe(false);
    expect(crearPrestamoSchema.safeParse({ ...base, cuotaSemanalUsd: 101 }).success).toBe(false);
    const sin = crearPrestamoSchema.safeParse(base);
    expect(sin.success && sin.data.cuotaSemanalUsd).toBeNull();
  });
  it('fecha YYYY-MM-DD válida', () => {
    expect(crearPrestamoSchema.safeParse({ ...base, fecha: '01/10/2026' }).success).toBe(false);
    expect(crearPrestamoSchema.safeParse({ ...base, fecha: '2026-02-31' }).success).toBe(false);
  });
  it('actualizar y anular', () => {
    expect(actualizarPrestamoSchema.safeParse({ cuotaSemanalUsd: 10, nota: 'ok' }).success).toBe(true);
    expect(actualizarPrestamoSchema.safeParse({ cuotaSemanalUsd: -1 }).success).toBe(false);
    expect(anularSchema.safeParse({ motivo: '' }).success).toBe(false);
    expect(anularSchema.safeParse({ motivo: 'Error de monto' }).success).toBe(true);
  });
});

describe('guardar nómina', () => {
  const renglon = { trabajadorId: T1, diasTrabajados: 5, montoBaseUsd: 20 };
  const base = { tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs: 40, version: null, lineas: [renglon] };
  it('válida; bonificación, descuentos, cuotas y nota por defecto', () => {
    const r = guardarNominaSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.confirmarNegativos).toBe(false);
    expect(r.data.lineas[0]).toMatchObject({ bonificacionUsd: 0, descuentoTrabajoUsd: 0, cuotas: [], nota: null });
  });
  it('la semana debe ser un lunes', () => {
    expect(guardarNominaSchema.safeParse({ ...base, semanaInicio: '2026-10-06' }).success).toBe(false);
  });
  it('tasa opcional (null) pero positiva si viene', () => {
    expect(guardarNominaSchema.safeParse({ ...base, tasaBs: null }).success).toBe(true);
    expect(guardarNominaSchema.safeParse({ ...base, tasaBs: 0 }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, tasaBs: -3 }).success).toBe(false);
  });
  it('días entre 0 y 7', () => {
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, diasTrabajados: 7.5 }] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, diasTrabajados: -1 }] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, diasTrabajados: 4.5 }] }).success).toBe(true);
  });
  it('el sueldo en Bs es opcional (0 por defecto), no negativo y con 2 decimales como máximo', () => {
    const r = guardarNominaSchema.parse({ ...base, lineas: [renglon] });
    expect(r.lineas[0].montoBaseBs).toBe(0);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, montoBaseBs: 350.5 }] }).success).toBe(true);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, montoBaseBs: -1 }] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, montoBaseBs: 1.234 }] }).success).toBe(false);
  });
  it('un renglón con monedaPago (pestaña con el frontend viejo) se rechaza con un mensaje claro, sin guardarlo como divisas', () => {
    for (const valor of ['EUR', 'BS', 'USD', null]) {
      const r = guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, monedaPago: valor }] });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe('Recarga la página: la nómina cambió');
    }
  });
  it('la tasa admite hasta 6 decimales', () => {
    expect(guardarNominaSchema.safeParse({ ...base, tasaBs: 36.123456 }).success).toBe(true);
    expect(guardarNominaSchema.safeParse({ ...base, tasaBs: 36.1234567 }).success).toBe(false);
  });
  it('al menos un renglón, sin trabajadores repetidos', () => {
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [renglon, renglon] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [renglon, { ...renglon, trabajadorId: T2 }] }).success).toBe(true);
  });
  it('montos negativos o con más de 2 decimales se rechazan', () => {
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, bonificacionUsd: -1 }] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, descuentoTrabajoUsd: 1.234 }] }).success).toBe(false);
  });
  it('cuotas: préstamo uuid, monto positivo y sin repetir préstamo en el renglón', () => {
    const cuota = { prestamoId: P1, montoUsd: 10 };
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, cuotas: [cuota] }] }).success).toBe(true);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, cuotas: [cuota, cuota] }] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, cuotas: [{ ...cuota, montoUsd: 0 }] }] }).success).toBe(false);
    expect(guardarNominaSchema.safeParse({ ...base, lineas: [{ ...renglon, cuotas: [{ ...cuota, prestamoId: 'x' }] }] }).success).toBe(false);
  });
  it('versión entera no negativa o null', () => {
    expect(guardarNominaSchema.safeParse({ ...base, version: 3 }).success).toBe(true);
    expect(guardarNominaSchema.safeParse({ ...base, version: 1.5 }).success).toBe(false);
  });
});

describe('filtros', () => {
  it('trabajadores: tipo opcional; incluirInactivos como texto', () => {
    expect(filtroTrabajadoresSchema.safeParse({ tipo: 'OPERATIVO', incluirInactivos: 'true' }).data?.incluirInactivos).toBe(true);
    expect(filtroTrabajadoresSchema.safeParse({}).data?.incluirInactivos).toBe(false);
    expect(filtroTrabajadoresSchema.safeParse({ tipo: 'X' }).success).toBe(false);
  });
  it('semana: tipo obligatorio y lunes', () => {
    expect(filtroSemanaSchema.safeParse({ tipo: 'OPERATIVO', semana: '2026-10-05' }).success).toBe(true);
    expect(filtroSemanaSchema.safeParse({ tipo: 'OPERATIVO', semana: '2026-10-06' }).success).toBe(false);
    expect(filtroSemanaSchema.safeParse({ semana: '2026-10-05' }).success).toBe(false);
  });
  it('nóminas y préstamos', () => {
    expect(filtroNominasSchema.safeParse({ tipo: 'ADMINISTRATIVO', desde: '2026-09-01', hasta: '2026-10-01' }).success).toBe(true);
    expect(filtroNominasSchema.safeParse({ desde: 'ayer' }).success).toBe(false);
    expect(filtroPrestamosSchema.safeParse({ trabajadorId: 'x' }).success).toBe(false);
    expect(filtroPrestamosSchema.safeParse({ trabajadorId: T1, estado: 'ACTIVO' }).success).toBe(true);
  });
});

describe('cédula normalizada', () => {
  const parsear = (cedula: string) => {
    const r = crearTrabajadorSchema.safeParse({ ...trabajador, cedula });
    return r.success ? r.data.cedula : null;
  };
  it('"V-12.345.678", "v 12345678" y "V12345678" dan la misma cédula (colisionan en el índice único)', () => {
    expect(parsear('V-12.345.678')).toBe('V12345678');
    expect(parsear('v 12345678')).toBe('V12345678');
    expect(parsear('V12345678')).toBe('V12345678');
  });
  it('también se normaliza al actualizar', () => {
    const r = actualizarTrabajadorSchema.safeParse({ cedula: ' e-98.765 ' });
    expect(r.success && r.data.cedula).toBe('E98765');
  });
  it('sigue rechazando caracteres raros y cédulas que quedan demasiado cortas', () => {
    expect(parsear("V-1'; drop")).toBeNull();
    expect(parsear('V-.')).toBeNull();
    expect(parsear('1-')).toBeNull();
  });
});

describe('descuento de préstamo vs lo ganado', () => {
  const renglon = { trabajadorId: T1, diasTrabajados: 1, montoBaseUsd: 20 };
  const nomina = (r: Record<string, unknown>) =>
    guardarNominaSchema.safeParse({ tipo: 'OPERATIVO', semanaInicio: '2026-10-05', tasaBs: 40, version: null, lineas: [{ ...renglon, ...r }] });
  it('las cuotas pueden llegar hasta lo ganado (bruto + bonificación)', () => {
    expect(nomina({ cuotas: [{ prestamoId: P1, montoUsd: 20 }] }).success).toBe(true);
    expect(nomina({ bonificacionUsd: 5, cuotas: [{ prestamoId: P1, montoUsd: 25 }] }).success).toBe(true);
  });
  it('rechaza cuotas mayores a lo ganado', () => {
    const r = nomina({ cuotas: [{ prestamoId: P1, montoUsd: 20.01 }] });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toMatch(/ganó/i);
  });
  it('el sueldo en Bs suma a lo ganado a la tasa de la nómina (400 Bs a 40 = 10 USD)', () => {
    expect(nomina({ montoBaseBs: 400, cuotas: [{ prestamoId: P1, montoUsd: 30 }] }).success).toBe(true);
    expect(nomina({ montoBaseBs: 400, cuotas: [{ prestamoId: P1, montoUsd: 30.01 }] }).success).toBe(false);
  });
  it('un trabajador con sueldo solo en Bs puede tener cuotas hasta su equivalente en USD', () => {
    expect(nomina({ montoBaseUsd: 0, montoBaseBs: 400, cuotas: [{ prestamoId: P1, montoUsd: 10 }] }).success).toBe(true);
    expect(nomina({ montoBaseUsd: 0, montoBaseBs: 400, cuotas: [{ prestamoId: P1, montoUsd: 10.01 }] }).success).toBe(false);
  });
  it('la suma de varias cuotas también cuenta', () => {
    const P2 = '44444444-4444-4444-8444-444444444444';
    expect(nomina({ cuotas: [{ prestamoId: P1, montoUsd: 15 }, { prestamoId: P2, montoUsd: 6 }] }).success).toBe(false);
  });
});
