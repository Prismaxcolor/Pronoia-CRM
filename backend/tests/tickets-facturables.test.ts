import { describe, it, expect } from 'vitest';
import {
  esTicketFacturable,
  ticketsPendientesDeFacturar,
  type TicketFacturableMinimo,
} from '../../frontend/src/lib/tickets-facturables';

const base: TicketFacturableMinimo = { tipo: 'compra', estado: 'completo', facturado: false, ticketPrincipalId: null };

describe('esTicketFacturable', () => {
  it('acepta un ticket completo sin factura', () => {
    expect(esTicketFacturable(base)).toBe(true);
  });
  it('rechaza un pesaje global en bruto', () => {
    expect(esTicketFacturable({ ...base, estado: 'bruto' })).toBe(false);
  });
  it('rechaza un ticket ya facturado', () => {
    expect(esTicketFacturable({ ...base, facturado: true })).toBe(false);
  });
  it('rechaza un ticket unido a un principal', () => {
    expect(esTicketFacturable({ ...base, ticketPrincipalId: 'abc' })).toBe(false);
  });
});

describe('ticketsPendientesDeFacturar', () => {
  it('deja solo los del tipo pedido que son facturables y no muta la entrada', () => {
    const lista: TicketFacturableMinimo[] = [
      base,
      { ...base, estado: 'bruto' },
      { ...base, tipo: 'venta' },
      { ...base, facturado: true },
    ];
    const copia = [...lista];
    expect(ticketsPendientesDeFacturar(lista, 'compra')).toEqual([base]);
    expect(lista).toEqual(copia);
  });
});
