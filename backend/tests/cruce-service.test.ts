import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));

import { mapearAdelantosDisponibles } from '../src/services/cruce-service';

const fila = (parcial: Record<string, unknown> = {}) => ({
  adelanto_id: 'a1',
  numero: 3,
  fecha: '2026-09-24',
  descripcion: 'Adelanto',
  total: '400.00',
  aplicado: '100.00',
  disponible: '300.00',
  ...parcial,
});

describe('mapearAdelantosDisponibles', () => {
  it('convierte numerics string a number y formatea el código AD- para proveedor', () => {
    const [a] = mapearAdelantosDisponibles([fila()], 'proveedor');
    expect(a).toEqual({
      id: 'a1', codigo: 'AD-0003', fecha: '2026-09-24', descripcion: 'Adelanto',
      total: 400, aplicado: 100, disponible: 300,
    });
  });

  it('usa el código AC- para anticipos de cliente', () => {
    const [a] = mapearAdelantosDisponibles([fila({ numero: 12 })], 'cliente');
    expect(a.codigo).toBe('AC-0012');
  });

  it('descarta los adelantos ya consumidos (disponible < 1 centavo)', () => {
    const r = mapearAdelantosDisponibles([
      fila({ adelanto_id: 'a1', disponible: '0.00' }),
      fila({ adelanto_id: 'a2', disponible: '0.004' }),
      fila({ adelanto_id: 'a3', disponible: '0.01' }),
    ], 'proveedor');
    expect(r.map(a => a.id)).toEqual(['a3']);
  });

  it('código null si el movimiento legacy no tiene número', () => {
    const [a] = mapearAdelantosDisponibles([fila({ numero: null })], 'proveedor');
    expect(a.codigo).toBeNull();
  });

  it('recorta la fecha a YYYY-MM-DD', () => {
    const [a] = mapearAdelantosDisponibles([fila({ fecha: '2026-09-24T00:00:00+00:00' })], 'proveedor');
    expect(a.fecha).toBe('2026-09-24');
  });
});
