import { describe, it, expect } from 'vitest';
import {
  MAX_TICKETS_UNIDOS,
  sumarPesosGlobales,
  validarUnionTickets,
  type TicketUnibleRow,
} from '../src/services/ticket-union.js';
import { completarTicketSchema } from '../src/schemas/tickets-pesaje.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const PROVEEDOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ticket(over: Partial<TicketUnibleRow> = {}): TicketUnibleRow {
  return {
    id: UUID,
    tipo: 'compra',
    estado: 'bruto',
    entidad_id: PROVEEDOR,
    peso_global: 700,
    pesaje_exterior: false,
    ticket_principal_id: null,
    ...over,
  };
}

describe('sumarPesosGlobales', () => {
  it('suma el principal con los secundarios', () => {
    expect(sumarPesosGlobales({ peso_global: 700 }, [{ peso_global: 100.5 }, { peso_global: 50 }])).toBeCloseTo(850.5);
  });

  it('sin secundarios devuelve el peso del principal', () => {
    expect(sumarPesosGlobales({ peso_global: 700 }, [])).toBe(700);
  });

  it('trata pesos nulos como 0', () => {
    expect(sumarPesosGlobales({ peso_global: null }, [{ peso_global: null }, { peso_global: 10 }])).toBe(10);
  });
});

describe('validarUnionTickets', () => {
  const principal = ticket({ id: UUID });
  const secundario = ticket({ id: UUID2, peso_global: 100 });

  it('sin ids no hay nada que validar', () => {
    expect(validarUnionTickets(principal, [], [])).toBeNull();
  });

  it('acepta compra en bruto del mismo proveedor', () => {
    expect(validarUnionTickets(principal, [secundario], [UUID2])).toBeNull();
  });

  it('rechaza un proveedor distinto', () => {
    const otro = ticket({ id: UUID2, entidad_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(validarUnionTickets(principal, [otro], [UUID2])).toMatch(/mismo proveedor/);
  });

  it('rechaza tickets de venta', () => {
    expect(validarUnionTickets(principal, [ticket({ id: UUID2, tipo: 'venta' })], [UUID2])).toMatch(/compra/);
    expect(validarUnionTickets(ticket({ tipo: 'venta' }), [secundario], [UUID2])).toMatch(/compra/);
  });

  it('rechaza tickets que no están en bruto', () => {
    expect(validarUnionTickets(principal, [ticket({ id: UUID2, estado: 'completo' })], [UUID2])).toMatch(/bruto/);
  });

  it('rechaza pesaje exterior en principal o secundario', () => {
    expect(validarUnionTickets(principal, [ticket({ id: UUID2, pesaje_exterior: true })], [UUID2])).toMatch(/exterior/);
    expect(validarUnionTickets(ticket({ pesaje_exterior: true }), [secundario], [UUID2])).toMatch(/exterior/);
  });

  it('rechaza un ticket ya unido a otro', () => {
    expect(validarUnionTickets(principal, [ticket({ id: UUID2, ticket_principal_id: PROVEEDOR })], [UUID2])).toMatch(/ya está unido/);
  });

  it('rechaza unirse a sí mismo, repetidos e inexistentes', () => {
    expect(validarUnionTickets(principal, [principal], [UUID])).toMatch(/sí mismo/);
    expect(validarUnionTickets(principal, [secundario], [UUID2, UUID2])).toMatch(/repetidos/);
    expect(validarUnionTickets(principal, [], [UUID2])).toMatch(/no existe/);
  });

  it('rechaza más de MAX_TICKETS_UNIDOS', () => {
    const ids = Array.from({ length: MAX_TICKETS_UNIDOS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(validarUnionTickets(principal, [], ids)).toMatch(/más de/);
  });
});

describe('completarTicketSchema.ticketsUnidosIds', () => {
  const material = { productoId: UUID2, pesoBruto: 100, tara: 10, fotos: ['https://x.com/foto.jpg'] };

  it('es opcional y por defecto queda []', () => {
    const r = completarTicketSchema.safeParse({ materiales: [material] });
    expect(r.success && r.data.ticketsUnidosIds).toEqual([]);
  });

  it('acepta uuids válidos', () => {
    const r = completarTicketSchema.safeParse({ materiales: [material], ticketsUnidosIds: [UUID] });
    expect(r.success && r.data.ticketsUnidosIds).toEqual([UUID]);
  });

  it('rechaza ids inválidos, repetidos y demasiados', () => {
    expect(completarTicketSchema.safeParse({ materiales: [material], ticketsUnidosIds: ['x'] }).success).toBe(false);
    expect(completarTicketSchema.safeParse({ materiales: [material], ticketsUnidosIds: [UUID, UUID] }).success).toBe(false);
    const muchos = Array.from({ length: MAX_TICKETS_UNIDOS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(completarTicketSchema.safeParse({ materiales: [material], ticketsUnidosIds: muchos }).success).toBe(false);
  });
});
