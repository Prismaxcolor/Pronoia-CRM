import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { fotosDeTicket, huboCambioVisible, MAX_FOTOS_TICKET } from '../src/services/telegram-eventos-service.js';
import type { TicketPublico } from '../src/services/ticket-pesaje-service.js';

function ticket(extra: Partial<TicketPublico> = {}): TicketPublico {
  return {
    id: 'T1', numero: 57, codigo: 'Compra-0057', tipo: 'compra', entidadId: 'P1', fecha: '2026-10-03',
    materiales: [{ id: 'm1', productoId: 'p', nombreProducto: 'Cobre', subcategoria: null, pesoBruto: 100, tara: 10, devolucion: 0, pesoNeto: 90, destinoTipo: 'mpp', loteId: null, nombreLote: null, fotos: ['https://c.test/m1.jpg'] }],
    pesoNetoTotal: 90, pesoNetoMateriales: 90, pesoGlobal: 100, pesajesGlobales: [{ id: 'g', peso: 100, tara: 0, fotos: ['https://c.test/g1.jpg'] }],
    pesajeExterior: false, devolucion: 0, fotosDevolucion: ['https://c.test/d1.jpg'], diferencia: 10, fotos: ['https://c.test/t1.jpg'],
    observaciones: null, facturado: false, estado: 'completo', pesadoPor: null, completadoPor: null, completadoEn: null,
    vehiculo: 'ZNA GRIS', createdAt: '2026-10-03T12:00:00Z', ...extra,
  };
}

describe('fotosDeTicket', () => {
  it('ordena: ticket, materiales, pesaje del camión, devolución, vehículo — todas con pie de foto', () => {
    const f = fotosDeTicket(ticket(), ['https://c.test/v1.jpg']);
    expect(f.map(x => x.url)).toEqual(['https://c.test/t1.jpg', 'https://c.test/m1.jpg', 'https://c.test/g1.jpg', 'https://c.test/d1.jpg', 'https://c.test/v1.jpg']);
    expect(f.every(x => x.caption?.startsWith('Compra-0057'))).toBe(true);
    expect(f[1].caption).toContain('Cobre');
  });

  it('sin fotos: lista vacía', () => {
    expect(fotosDeTicket(ticket({ fotos: [], pesajesGlobales: [], fotosDevolucion: [], materiales: [] }))).toEqual([]);
  });

  it('no repite una misma url', () => {
    const t = ticket({ fotos: ['https://c.test/m1.jpg'] });
    expect(fotosDeTicket(t).filter(x => x.url === 'https://c.test/m1.jpg')).toHaveLength(1);
  });

  it(`corta en ${MAX_FOTOS_TICKET} fotos`, () => {
    const muchas = Array.from({ length: 100 }, (_, i) => `https://c.test/x${i}.jpg`);
    expect(fotosDeTicket(ticket({ fotos: muchas }))).toHaveLength(MAX_FOTOS_TICKET);
  });
});

describe('huboCambioVisible', () => {
  it('mismo ticket: no hay cambio', () => expect(huboCambioVisible(ticket(), ticket())).toBe(false));

  it('cambia un peso: sí', () => {
    const despues = ticket({ materiales: [{ ...ticket().materiales[0], pesoBruto: 120, pesoNeto: 110 }], pesoNetoTotal: 110 });
    expect(huboCambioVisible(ticket(), despues)).toBe(true);
  });

  it('cambia fecha, vehículo, observaciones o devolución: sí', () => {
    expect(huboCambioVisible(ticket(), ticket({ fecha: '2026-10-02' }))).toBe(true);
    expect(huboCambioVisible(ticket(), ticket({ vehiculo: 'OTRO' }))).toBe(true);
    expect(huboCambioVisible(ticket(), ticket({ observaciones: 'nota' }))).toBe(true);
    expect(huboCambioVisible(ticket(), ticket({ devolucion: 5 }))).toBe(true);
  });

  it('solo cambian fotos o campos internos (destino): no se reenvía', () => {
    const despues = ticket({ fotos: [], materiales: [{ ...ticket().materiales[0], destinoTipo: 'lote', loteId: 'L1', nombreLote: 'Lote A', fotos: [] }] });
    expect(huboCambioVisible(ticket(), despues)).toBe(false);
  });
});
