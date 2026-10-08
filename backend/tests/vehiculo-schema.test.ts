import { describe, it, expect } from 'vitest';
import { crearVehiculoSchema, actualizarVehiculoSchema } from '../src/schemas/vehiculo.js';
import { crearTicketSchema } from '../src/schemas/tickets-pesaje.js';

describe('crearVehiculoSchema', () => {
  it('acepta solo placa/nombre', () => {
    const r = crearVehiculoSchema.safeParse({ nombre: ' ABC-123 ', placa: 'abc-123' });
    expect(r.success && r.data).toMatchObject({ nombre: 'ABC-123', placa: 'ABC-123', descripcion: null });
  });

  it('acepta descripcion y la normaliza', () => {
    const r = crearVehiculoSchema.safeParse({ nombre: 'ABC-123', placa: 'P1', descripcion: '  Camión 350 ' });
    expect(r.success && r.data.descripcion).toBe('Camión 350');
  });

  it('descripcion vacía pasa a null', () => {
    const r = crearVehiculoSchema.safeParse({ nombre: 'ABC-123', placa: 'P1', descripcion: '   ' });
    expect(r.success && r.data.descripcion).toBeNull();
  });

  it('rechaza nombre vacío', () => {
    expect(crearVehiculoSchema.safeParse({ nombre: '  ' }).success).toBe(false);
  });

  it('rechaza descripcion de más de 200 caracteres', () => {
    expect(crearVehiculoSchema.safeParse({ nombre: 'A', placa: 'P1', descripcion: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('actualizarVehiculoSchema', () => {
  it('rechaza cuerpo vacío', () => {
    expect(actualizarVehiculoSchema.safeParse({}).success).toBe(false);
  });

  it('permite actualizar solo descripcion', () => {
    expect(actualizarVehiculoSchema.safeParse({ descripcion: 'Rastra' }).success).toBe(true);
  });

  it('permite limpiar descripcion con cadena vacía', () => {
    const r = actualizarVehiculoSchema.safeParse({ descripcion: '' });
    expect(r.success && r.data.descripcion).toBeNull();
  });

  it('permite actualizar solo activo', () => {
    expect(actualizarVehiculoSchema.safeParse({ activo: false }).success).toBe(true);
  });
});

describe('ticket de pesaje con vehículo de tercero', () => {
  it('el vehículo se guarda como texto libre en el ticket', () => {
    const r = crearTicketSchema.shape.vehiculo.safeParse('  TERCERO-99 ');
    expect(r.success && r.data).toBe('TERCERO-99');
  });
});
