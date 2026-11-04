import { describe, it, expect } from 'vitest';
import type { Tara } from '../../shared/types/index';
import {
  taraTotalKg,
  taraUnidadKg,
  taraUnidadVacia,
  filaTaraIncompleta,
  type TaraUnidad,
} from '../../frontend/src/features/pesaje/tara-multiple';
import { sanearTara } from '../../frontend/src/lib/borrador-vigentes';

const taras = [
  { id: 'saca', nombre: 'Saca', peso: 0.5, activo: true },
  { id: 'cesta', nombre: 'Cesta', peso: 2, activo: true },
] as unknown as Tara[];

const principal = (cambios: Partial<TaraUnidad> = {}): TaraUnidad => ({ ...taraUnidadVacia(), ...cambios });

describe('taras múltiples por material', () => {
  it('sin taras adicionales la tara es solo la principal (compatibilidad)', () => {
    const fila = principal({ taraId: 'saca', taraCantidad: '4' });
    expect(taraTotalKg(fila, taras)).toBe(2);
  });

  it('suma saca y cesta al mismo tiempo', () => {
    const fila = {
      ...principal({ taraId: 'saca', taraCantidad: '2' }),
      tarasExtra: [principal({ taraId: 'cesta', taraCantidad: '3' })],
    };
    expect(taraTotalKg(fila, taras)).toBe(7);
  });

  it('mezcla taras preconfiguradas y manuales', () => {
    const fila = {
      ...principal({ taraModo: 'manual', taraManual: '1.25' }),
      tarasExtra: [principal({ taraId: 'cesta', taraCantidad: '1' }), principal({ taraModo: 'manual', taraManual: '0.5' })],
    };
    expect(taraTotalKg(fila, taras)).toBe(3.75);
  });

  it('una tara adicional vacía o inexistente pesa 0 kg', () => {
    expect(taraUnidadKg(principal(), taras)).toBe(0);
    expect(taraUnidadKg(principal({ taraId: 'borrada', taraCantidad: '2' }), taras)).toBe(0);
  });

  it('detecta una tara adicional con cantidad pero sin tara elegida', () => {
    const fila = { ...principal(), tarasExtra: [principal({ taraCantidad: '2' })] };
    expect(filaTaraIncompleta(fila)).toBe(true);
    expect(filaTaraIncompleta(principal())).toBe(false);
  });

  it('el saneo del borrador descarta las taras adicionales que ya no están vigentes', () => {
    const fila = {
      ...principal({ taraId: 'saca', taraCantidad: '1' }),
      tarasExtra: [principal({ taraId: 'cesta', taraCantidad: '1' }), principal({ taraId: 'vieja', taraCantidad: '1' })],
    };
    const { fila: saneada, cambiada } = sanearTara(fila, ['saca', 'cesta']);
    expect(cambiada).toBe(true);
    expect(saneada.tarasExtra).toHaveLength(1);
    expect(saneada.taraId).toBe('saca');
    expect(fila.tarasExtra).toHaveLength(2);
  });
});
