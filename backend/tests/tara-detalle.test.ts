import { describe, it, expect } from 'vitest';
import type { Tara } from '../../shared/types/index';
import { describirTarasDetalle } from '../../shared/types/ticket-pesaje';
import { materialSchema, completarTicketSchema } from '../src/schemas/tickets-pesaje';
import {
  describirTarasDetalle as describirBackend,
  desgloseTaraCoincide,
  sumaTarasDetalle,
  tarasDetalleARpc,
  tarasDetalleDesdeBd,
} from '../src/utils/taras-detalle';
import {
  filaTaraDesdeDetalle,
  taraTotalKg,
  tarasDetalleDeFila,
  taraUnidadVacia,
  type TaraUnidad,
} from '../../frontend/src/features/pesaje/tara-multiple';

const PRODUCTO = '11111111-1111-4111-8111-111111111111';
const TARA_SACA = '22222222-2222-4222-8222-222222222222';

const material = (extra: Record<string, unknown> = {}) => ({
  productoId: PRODUCTO,
  pesoBruto: 10,
  tara: 1.7,
  fotos: ['https://x/f.jpg'],
  ...extra,
});

const desglose = [
  { tipo: 'tabla', taraId: TARA_SACA, nombre: 'Saca', cantidad: 2, kg: 1.2 },
  { tipo: 'manual', nombre: 'Cesta', kg: 0.5 },
];

describe('desglose de taras: esquema del backend', () => {
  it('un material sin desglose sigue siendo válido (compatibilidad con el frontend viejo)', () => {
    const r = materialSchema.safeParse(material());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tarasDetalle).toBeNull();
  });

  it('acepta null, undefined y lista vacía como "sin desglose"', () => {
    for (const v of [null, undefined, []]) {
      const r = materialSchema.safeParse(material({ tarasDetalle: v }));
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.tarasDetalle).toBeNull();
    }
  });

  it('acepta un desglose cuya suma coincide con la tara total', () => {
    const r = materialSchema.safeParse(material({ tarasDetalle: desglose }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tarasDetalle).toHaveLength(2);
  });

  it('tolera hasta 0.005 kg de diferencia', () => {
    expect(materialSchema.safeParse(material({ tarasDetalle: [{ tipo: 'manual', nombre: 'A', kg: 1.705 }] })).success).toBe(true);
    expect(materialSchema.safeParse(material({ tarasDetalle: [{ tipo: 'manual', nombre: 'A', kg: 1.71 }] })).success).toBe(false);
  });

  it('rechaza un desglose que no suma la tara total', () => {
    const r = materialSchema.safeParse(material({ tarasDetalle: [{ tipo: 'manual', nombre: 'A', kg: 1 }] }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toContain('tarasDetalle');
  });

  it('rechaza entradas inválidas (kg negativo, nombre vacío, tipo desconocido)', () => {
    expect(materialSchema.safeParse(material({ tarasDetalle: [{ tipo: 'manual', nombre: 'A', kg: -1 }] })).success).toBe(false);
    expect(materialSchema.safeParse(material({ tarasDetalle: [{ tipo: 'manual', nombre: ' ', kg: 1.7 }] })).success).toBe(false);
    expect(materialSchema.safeParse(material({ tarasDetalle: [{ tipo: 'otro', nombre: 'A', kg: 1.7 }] })).success).toBe(false);
  });

  it('también se valida al completar un ticket en bruto', () => {
    expect(completarTicketSchema.safeParse({ materiales: [material({ tarasDetalle: desglose })] }).success).toBe(true);
    expect(completarTicketSchema.safeParse({ materiales: [material({ tarasDetalle: [{ tipo: 'manual', nombre: 'A', kg: 5 }] })] }).success).toBe(false);
    expect(completarTicketSchema.safeParse({ materiales: [material()] }).success).toBe(true);
  });
});

describe('desglose de taras: utilidades del backend', () => {
  it('suma y compara contra la tara total', () => {
    expect(sumaTarasDetalle(desglose)).toBe(1.7);
    expect(desgloseTaraCoincide(desglose, 1.7)).toBe(true);
    expect(desgloseTaraCoincide(desglose, 2)).toBe(false);
    expect(desgloseTaraCoincide(null, 123)).toBe(true);
    expect(desgloseTaraCoincide([], 123)).toBe(true);
  });

  it('convierte a snake_case para la BD y vuelve a camelCase al leer', () => {
    const parsed = materialSchema.parse(material({ tarasDetalle: desglose }));
    const rpc = tarasDetalleARpc(parsed.tarasDetalle);
    expect(rpc?.[0]).toEqual({ tipo: 'tabla', tara_id: TARA_SACA, nombre: 'Saca', cantidad: 2, kg: 1.2 });
    expect(rpc?.[1]).toEqual({ tipo: 'manual', nombre: 'Cesta', kg: 0.5 });
    expect(tarasDetalleDesdeBd(rpc)).toEqual([
      { tipo: 'tabla', taraId: TARA_SACA, nombre: 'Saca', cantidad: 2, kg: 1.2 },
      { tipo: 'manual', nombre: 'Cesta', kg: 0.5 },
    ]);
  });

  it('sin desglose manda null a la BD y lee null (columna ausente, null o basura)', () => {
    expect(tarasDetalleARpc(null)).toBeNull();
    expect(tarasDetalleARpc([])).toBeNull();
    for (const raw of [undefined, null, 'x', {}, [], [null, 3, { nombre: 5 }]]) {
      expect(tarasDetalleDesdeBd(raw)).toBeNull();
    }
  });

  it('el formateador del backend es idéntico al compartido', () => {
    const f = (n: number) => n.toFixed(2).replace('.', ',');
    const detalle = [
      { tipo: 'tabla' as const, taraId: 'a', nombre: 'Saca', cantidad: 2, kg: 1.2 },
      { tipo: 'manual' as const, nombre: 'Cesta', kg: 0.5 },
    ];
    expect(describirBackend(detalle, f)).toBe(describirTarasDetalle(detalle, f));
    expect(describirBackend(detalle, f)).toBe('Saca ×2 = 1,20 kg · Cesta = 0,50 kg');
  });
});

describe('desglose de taras: frontend', () => {
  const taras = [{ id: 'saca', nombre: 'Saca', peso: 0.6, activo: true }] as unknown as Tara[];
  const u = (c: Partial<TaraUnidad>): TaraUnidad => ({ ...taraUnidadVacia(), ...c });

  it('genera una entrada por tara con kg y su suma es la tara total', () => {
    const fila = { ...u({ taraId: 'saca', taraCantidad: '2' }), tarasExtra: [u({ taraModo: 'manual', taraManual: '0.5' }), u({})] };
    const detalle = tarasDetalleDeFila(fila, taras);
    expect(detalle).toEqual([
      { tipo: 'tabla', taraId: 'saca', nombre: 'Saca', cantidad: 2, kg: 1.2 },
      { tipo: 'manual', nombre: 'Manual', kg: 0.5 },
    ]);
    expect(sumaTarasDetalle(detalle)).toBe(taraTotalKg(fila, taras));
  });

  it('restaura las taras individuales al reabrir un ticket con desglose', () => {
    const detalle = [
      { tipo: 'tabla' as const, taraId: 'saca', nombre: 'Saca', cantidad: 2, kg: 1.2 },
      { tipo: 'manual' as const, nombre: 'Manual', kg: 0.5 },
    ];
    const fila = filaTaraDesdeDetalle(detalle, 1.7, taras);
    expect(fila.taraModo).toBe('preconfigurada');
    expect(fila.taraId).toBe('saca');
    expect(fila.taraCantidad).toBe('2');
    expect(fila.tarasExtra).toHaveLength(1);
    expect(taraTotalKg(fila, taras)).toBe(1.7);
  });

  it('sin desglose restaura una sola tara manual con el total (comportamiento anterior)', () => {
    const fila = filaTaraDesdeDetalle(null, 1.7, taras);
    expect(fila.taraModo).toBe('manual');
    expect(fila.taraManual).toBe('1.7');
    expect(fila.tarasExtra).toBeUndefined();
  });

  it('una tara borrada o con peso cambiado se restaura manual con los kg guardados', () => {
    const borrada = filaTaraDesdeDetalle([{ tipo: 'tabla', taraId: 'vieja', nombre: 'Vieja', cantidad: 1, kg: 1.7 }], 1.7, taras);
    expect(borrada.taraModo).toBe('manual');
    expect(taraTotalKg(borrada, taras)).toBe(1.7);
    const cambiada = filaTaraDesdeDetalle([{ tipo: 'tabla', taraId: 'saca', nombre: 'Saca', cantidad: 3, kg: 1.7 }], 1.7, taras);
    expect(cambiada.taraModo).toBe('manual');
    expect(taraTotalKg(cambiada, taras)).toBe(1.7);
  });

  it('un desglose que ya no cuadra con la tara total se ignora', () => {
    const fila = filaTaraDesdeDetalle([{ tipo: 'manual', nombre: 'A', kg: 1 }], 1.7, taras);
    expect(fila.taraManual).toBe('1.7');
    expect(fila.tarasExtra).toBeUndefined();
  });
});
